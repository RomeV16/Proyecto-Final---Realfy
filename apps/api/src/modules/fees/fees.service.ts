import { Injectable, Logger } from '@nestjs/common';
import {
  CancelFeeSchema,
  CreateFeeSchema,
  FeeBasis,
  FeeFilterSchema,
  FeeInstallmentFilterSchema,
  FeeInstallmentStatus,
  FeeKind,
  FeePayerMode,
  FeeShareInputSchema,
  FeeStatus,
  StaffCommissionInputSchema,
  UpdateFeeSchema,
  distributeFee,
  feeAmounts,
  feeInstallments,
  pctOf,
  splitBetweenPayers,
} from '@realfy/shared';
import type { CreateFeeInput, StaffCommissionBase } from '@realfy/shared';
import Decimal from 'decimal.js';
import { randomUUID } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { auditJson, badRequest, conflict, dayStart, notFound } from '../cash/cash.errors';
import {
  FEE_INCLUDE,
  PERSON_SELECT,
  dueAmounts,
  loadReference,
  loadRentChanges,
  monthRange,
  presentFee,
  rethrowFeeEngine,
} from './fees.helpers';

type Db = any;

const RENTAL_KINDS: readonly string[] = [FeeKind.AltaAlquiler, FeeKind.Renovacion];

/**
 * Honorarios (D10): alta de alquiler, renovación, venta, tasación y gestión de
 * reparación. Un honorario es de una persona que paga; cuando pagan dos, se
 * crean dos con el mismo `groupId`. Las cuotas, el coorretaje y la comisión del
 * personal salen del motor `fee-engine`. El cobro está en `FeePaymentsService`.
 */
@Injectable()
export class FeesService {
  private readonly logger = new Logger(FeesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly operationalDefaults: OperationalDefaultsService,
  ) {}

  // ─── Lectura ────────────────────────────────────────

  async findAll(query: unknown) {
    const filters = parseOrThrow(FeeFilterSchema, query, 'Invalid filter parameters');
    const where: Record<string, unknown> = {};
    if (filters.kind) where.kind = filters.kind;
    if (filters.status) where.status = filters.status;
    if (filters.payerRole) where.payerRole = filters.payerRole;
    if (filters.payerPersonId) where.payerPersonId = filters.payerPersonId;
    if (filters.contractId) where.contractId = filters.contractId;
    if (filters.propertyId) where.propertyId = filters.propertyId;
    if (filters.period) where.installmentRows = { some: { dueDate: monthRange(filters.period) } };
    const [rows, total] = await Promise.all([
      this.prisma.client.fee.findMany({
        where,
        include: FEE_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.fee.count({ where }),
    ]);
    const items = await this.present(this.prisma.client, rows);
    return { items, total, page: filters.page, limit: filters.limit, totalPages: Math.ceil(total / filters.limit) };
  }

  /** Cuotas de todos los honorarios, para cobrar: filtros por operación, estado, quién paga y mes de vencimiento. */
  async findInstallments(query: unknown) {
    const filters = parseOrThrow(FeeInstallmentFilterSchema, query, 'Invalid filter parameters');
    const where: Record<string, any> = {};
    if (filters.status) where.status = filters.status;
    if (filters.period) where.dueDate = monthRange(filters.period);
    const fee: Record<string, unknown> = {};
    if (filters.kind) fee.kind = filters.kind;
    if (filters.payerRole) fee.payerRole = filters.payerRole;
    if (filters.contractId) fee.contractId = filters.contractId;
    if (Object.keys(fee).length) where.fee = fee;
    const [rows, total] = await Promise.all([
      this.prisma.client.feeInstallment.findMany({
        where,
        include: {
          fee: { include: { payer: PERSON_SELECT, contract: FEE_INCLUDE.contract, property: FEE_INCLUDE.property } },
          receipt: { select: { id: true, series: true, number: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { feeId: 'asc' }, { n: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.feeInstallment.count({ where }),
    ]);
    const byFee = new Map<string, any[]>();
    for (const row of rows) byFee.set(row.feeId, [...(byFee.get(row.feeId) ?? []), row]);
    const due = await this.dueByFee(
      this.prisma.client,
      [...byFee.values()].map((list) => ({ ...list[0].fee, installmentRows: list })),
    );
    const items = rows.map((row: any) => {
      const { fee, ...installment } = row;
      return {
        ...installment,
        dueAmount: due.get(row.feeId)?.get(row.n) ?? null,
        fee: presentFee({ ...fee, installmentRows: [], staffCommissions: [] }, new Map()),
      };
    });
    return { items, total, page: filters.page, limit: filters.limit, totalPages: Math.ceil(total / filters.limit) };
  }

  async findOne(id: string) {
    const fee = await this.prisma.client.fee.findFirst({ where: { id }, include: FEE_INCLUDE });
    if (!fee) throw notFound('FEE_NOT_FOUND', 'Fee not found');
    const [item] = await this.present(this.prisma.client, [fee]);
    return item;
  }

  /** Importe a cobrar de cada cuota, por honorario (con el ajuste del alquiler si corresponde). */
  async dueByFee(db: Db, fees: any[]): Promise<Map<string, Map<number, string>>> {
    const adjusting = fees.filter((f) => f.adjustInstallments && f.contractId);
    const changes = await loadRentChanges(db, [...new Set(adjusting.map((f) => f.contractId as string))]);
    const out = new Map<string, Map<number, string>>();
    for (const fee of fees) {
      const reference = fee.adjustInstallments ? await loadReference(db, fee) : null;
      out.set(fee.id, dueAmounts(fee, reference, changes.get(fee.contractId) ?? []));
    }
    return out;
  }

  private async present(db: Db, fees: any[]) {
    const due = await this.dueByFee(db, fees);
    return fees.map((f) => presentFee(f, due.get(f.id) ?? new Map()));
  }

  // ─── Alta ───────────────────────────────────────────

  /** Crea el honorario (uno por cada persona que paga) con sus cuotas, coorretaje y comisiones. */
  async create(data: unknown) {
    const input = parseOrThrow(CreateFeeSchema, data, 'Invalid fee data');
    const tenantId = this.tenantContext.getTenantId()!;
    const ids = await this.prisma.client.$transaction((tx: Db) => this.createInTx(tx, tenantId, input));
    const rows = await this.prisma.client.fee.findMany({ where: { id: { in: ids } }, include: FEE_INCLUDE, orderBy: { createdAt: 'asc' } });
    const ordered = ids.map((id) => rows.find((r: any) => r.id === id)).filter(Boolean);
    return { items: await this.present(this.prisma.client, ordered) };
  }

  /**
   * Alta dentro de la transacción del que llama (la usa también la renovación
   * del contrato para el honorario pactado). Devuelve los ids creados.
   */
  async createInTx(tx: Db, tenantId: string, input: CreateFeeInput): Promise<string[]> {
    const scope = await this.resolveScope(tx, input);
    await this.assertPeople(tx, input);
    const defaults = await this.operationalDefaults.get(tenantId, tx);
    const staffBase = defaults.fees.staffCommissionBase as StaffCommissionBase;

    let grosses: Decimal[];
    let pcts: (string | null)[];
    try {
      const gross = input.basis === FeeBasis.MontoFijo ? new Decimal(input.baseAmount) : pctOf(input.baseAmount, input.pct!);
      if (input.payerMode === FeePayerMode.CadaParte || input.payers.length === 1) {
        grosses = input.payers.map(() => new Decimal(gross.toFixed(2)));
        pcts = input.payers.map(() => input.pct ?? null);
      } else {
        const shares = input.payers.map((p) => p.sharePct ?? '0');
        grosses = splitBetweenPayers(gross, shares).map((g) => new Decimal(g.toFixed(2)));
        pcts = shares.map((s) => (input.pct ? new Decimal(input.pct).times(s).div(100).toDecimalPlaces(4).toString() : null));
      }
    } catch (error) {
      rethrowFeeEngine(error);
    }

    const groupId = input.payers.length > 1 ? randomUUID() : null;
    const firstDue = dayStart(input.firstDueDate);
    const created: string[] = [];
    for (const [i, payer] of input.payers.entries()) {
      let amounts: ReturnType<typeof feeAmounts>;
      let plan: ReturnType<typeof feeInstallments>;
      let split: ReturnType<typeof distributeFee>;
      try {
        amounts = feeAmounts(grosses[i], input.vatMode, input.vatPct);
        plan = feeInstallments(amounts.total, input.installments, firstDue);
        split = distributeFee({
          net: amounts.net,
          sharesPct: input.shares.map((s) => s.pct),
          staffPct: input.staff.map((s) => s.pct),
          staffBase,
        });
      } catch (error) {
        rethrowFeeEngine(error);
      }
      const fee = await tx.fee.create({
        data: {
          tenantId,
          groupId,
          kind: input.kind,
          status: plan.length === 0 ? FeeStatus.SinCargo : FeeStatus.Pendiente,
          contractId: scope.contractId,
          contractPeriodId: scope.contractPeriodId,
          propertyId: scope.propertyId,
          valuationId: input.valuationId ?? null,
          payerPersonId: payer.personId,
          payerRole: payer.role,
          basis: input.basis,
          pct: pcts[i],
          baseAmount: new Decimal(input.baseAmount).toFixed(2),
          vatMode: input.vatMode,
          vatPct: input.vatPct,
          netAmount: amounts.net.toFixed(2),
          vatAmount: amounts.vat.toFixed(2),
          total: amounts.total.toFixed(2),
          currency: input.currency,
          installments: plan.length,
          adjustInstallments: input.adjustInstallments && plan.length > 0,
          notes: input.notes ?? null,
          createdById: this.tenantContext.getUserId() ?? null,
        },
      });
      if (plan.length) {
        await tx.feeInstallment.createMany({
          data: plan.map((p) => ({ tenantId, feeId: fee.id, n: p.n, dueDate: p.dueDate, amount: p.amount.toFixed(2) })),
        });
      }
      if (input.shares.length) {
        await tx.feeShare.createMany({
          data: input.shares.map((s, k) => ({
            tenantId,
            feeId: fee.id,
            counterparty: s.counterparty,
            pct: s.pct,
            amount: split.shares[k].toFixed(2),
            currency: input.currency,
            notes: s.notes ?? null,
          })),
        });
      }
      if (input.staff.length) {
        await tx.staffCommission.createMany({
          data: input.staff.map((s, k) => ({
            tenantId,
            feeId: fee.id,
            userId: s.userId ?? null,
            personId: s.personId ?? null,
            pct: s.pct,
            baseAmount: split.staffBase.toFixed(2),
            amount: split.staff[k].toFixed(2),
            currency: input.currency,
            notes: s.notes ?? null,
          })),
        });
      }
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'Fee',
        entityId: fee.id,
        after: auditJson({ ...fee, installments: plan, shares: input.shares, staff: input.staff }),
        metadata: { operation: 'fee-create', groupId },
      });
      created.push(fee.id);
    }
    this.logger.log('Fees created', { kind: input.kind, count: created.length });
    return created;
  }

  /** Contrato, período, propiedad y tasación del honorario; un honorario de alquiler necesita contrato. */
  private async resolveScope(tx: Db, input: CreateFeeInput) {
    let contractId = input.contractId ?? null;
    let propertyId = input.propertyId ?? null;
    if (input.contractPeriodId) {
      const period = await tx.contractPeriod.findFirst({ where: { id: input.contractPeriodId }, select: { id: true, contractId: true } });
      if (!period) throw notFound('CONTRACT_PERIOD_NOT_FOUND', 'Contract period not found');
      if (contractId && contractId !== period.contractId) {
        throw badRequest('PERIOD_CONTRACT_MISMATCH', 'The period belongs to another contract');
      }
      contractId = period.contractId;
    }
    if (contractId) {
      const contract = await tx.contract.findFirst({ where: { id: contractId }, select: { id: true, propertyId: true } });
      if (!contract) throw notFound('CONTRACT_NOT_FOUND', 'Contract not found');
      propertyId = propertyId ?? contract.propertyId;
    } else if (RENTAL_KINDS.includes(input.kind)) {
      throw badRequest('CONTRACT_REQUIRED', 'A rental fee needs a contract');
    }
    if (input.valuationId) {
      const valuation = await tx.propertyValuation.findFirst({ where: { id: input.valuationId }, select: { propertyId: true } });
      if (!valuation) throw notFound('VALUATION_NOT_FOUND', 'Valuation not found');
      propertyId = propertyId ?? valuation.propertyId;
    }
    if (propertyId && !(await tx.property.findFirst({ where: { id: propertyId }, select: { id: true } }))) {
      throw notFound('PROPERTY_NOT_FOUND', 'Property not found');
    }
    return { contractId, contractPeriodId: input.contractPeriodId ?? null, propertyId };
  }

  /** Quienes pagan y quienes cobran comisión existen en la inmobiliaria. */
  private async assertPeople(tx: Db, input: { payers?: { personId: string }[]; staff?: { userId?: string | null; personId?: string | null }[] }) {
    const personIds = [
      ...new Set([...(input.payers ?? []).map((p) => p.personId), ...(input.staff ?? []).flatMap((s) => (s.personId ? [s.personId] : []))]),
    ];
    if (personIds.length) {
      const found = await tx.person.count({ where: { id: { in: personIds } } });
      if (found !== personIds.length) throw notFound('PERSON_NOT_FOUND', 'Person not found');
    }
    const userIds = [...new Set((input.staff ?? []).flatMap((s) => (s.userId ? [s.userId] : [])))];
    if (userIds.length) {
      const found = await tx.user.count({ where: { id: { in: userIds } } });
      if (found !== userIds.length) throw notFound('USER_NOT_FOUND', 'User not found');
    }
  }

  // ─── Cambios ────────────────────────────────────────

  async update(id: string, data: unknown) {
    const input = parseOrThrow(UpdateFeeSchema, data, 'Invalid fee data');
    const current = await this.load(this.prisma.client, id);
    await this.prisma.client.$transaction(async (tx: Db) => {
      const updated = await tx.fee.update({ where: { id }, data: { notes: input.notes ?? null } });
      await this.audit.record(tx, { action: 'UPDATE', entity: 'Fee', entityId: id, before: auditJson(current), after: auditJson(updated) });
    });
    return this.findOne(id);
  }

  /** Anula un honorario sin cuotas cobradas ni comisiones pagadas: sus cuotas pendientes quedan anuladas. */
  async cancel(id: string, data: unknown) {
    const input = parseOrThrow(CancelFeeSchema, data, 'Invalid cancellation');
    await this.prisma.client.$transaction(async (tx: Db) => {
      const fee = await this.load(tx, id);
      if (fee.status === FeeStatus.Anulado) throw conflict('FEE_CANCELLED', 'The fee is already cancelled');
      const paid = await tx.feeInstallment.count({ where: { feeId: id, status: FeeInstallmentStatus.Pagada } });
      if (paid > 0) throw conflict('FEE_HAS_PAYMENTS', 'A fee with collected installments cannot be cancelled');
      const paidCommissions = await tx.staffCommission.count({ where: { feeId: id, paidAt: { not: null } } });
      if (paidCommissions > 0) throw conflict('FEE_HAS_PAID_COMMISSIONS', 'A fee with paid staff commissions cannot be cancelled');
      await tx.feeInstallment.updateMany({
        where: { feeId: id, status: FeeInstallmentStatus.Pendiente },
        data: { status: FeeInstallmentStatus.Anulada },
      });
      const updated = await tx.fee.update({
        where: { id },
        data: { status: FeeStatus.Anulado, cancelledAt: new Date(), cancelReason: input.reason },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Fee',
        entityId: id,
        before: auditJson(fee),
        after: auditJson(updated),
        metadata: { operation: 'fee-cancel', reason: input.reason },
      });
    });
    return this.findOne(id);
  }

  /** Agrega una inmobiliaria con la que se comparte el honorario; las comisiones sin pagar se recalculan. */
  async addShare(id: string, data: unknown) {
    const input = parseOrThrow(FeeShareInputSchema, data, 'Invalid co-brokerage share');
    const tenantId = this.tenantContext.getTenantId()!;
    await this.prisma.client.$transaction(async (tx: Db) => {
      const fee = await this.loadOpen(tx, id);
      const share = await tx.feeShare.create({
        data: { tenantId, feeId: id, counterparty: input.counterparty, pct: input.pct, amount: '0', currency: fee.currency, notes: input.notes ?? null },
      });
      await this.redistribute(tx, tenantId, fee);
      await this.audit.record(tx, { action: 'CREATE', entity: 'FeeShare', entityId: share.id, after: auditJson(share) });
    });
    return this.findOne(id);
  }

  async removeShare(id: string, shareId: string) {
    const tenantId = this.tenantContext.getTenantId()!;
    await this.prisma.client.$transaction(async (tx: Db) => {
      const fee = await this.loadOpen(tx, id);
      const share = await tx.feeShare.findFirst({ where: { id: shareId, feeId: id } });
      if (!share) throw notFound('FEE_SHARE_NOT_FOUND', 'Co-brokerage share not found');
      await tx.feeShare.delete({ where: { id: shareId } });
      await this.redistribute(tx, tenantId, fee);
      await this.audit.record(tx, { action: 'DELETE', entity: 'FeeShare', entityId: shareId, before: auditJson(share) });
    });
    return this.findOne(id);
  }

  /** Agrega la comisión de una persona del personal (usuario o persona). */
  async addStaffCommission(id: string, data: unknown) {
    const input = parseOrThrow(StaffCommissionInputSchema, data, 'Invalid staff commission');
    const tenantId = this.tenantContext.getTenantId()!;
    await this.prisma.client.$transaction(async (tx: Db) => {
      const fee = await this.loadOpen(tx, id);
      await this.assertPeople(tx, { staff: [input] });
      const commission = await tx.staffCommission.create({
        data: {
          tenantId,
          feeId: id,
          userId: input.userId ?? null,
          personId: input.personId ?? null,
          pct: input.pct,
          baseAmount: '0',
          amount: '0',
          currency: fee.currency,
          notes: input.notes ?? null,
        },
      });
      await this.redistribute(tx, tenantId, fee);
      await this.audit.record(tx, { action: 'CREATE', entity: 'StaffCommission', entityId: commission.id, after: auditJson(commission) });
    });
    return this.findOne(id);
  }

  async removeStaffCommission(id: string, commissionId: string) {
    const tenantId = this.tenantContext.getTenantId()!;
    await this.prisma.client.$transaction(async (tx: Db) => {
      const fee = await this.loadOpen(tx, id);
      const commission = await tx.staffCommission.findFirst({ where: { id: commissionId, feeId: id } });
      if (!commission) throw notFound('STAFF_COMMISSION_NOT_FOUND', 'Staff commission not found');
      if (commission.paidAt) throw conflict('STAFF_COMMISSION_PAID', 'A paid staff commission cannot be removed');
      await tx.staffCommission.delete({ where: { id: commissionId } });
      await this.redistribute(tx, tenantId, fee);
      await this.audit.record(tx, { action: 'DELETE', entity: 'StaffCommission', entityId: commissionId, before: auditJson(commission) });
    });
    return this.findOne(id);
  }

  /**
   * Recalcula el coorretaje y las comisiones sin pagar con el motor; las ya
   * pagadas no cambian (se pagaron con el reparto de ese momento).
   */
  private async redistribute(tx: Db, tenantId: string, fee: any) {
    const defaults = await this.operationalDefaults.get(tenantId, tx);
    const shares: any[] = await tx.feeShare.findMany({ where: { feeId: fee.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const staff: any[] = await tx.staffCommission.findMany({ where: { feeId: fee.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    let split: ReturnType<typeof distributeFee>;
    try {
      split = distributeFee({
        net: String(fee.netAmount),
        sharesPct: shares.map((s) => String(s.pct)),
        staffPct: staff.map((s) => String(s.pct)),
        staffBase: defaults.fees.staffCommissionBase,
      });
    } catch (error) {
      rethrowFeeEngine(error);
    }
    for (const [k, s] of shares.entries()) {
      await tx.feeShare.update({ where: { id: s.id }, data: { amount: split.shares[k].toFixed(2) } });
    }
    for (const [k, s] of staff.entries()) {
      if (s.paidAt) continue;
      await tx.staffCommission.update({
        where: { id: s.id },
        data: { baseAmount: split.staffBase.toFixed(2), amount: split.staff[k].toFixed(2) },
      });
    }
  }

  private async load(db: Db, id: string) {
    const fee = await db.fee.findFirst({ where: { id } });
    if (!fee) throw notFound('FEE_NOT_FOUND', 'Fee not found');
    return fee;
  }

  private async loadOpen(db: Db, id: string) {
    const fee = await this.load(db, id);
    if (fee.status === FeeStatus.Anulado) throw conflict('FEE_CANCELLED', 'The fee is cancelled');
    return fee;
  }
}
