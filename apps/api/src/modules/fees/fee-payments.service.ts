import { Injectable, Logger } from '@nestjs/common';
import {
  CashCategory,
  CashDirection,
  FeeInstallmentStatus,
  FeePayerRole,
  FeeSettlement,
  FeeStatus,
  OwnerLedgerEntryType,
  PayFeeInstallmentSchema,
  PayStaffCommissionSchema,
  StaffCommissionFilterSchema,
  personName,
  receiptSeriesFor,
} from '@realfy/shared';
import Decimal from 'decimal.js';
import { AuditService } from '../../common/audit/audit.service';
import { nextDocumentNumber } from '../../common/document-sequence/document-sequence';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { CashService } from '../cash/cash.service';
import { auditJson, badRequest, conflict, dayStart, notFound } from '../cash/cash.errors';
import { writeEntries } from '../owner-accounts/ledger-posting';
import { FeesService } from './fees.service';
import { PERSON_SELECT, installmentLabel } from './fees.helpers';

type Db = any;

/**
 * Cobro de las cuotas de honorarios y pago de las comisiones del personal.
 *
 * - Cuota en `Caja`: entra a la cuenta elegida (o a la caja/banco de la moneda)
 *   como movimiento `Honorario` y se emite un recibo de la serie de cobros.
 * - Cuota en `CuentaLocador` (solo si paga un locador del contrato): no entra
 *   dinero; la inmobiliaria se la descuenta de lo que le debe al locador con un
 *   asiento `Honorario` negativo en su cuenta corriente (ADR-0009), que sale en
 *   su próximo estado de cuenta. No lleva recibo: el comprobante es el estado.
 * - Comisión del personal: sale de una cuenta como `ComisionEmpleado`.
 */
@Injectable()
export class FeePaymentsService {
  private readonly logger = new Logger(FeePaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly operationalDefaults: OperationalDefaultsService,
    private readonly cash: CashService,
    private readonly fees: FeesService,
  ) {}

  async payInstallment(feeId: string, n: number, data: unknown) {
    const input = parseOrThrow(PayFeeInstallmentSchema, data, 'Invalid installment payment');
    const tenantId = this.tenantContext.getTenantId()!;
    const date = dayStart(input.date);
    const result = await this.prisma.client.$transaction(async (tx: Db) => {
      const fee: any = await tx.fee.findFirst({ where: { id: feeId }, include: { installmentRows: { orderBy: { n: 'asc' } } } });
      if (!fee) throw notFound('FEE_NOT_FOUND', 'Fee not found');
      if (fee.status === FeeStatus.Anulado) throw conflict('FEE_CANCELLED', 'The fee is cancelled');
      const installment = fee.installmentRows.find((i: any) => i.n === n);
      if (!installment) throw notFound('FEE_INSTALLMENT_NOT_FOUND', 'Installment not found');
      if (installment.status !== FeeInstallmentStatus.Pendiente) {
        throw conflict('FEE_INSTALLMENT_NOT_PENDING', 'The installment is not pending');
      }
      const due = (await this.fees.dueByFee(tx, [fee])).get(fee.id)?.get(n) ?? String(installment.amount);
      const amount = new Decimal(input.amount ?? due);
      const defaults = await this.operationalDefaults.get(tenantId, tx);

      let receiptId: string | null = null;
      let movementId: string | null = null;
      if (input.settlement === FeeSettlement.CuentaLocador) {
        await this.assertLessorPayer(tx, fee);
        await writeEntries(
          tx,
          { tenantId, closeDay: defaults.ownerAccounts.statementCloseDay, userId: this.tenantContext.getUserId() ?? null },
          [
            {
              personId: fee.payerPersonId,
              type: OwnerLedgerEntryType.Honorario,
              amount: amount.negated(),
              currency: fee.currency,
              date,
              description: installmentLabel(fee, n),
              sourceType: 'FeeInstallment',
              sourceId: installment.id,
              contractId: fee.contractId,
              propertyId: fee.propertyId,
            },
          ],
        );
      } else {
        const account = await this.cash.resolveAgencyAccount(tx, tenantId, {
          accountId: input.accountId,
          currency: fee.currency,
          method: input.method,
        });
        const movement = await this.cash.recordMovement(tx, {
          tenantId,
          accountId: account.id,
          date,
          direction: CashDirection.In,
          amount,
          currency: fee.currency,
          category: CashCategory.Honorario,
          counterpartyId: fee.payerPersonId,
          contractId: fee.contractId,
          sourceType: 'FeeInstallment',
          sourceId: installment.id,
          note: input.note ?? installmentLabel(fee, n),
        });
        movementId = movement.id;
        const series = receiptSeriesFor(defaults.cash.receiptSeries, { currency: fee.currency, accountId: account.id });
        const receipt = await tx.receipt.create({
          data: {
            tenantId,
            series,
            number: await nextDocumentNumber(tx, tenantId, series),
            issuedAt: date,
            amount: amount.toFixed(2),
            currency: fee.currency,
          },
        });
        receiptId = receipt.id;
      }

      // Solo se cobra una cuota pendiente: dos cobros simultáneos no pasan los dos.
      const { count } = await tx.feeInstallment.updateMany({
        where: { id: installment.id, status: FeeInstallmentStatus.Pendiente },
        data: {
          status: FeeInstallmentStatus.Pagada,
          paidAt: date,
          paidAmount: amount.toFixed(2),
          adjustedAmount: new Decimal(due).eq(String(installment.amount)) ? null : new Decimal(due).toFixed(2),
          settlement: input.settlement,
          receiptId,
        },
      });
      if (count !== 1) throw conflict('FEE_INSTALLMENT_NOT_PENDING', 'The installment is not pending');
      const pending = fee.installmentRows.filter((i: any) => i.status === FeeInstallmentStatus.Pendiente && i.n !== n).length;
      const status = pending === 0 ? FeeStatus.Pagado : FeeStatus.Parcial;
      await tx.fee.update({ where: { id: fee.id }, data: { status } });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'FeeInstallment',
        entityId: installment.id,
        before: auditJson(installment),
        after: auditJson({ status: FeeInstallmentStatus.Pagada, paidAt: date, paidAmount: amount.toFixed(2), settlement: input.settlement, receiptId, movementId }),
        metadata: { operation: 'fee-installment-pay', feeId, n },
      });
      return { receiptId, movementId };
    });
    this.logger.log('Fee installment collected', { feeId, n, settlement: input.settlement });
    return { ...(await this.fees.findOne(feeId)), payment: result };
  }

  /** Descontar de la cuenta corriente solo vale si quien paga es locador del contrato. */
  private async assertLessorPayer(tx: Db, fee: any) {
    const lessor =
      fee.payerRole === FeePayerRole.Locador && fee.contractId
        ? await tx.contractLessor.findFirst({ where: { contractId: fee.contractId, personId: fee.payerPersonId }, select: { id: true } })
        : null;
    if (!lessor) {
      throw badRequest('FEE_PAYER_NOT_LESSOR', 'Only a fee paid by a lessor of the contract can be deducted from the lessor account');
    }
  }

  // ─── Comisiones del personal ────────────────────────

  async listStaffCommissions(query: unknown) {
    const filters = parseOrThrow(StaffCommissionFilterSchema, query, 'Invalid filter parameters');
    const where: Record<string, unknown> = {};
    if (filters.paid === 'true') where.paidAt = { not: null };
    if (filters.paid === 'false') where.paidAt = null;
    if (filters.userId) where.userId = filters.userId;
    if (filters.personId) where.personId = filters.personId;
    if (filters.feeId) where.feeId = filters.feeId;
    where.fee = { status: { not: FeeStatus.Anulado } };
    const [rows, total] = await Promise.all([
      this.prisma.client.staffCommission.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
          person: PERSON_SELECT,
          fee: {
            select: {
              id: true,
              kind: true,
              status: true,
              total: true,
              netAmount: true,
              currency: true,
              payer: PERSON_SELECT,
              contract: { select: { id: true, property: { select: { id: true, title: true } } } },
              property: { select: { id: true, title: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.staffCommission.count({ where }),
    ]);
    const items = rows.map((c: any) => ({
      ...c,
      beneficiaryName: c.user ? personName(c.user) : c.person ? personName(c.person) : null,
      fee: { ...c.fee, payerName: c.fee?.payer ? personName(c.fee.payer) : null },
    }));
    return { items, total, page: filters.page, limit: filters.limit, totalPages: Math.ceil(total / filters.limit) };
  }

  /** Paga una comisión: sale de la cuenta elegida como `ComisionEmpleado`. */
  async payStaffCommission(id: string, data: unknown) {
    const input = parseOrThrow(PayStaffCommissionSchema, data, 'Invalid commission payment');
    const tenantId = this.tenantContext.getTenantId()!;
    const date = dayStart(input.date);
    return this.prisma.client.$transaction(async (tx: Db) => {
      const commission: any = await tx.staffCommission.findFirst({
        where: { id },
        include: { fee: { select: { id: true, kind: true, status: true, contractId: true } }, user: { select: { firstName: true, lastName: true } } },
      });
      if (!commission) throw notFound('STAFF_COMMISSION_NOT_FOUND', 'Staff commission not found');
      if (commission.fee.status === FeeStatus.Anulado) throw conflict('FEE_CANCELLED', 'The fee is cancelled');
      if (commission.paidAt) throw conflict('STAFF_COMMISSION_PAID', 'The commission is already paid');
      const account = await this.cash.findAccount(tx, input.accountId);
      this.cash.assertOperational(account);
      if (account.currency !== commission.currency) {
        throw badRequest('CURRENCY_MISMATCH', `The account is in ${account.currency}, the commission in ${commission.currency}`);
      }
      const label = `Comisión por ${installmentLabel({ kind: commission.fee.kind, installments: 1 }, 1).toLowerCase()}`;
      const movement = await this.cash.recordMovement(tx, {
        tenantId,
        accountId: account.id,
        date,
        direction: CashDirection.Out,
        amount: String(commission.amount),
        currency: commission.currency,
        category: CashCategory.ComisionEmpleado,
        counterpartyId: commission.personId ?? null,
        contractId: commission.fee.contractId ?? null,
        sourceType: 'StaffCommission',
        sourceId: commission.id,
        note: input.note ?? (commission.user ? `${label} — ${personName(commission.user)}` : label),
      });
      const { count } = await tx.staffCommission.updateMany({ where: { id, paidAt: null }, data: { paidAt: date } });
      if (count !== 1) throw conflict('STAFF_COMMISSION_PAID', 'The commission is already paid');
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'StaffCommission',
        entityId: id,
        before: auditJson(commission),
        after: auditJson({ paidAt: date, movementId: movement.id }),
        metadata: { operation: 'staff-commission-pay' },
      });
      return { ...commission, paidAt: date, movement };
    });
  }
}
