import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AgencyExpenseSchema,
  BulkPendingChargesSchema,
  CashCategory,
  CashDirection,
  ChargeTarget,
  CommissionType,
  CreatePendingChargeSchema,
  LineBeneficiary,
  LiquidacionStatus,
  PendingChargeFilterSchema,
  PendingChargeKind,
  PendingChargeStatus,
  UpdatePendingChargeSchema,
  UpfrontBasis,
  calculateCommission,
  pendingChargeLine,
  requiresUpfront,
  signedChargeAmount,
  splitInstallments,
  todayInAR,
} from '@realfy/shared';
import type { CreatePendingChargeInput, LiquidationExtraLine } from '@realfy/shared';
import { randomUUID } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { pickTermsAt, resolveRule } from '../contracts/contract-terms';
import { CashService } from '../cash/cash.service';
import Decimal from 'decimal.js';

type Db = any;

export type BulkChargeRowResult =
  | { index: number; status: 'created'; chargeIds: string[] }
  | { index: number; status: 'error'; error: { code: string; message: string } };

const notFound = (error: string, message: string) => new NotFoundException({ error, message });
const conflict = (error: string, message: string) => new ConflictException({ error, message });
const badRequest = (error: string, message: string) => new BadRequestException({ error, message });

const dayStart = (value: string): Date => new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
const monthStart = (date: Date): Date => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const addMonths = (date: Date, months: number): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));

/** "YYYY-MM" (o una fecha) -> primer día del mes, a medianoche UTC. */
const parsePeriod = (value: string): Date => monthStart(dayStart(value.length === 7 ? `${value}-01` : value));

const INCLUDE = {
  property: { select: { id: true, title: true } },
  contract: { select: { id: true, propertyId: true, status: true } },
  lessor: { select: { id: true, firstName: true, lastName: true } },
} as const;

/**
 * Centro de carga: gastos y cargos puntuales del mes que se imputan una sola vez,
 * al inquilino en su próxima liquidación o al locador en su próximo estado
 * (ADR-0010). Un cargo al inquilino que supera el umbral de anticipo no entra solo
 * en la liquidación: queda marcado para pedir el anticipo.
 */
@Injectable()
export class ChargesService {
  private readonly logger = new Logger(ChargesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly operationalDefaults: OperationalDefaultsService,
    private readonly cash: CashService,
  ) {}

  // ─── Lectura ────────────────────────────────────────

  async findAll(query: unknown) {
    const filters = parseOrThrow(PendingChargeFilterSchema, query, 'Invalid filter parameters');
    const where: Record<string, unknown> = {};
    if (filters.contractId) where.contractId = filters.contractId;
    if (filters.propertyId) where.propertyId = filters.propertyId;
    if (filters.status) where.status = filters.status;
    if (filters.chargedTo) where.chargedTo = filters.chargedTo;
    if (filters.requiresUpfront !== undefined) where.requiresUpfront = filters.requiresUpfront;
    if (filters.period) {
      const from = parsePeriod(filters.period);
      const to = addMonths(from, 1);
      where.OR = [
        { targetPeriod: { gte: from, lt: to } },
        { targetPeriod: null, incurredAt: { gte: from, lt: to } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.client.pendingCharge.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ incurredAt: 'desc' }, { createdAt: 'desc' }, { installmentNo: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.pendingCharge.count({ where }),
    ]);
    return { items, total, page: filters.page, limit: filters.limit, totalPages: Math.ceil(total / filters.limit) };
  }

  async findOne(id: string) {
    const charge = await this.prisma.client.pendingCharge.findFirst({ where: { id }, include: INCLUDE });
    if (!charge) throw notFound('CHARGE_NOT_FOUND', 'Charge not found');
    return charge;
  }

  // ─── Alta ───────────────────────────────────────────

  /**
   * Carga un cargo; con cuotas crea uno por mes (mayor resto). Devuelve todos
   * los cargos creados. Cada uno decide por su importe si pide anticipo.
   */
  async create(data: unknown): Promise<{ items: any[] }> {
    const input = parseOrThrow(CreatePendingChargeSchema, data, 'Invalid charge data');
    const items = await this.prisma.client.$transaction((tx: Db) => this.createIn(tx, input));
    return { items };
  }

  /**
   * Crea los cargos de un alta ya validada dentro de la transacción de quien llama
   * (la imputación de una incidencia lo usa para que el cargo y la marca de
   * imputado sean atómicos). Con `settled` el cargo nace Imputado: ya está
   * resuelto (la inmobiliaria absorbe un gasto que ya salió de su caja) y ninguna
   * liquidación ni estado lo toma.
   */
  async createIn(tx: Db, input: CreatePendingChargeInput, opts: { settled?: boolean } = {}): Promise<any[]> {
    const tenantId = this.tenantContext.getTenantId()!;
    const { propertyId, contract } = await this.resolveScope(input);
    if (input.lessorPersonId) {
      const person = await this.prisma.client.person.findFirst({ where: { id: input.lessorPersonId } });
      if (!person) throw notFound('PERSON_NOT_FOUND', 'Lessor person not found');
    }

    const kind = input.kind as PendingChargeKind;
    const total = signedChargeAmount(kind, input.amount);
    const parts = splitInstallments(total, input.installments);
    const incurredAt = dayStart(input.incurredAt);
    // Con cuotas sin mes elegido, la primera va a la próxima liquidación y las demás una por mes.
    const firstPeriod = input.targetPeriod
      ? parsePeriod(input.targetPeriod)
      : input.installments > 1
        ? monthStart(incurredAt)
        : null;
    const groupId = input.installments > 1 ? randomUUID() : null;
    const beneficiary =
      kind === PendingChargeKind.HonorarioGestion ? LineBeneficiary.Inmobiliaria : input.beneficiary;
    const upfront =
      input.chargedTo === ChargeTarget.Inquilino && !opts.settled
        ? await this.upfrontEvaluator(tenantId, contract, input.currency, incurredAt)
        : null;

    const created: any[] = [];
    for (const [index, amount] of parts.entries()) {
      const row = await tx.pendingCharge.create({
        data: {
          tenantId,
          propertyId,
          contractId: contract?.id ?? null,
          chargedTo: input.chargedTo,
          lessorPersonId: input.lessorPersonId ?? null,
          kind,
          description: input.description,
          amount,
          currency: input.currency,
          beneficiary,
          incurredAt,
          targetPeriod: firstPeriod ? addMonths(firstPeriod, index) : null,
          requiresUpfront: upfront ? upfront(amount) : false,
          installmentNo: index + 1,
          installmentOf: parts.length,
          installmentGroupId: groupId,
          sourceType: input.sourceType ?? null,
          sourceId: input.sourceId ?? null,
          notes: input.notes ?? null,
          createdById: this.tenantContext.getUserId() ?? null,
          ...(opts.settled ? { status: PendingChargeStatus.Imputado, imputedAt: new Date() } : {}),
        },
        include: INCLUDE,
      });
      await this.audit.record(tx, { action: 'CREATE', entity: 'PendingCharge', entityId: row.id, after: snapshot(row) });
      created.push(row);
    }
    this.logger.log('Charge created', { propertyId, contractId: contract?.id, count: created.length });
    return created;
  }

  /** Carga una planilla: cada fila se valida y se guarda por separado, y se informa el resultado de cada una. */
  async bulk(data: unknown): Promise<{ results: BulkChargeRowResult[]; created: number; failed: number }> {
    const { rows } = parseOrThrow(BulkPendingChargesSchema, data, 'Invalid bulk charges');
    const results: BulkChargeRowResult[] = [];
    for (const [index, row] of rows.entries()) {
      try {
        const { items } = await this.create(row);
        results.push({ index, status: 'created', chargeIds: items.map((c) => c.id) });
      } catch (error) {
        const body = (error as { getResponse?: () => any }).getResponse?.();
        const detail = body?.details?.[0];
        results.push({
          index,
          status: 'error',
          error: {
            code: body?.error ?? 'CHARGE_ERROR',
            message: detail?.message ? `${detail.path?.join?.('.') ?? ''} ${detail.message}`.trim() : (body?.message ?? 'Error'),
          },
        });
      }
    }
    const created = results.filter((r) => r.status === 'created').length;
    return { results, created, failed: results.length - created };
  }

  // ─── Cambios ────────────────────────────────────────

  /**
   * Corrige un cargo Pendiente. Si cambia el importe se vuelve a evaluar el
   * anticipo, salvo que el pedido lo indique: `requiresUpfront: false` fuerza
   * a imputarlo en la liquidación aunque supere el umbral.
   */
  async update(id: string, data: unknown) {
    const input = parseOrThrow(UpdatePendingChargeSchema, data, 'Invalid charge data');
    const tenantId = this.tenantContext.getTenantId()!;
    const current = await this.findOne(id);
    this.assertPending(current, 'CHARGE_NOT_EDITABLE');

    const patch: Record<string, unknown> = {};
    if (input.description !== undefined) patch.description = input.description;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.incurredAt !== undefined) patch.incurredAt = dayStart(input.incurredAt);
    if (input.targetPeriod !== undefined) patch.targetPeriod = input.targetPeriod ? parsePeriod(input.targetPeriod) : null;
    if (input.beneficiary !== undefined) {
      patch.beneficiary =
        current.kind === PendingChargeKind.HonorarioGestion ? LineBeneficiary.Inmobiliaria : input.beneficiary;
    }
    if (input.amount !== undefined) patch.amount = signedChargeAmount(current.kind, input.amount);

    if (input.requiresUpfront !== undefined) {
      if (input.requiresUpfront && current.chargedTo !== ChargeTarget.Inquilino) {
        throw badRequest('UPFRONT_NOT_APPLICABLE', 'Only a charge to the tenant can require an upfront payment');
      }
      patch.requiresUpfront = input.requiresUpfront;
    } else if (input.amount !== undefined && current.chargedTo === ChargeTarget.Inquilino) {
      const contract = await this.prisma.client.contract.findFirst({
        where: { id: current.contractId ?? undefined },
        include: { commission: true, termsVersions: true },
      });
      const evaluate = await this.upfrontEvaluator(tenantId, contract, current.currency, current.incurredAt);
      patch.requiresUpfront = evaluate(patch.amount as string);
    }

    const updated = await this.prisma.client.$transaction(async (tx: Db) => {
      const result = await tx.pendingCharge.updateMany({
        where: { id, status: PendingChargeStatus.Pendiente },
        data: patch,
      });
      if (result.count !== 1) throw conflict('CHARGE_NOT_EDITABLE', 'The charge is no longer pending');
      const row = await tx.pendingCharge.findFirst({ where: { id }, include: INCLUDE });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'PendingCharge',
        entityId: id,
        before: snapshot(current),
        after: snapshot(row),
      });
      return row;
    });
    return updated;
  }

  /** Anula un cargo Pendiente (no se borra: queda en el historial). */
  async cancel(id: string) {
    return this.transition(id, 'CHARGE_NOT_CANCELLABLE', { status: PendingChargeStatus.Anulado });
  }

  /** Registra que el inquilino pagó el cargo por adelantado, fuera de la liquidación. */
  async markPaidUpfront(id: string) {
    const current = await this.findOne(id);
    if (current.chargedTo !== ChargeTarget.Inquilino) {
      throw badRequest('UPFRONT_NOT_APPLICABLE', 'Only a charge to the tenant can be paid upfront');
    }
    return this.transition(id, 'CHARGE_NOT_PENDING', {
      status: PendingChargeStatus.CobradoAnticipado,
      imputedAt: new Date(),
    });
  }

  /**
   * Devuelve a Pendiente un cargo que una liquidación anulada se había llevado.
   * Una liquidación que sigue vigente tiene que anularse o su renglón quitarse
   * primero; un cargo ya descontado en un estado del locador no se libera acá.
   */
  async release(id: string) {
    const current = await this.findOne(id);
    if (current.status !== PendingChargeStatus.Imputado) {
      throw conflict('CHARGE_NOT_IMPUTED', 'Only an imputed charge can be released');
    }
    if (current.imputedStatementId || current.chargedTo === ChargeTarget.Locador) {
      throw conflict('CHARGE_IN_STATEMENT', 'The charge was deducted in the lessor account');
    }
    if (current.chargedTo === ChargeTarget.Inmobiliaria) {
      throw conflict('CHARGE_PAID_BY_AGENCY', 'The charge was closed as an agency expense');
    }
    if (current.imputedLiquidacionId) {
      const liquidacion = await this.prisma.client.liquidacion.findFirst({
        where: { id: current.imputedLiquidacionId },
        select: { status: true },
      });
      if (liquidacion && liquidacion.status !== LiquidacionStatus.Anulada) {
        throw conflict('CHARGE_LIQUIDATION_ACTIVE', 'The liquidación that includes the charge is still active');
      }
    }
    return this.transition(
      id,
      'CHARGE_NOT_IMPUTED',
      { status: PendingChargeStatus.Pendiente, imputedLiquidacionId: null, imputedAt: null },
      PendingChargeStatus.Imputado,
    );
  }

  /**
   * Cierra un cargo a la inmobiliaria como egreso de una de sus cuentas: un
   * movimiento Gasto (o un ingreso, si el cargo es un crédito) con origen en el
   * cargo, y el cargo pasa a Imputado, todo en una transacción (ADR-0012). Es una
   * acción explícita porque al cargarlo no se sabe de qué cuenta sale el dinero.
   */
  async closeAsAgencyExpense(id: string, data: unknown) {
    const input = parseOrThrow(AgencyExpenseSchema, data, 'Invalid agency expense');
    const tenantId = this.tenantContext.getTenantId()!;
    const current = await this.findOne(id);
    if (current.chargedTo !== ChargeTarget.Inmobiliaria) {
      throw badRequest('CHARGE_NOT_AGENCY', 'Only a charge to the agency closes as an agency expense');
    }
    this.assertPending(current, 'CHARGE_NOT_PENDING');
    return this.prisma.client.$transaction(async (tx: Db) => {
      const account = await this.cash.findAccount(tx, input.accountId);
      this.cash.assertOperational(account);
      if (account.currency !== current.currency) {
        throw badRequest('CURRENCY_MISMATCH', `The account is in ${account.currency}, the charge in ${current.currency}`);
      }
      const closed = await tx.pendingCharge.updateMany({
        where: { id, status: PendingChargeStatus.Pendiente },
        data: { status: PendingChargeStatus.Imputado, imputedAt: new Date() },
      });
      if (closed.count !== 1) throw conflict('CHARGE_NOT_PENDING', 'The charge is no longer pending');
      const amount = new Decimal(current.amount.toString());
      const movement = await this.cash.recordMovement(tx, {
        tenantId,
        accountId: account.id,
        date: input.date ? dayStart(input.date) : todayInAR(),
        direction: amount.isNegative() ? CashDirection.In : CashDirection.Out,
        amount: amount.abs(),
        currency: account.currency,
        category: CashCategory.Gasto,
        contractId: current.contractId,
        sourceType: 'PendingCharge',
        sourceId: id,
        note: input.note ?? current.description,
      });
      const updated = await tx.pendingCharge.findFirst({ where: { id }, include: INCLUDE });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'PendingCharge',
        entityId: id,
        before: snapshot(current),
        after: snapshot(updated),
        metadata: { operation: 'agency-expense', movementId: movement.id },
      });
      return { charge: updated, movement };
    });
  }

  // ─── Liquidación ────────────────────────────────────

  /**
   * Renglones de los cargos al inquilino que esperan una liquidación: Pendientes,
   * sin pedido de anticipo, de la moneda del contrato y cuyo mes ya llegó (o sin
   * mes elegido). Quedan fuera los del locador y los de la inmobiliaria.
   */
  async pendingLines(contractId: string, period: Date, currency: string): Promise<LiquidationExtraLine[]> {
    const rows = await this.prisma.client.pendingCharge.findMany({
      where: {
        contractId,
        status: PendingChargeStatus.Pendiente,
        chargedTo: ChargeTarget.Inquilino,
        requiresUpfront: false,
        currency: currency as any,
        OR: [{ targetPeriod: null }, { targetPeriod: { lte: period } }],
      },
      orderBy: [{ incurredAt: 'asc' }, { createdAt: 'asc' }, { installmentNo: 'asc' }],
    });
    return rows.flatMap((row: any) => {
      const line = pendingChargeLine({
        id: row.id,
        kind: row.kind,
        chargedTo: row.chargedTo,
        amount: row.amount.toString(),
        description: row.description,
        beneficiary: row.beneficiary,
        installmentNo: row.installmentNo,
        installmentOf: row.installmentOf,
      });
      return line ? [line] : [];
    });
  }

  /**
   * Marca imputados los cargos que la liquidación incluyó, en la misma
   * transacción que la crea. Si alguno ya no está Pendiente (otra generación se
   * adelantó, o se anuló) falla y la transacción se deshace: un cargo entra en
   * una sola liquidación.
   */
  async markImputed(tx: Db, chargeIds: string[], liquidacionId: string) {
    if (chargeIds.length === 0) return 0;
    const result = await tx.pendingCharge.updateMany({
      where: { id: { in: chargeIds }, status: PendingChargeStatus.Pendiente, requiresUpfront: false },
      data: { status: PendingChargeStatus.Imputado, imputedLiquidacionId: liquidacionId, imputedAt: new Date() },
    });
    if (result.count !== chargeIds.length) {
      throw conflict('CHARGE_ALREADY_IMPUTED', 'A charge was already included in another liquidación');
    }
    return result.count;
  }

  /** Libera los cargos de una liquidación que se borra o de un renglón que se quita: vuelven a Pendiente. */
  async releaseFromLiquidation(tx: Db, where: { liquidacionId?: string; ids?: string[] }) {
    const clauses = [];
    if (where.liquidacionId) clauses.push({ imputedLiquidacionId: where.liquidacionId });
    if (where.ids?.length) clauses.push({ id: { in: where.ids } });
    if (clauses.length === 0) return 0;
    const result = await tx.pendingCharge.updateMany({
      where: { OR: clauses, status: PendingChargeStatus.Imputado, imputedStatementId: null },
      data: { status: PendingChargeStatus.Pendiente, imputedLiquidacionId: null, imputedAt: null },
    });
    return result.count;
  }

  // ─── Internos ───────────────────────────────────────

  private assertPending(charge: { status: string }, code: string) {
    if (charge.status !== PendingChargeStatus.Pendiente) {
      throw conflict(code, `The charge is ${charge.status}, not Pendiente`);
    }
  }

  /** Pasa un cargo de `from` (Pendiente por defecto) a otro estado con la auditoría del antes y el después. */
  private async transition(id: string, code: string, data: Record<string, unknown>, from = PendingChargeStatus.Pendiente) {
    const current = await this.findOne(id);
    if (current.status !== from) throw conflict(code, `The charge is ${current.status}, not ${from}`);
    return this.prisma.client.$transaction(async (tx: Db) => {
      const result = await tx.pendingCharge.updateMany({ where: { id, status: from }, data });
      if (result.count !== 1) throw conflict(code, 'The charge changed while it was being updated');
      const row = await tx.pendingCharge.findFirst({ where: { id }, include: INCLUDE });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'PendingCharge',
        entityId: id,
        before: snapshot(current),
        after: snapshot(row),
      });
      return row;
    });
  }

  /** Propiedad y contrato del cargo; el contrato manda sobre la propiedad y los dos tienen que coincidir. */
  private async resolveScope(input: CreatePendingChargeInput) {
    let contract: any = null;
    if (input.contractId) {
      contract = await this.prisma.client.contract.findFirst({
        where: { id: input.contractId },
        include: { commission: true, termsVersions: true },
      });
      if (!contract) throw notFound('CONTRACT_NOT_FOUND', 'Contract not found');
      if (input.propertyId && input.propertyId !== contract.propertyId) {
        throw badRequest('PROPERTY_MISMATCH', 'The contract belongs to another property');
      }
    }
    const propertyId: string = contract?.propertyId ?? input.propertyId!;
    if (!contract) {
      const property = await this.prisma.client.property.findFirst({ where: { id: propertyId }, select: { id: true } });
      if (!property) throw notFound('PROPERTY_NOT_FOUND', 'Property not found');
    }
    return { propertyId, contract };
  }

  /**
   * Función que dice si un importe supera el umbral de anticipo del contrato.
   * Las reglas rigen a la fecha del gasto: el umbral es el de la versión vigente
   * del contrato (`upfrontThresholdFees`, en comisiones mensuales) o, si no lo
   * fija, el de la inmobiliaria. La comisión mensual depende de `upfrontBasis`:
   * `ComisionPactada` usa la del contrato (o, sin ella, el porcentaje por
   * defecto) y `PorcentajePorDefecto` siempre ese porcentaje sobre el alquiler
   * vigente. En otra moneda que la del alquiler no se compara.
   */
  private async upfrontEvaluator(
    tenantId: string,
    contract: any,
    currency: string,
    at: Date,
  ): Promise<(amount: string) => boolean> {
    if (!contract || contract.rentCurrency !== currency) return () => false;
    const defaults = await this.operationalDefaults.get(tenantId);
    const versions: any[] = contract.termsVersions ?? [];
    const terms = pickTermsAt(versions, at) ?? [...versions].sort((a, b) => a.validFrom - b.validFrom)[0] ?? null;
    const thresholdFees = Number(resolveRule(defaults, terms, 'upfrontThresholdFees'));
    const basis = resolveRule(defaults, terms, 'upfrontBasis');
    const agreed = basis === UpfrontBasis.PorcentajePorDefecto ? null : contract.commission;
    if (agreed && agreed.currency !== contract.rentCurrency && agreed.type !== CommissionType.FixedPercent) {
      return () => false;
    }
    const monthlyCommission = calculateCommission(contract.rentAmount.toString(), {
      type: agreed?.type ?? CommissionType.FixedPercent,
      percentage: agreed ? (agreed.percentage?.toString() ?? null) : String(defaults.commissionPct),
      fixedAmount: agreed?.fixedAmount?.toString() ?? null,
    }).commissionAmount;
    return (amount) => requiresUpfront({ amount, monthlyCommission: monthlyCommission.toString(), thresholdFees });
  }
}

/** Lo que se guarda en la auditoría de un cargo. */
function snapshot(row: any) {
  return {
    status: row.status,
    amount: row.amount?.toString(),
    kind: row.kind,
    chargedTo: row.chargedTo,
    requiresUpfront: row.requiresUpfront,
    contractId: row.contractId,
    propertyId: row.propertyId,
    targetPeriod: row.targetPeriod,
    imputedLiquidacionId: row.imputedLiquidacionId,
  };
}
