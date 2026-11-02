import { Injectable, Logger } from '@nestjs/common';
import {
  CashCategory,
  CashDirection,
  ConfirmMoveOutSchema,
  CreateMoveOutSchema,
  DepositHolder,
  DepositStatus,
  FinancialAccountKind,
  FollowUpKind,
  Money,
  MoveOutItemKind,
  MoveOutPreviewQuerySchema,
  MoveOutStatus,
  OwnerLedgerEntryType,
  PendingChargeKind,
  PendingChargeStatus,
  ChargeTarget,
  computeMoveOut,
  depositRefundAmount,
  refundDueDate,
  todayInAR,
} from '@realfy/shared';
import type { MoveOutItem } from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { auditJson, badRequest, conflict, dayStart, notFound } from '../cash/cash.errors';
import { CashService } from '../cash/cash.service';
import { getParty } from '../contracts/contract-parties';
import { writeEntries } from '../owner-accounts/ledger-posting';
import { PenaltiesService } from '../penalties/penalties.service';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { collectedOf, DepositsService } from './deposits.service';
import { rentStepsOf } from './deposit-rent';
import { collectMoveOutItems } from './move-out-items';

type Db = any;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Renglones que, si el locador tiene que dar su conformidad, la exigen. */
const NEEDS_APPROVAL: readonly string[] = [MoveOutItemKind.Deduccion, MoveOutItemKind.Reparacion];

/**
 * Liquidación de egreso (el "chequeo"): lo que el inquilino debe al irse (alquileres sin
 * cobrar, punitorios, servicios sin facturar, cargos, reparaciones y descuentos) contra
 * el depósito que corresponde devolver. La vista previa no guarda nada; el borrador se
 * edita y se confirma una sola vez.
 */
@Injectable()
export class MoveOutService {
  private readonly logger = new Logger(MoveOutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
    private readonly deposits: DepositsService,
    private readonly penalties: PenaltiesService,
    private readonly defaults: OperationalDefaultsService,
  ) {}

  /** `POST /contracts/:id/move-out/preview?date=&rate=`: renglones y totales a esa fecha. No persiste nada. */
  async preview(contractId: string, query: unknown) {
    const q = parseOrThrow(MoveOutPreviewQuerySchema, query ?? {}, 'Invalid move-out preview');
    const date = q.date ? dayStart(q.date) : todayInAR();
    const base = await this.basis(this.prisma.client, contractId, date);
    const items = await collectMoveOutItems(this.prisma.client, this.penalties, {
      tenantId: this.tenantContext.getTenantId()!,
      contractId,
      date,
      currency: base.currency,
      rate: q.rate,
    });
    return { ...base.summary, rate: q.rate ?? null, items, ...this.totals(items, base) };
  }

  /** `POST /contracts/:id/move-out`: crea o reemplaza el borrador con los renglones editados. */
  async create(contractId: string, data: unknown) {
    const input = parseOrThrow(CreateMoveOutSchema, data, 'Invalid move-out');
    const tenantId = this.tenantContext.getTenantId()!;
    const date = dayStart(input.date);
    return this.prisma.client.$transaction(async (tx: Db) => {
      const base = await this.basis(tx, contractId, date);
      const existing = await tx.moveOutSettlement.findFirst({ where: { contractId } });
      if (existing?.status === MoveOutStatus.Confirmada) {
        throw conflict('MOVE_OUT_CONFIRMED', 'The move-out settlement was already confirmed');
      }
      const items: MoveOutItem[] = input.items.map((i) => ({ ...i, sourceType: i.sourceType ?? null, sourceId: i.sourceId ?? null }));
      const totals = this.totals(items, base);
      const row = {
        date,
        currency: base.currency,
        items: items as any,
        totalOwed: totals.totalOwed,
        depositAvailable: totals.depositAvailable,
        netAmount: totals.netAmount,
        rate: input.rate ?? null,
        notes: input.notes ?? null,
      };
      const saved = existing
        ? await tx.moveOutSettlement.update({ where: { id: existing.id }, data: row })
        : await tx.moveOutSettlement.create({
            data: { ...row, tenantId, contractId, createdById: this.tenantContext.getUserId() ?? null },
          });
      await this.audit.record(tx, {
        action: existing ? 'UPDATE' : 'CREATE',
        entity: 'MoveOutSettlement',
        entityId: saved.id,
        before: existing ? auditJson(existing) : undefined,
        after: auditJson(saved),
      });
      return saved;
    });
  }

  /** `GET /contracts/:id/move-out`: la liquidación del contrato, si hay. */
  async getForContract(contractId: string) {
    const settlement = await this.prisma.client.moveOutSettlement.findFirst({ where: { contractId } });
    return { settlement: settlement ?? null };
  }

  async get(id: string) {
    const settlement = await this.prisma.client.moveOutSettlement.findFirst({ where: { id } });
    if (!settlement) throw notFound('MOVE_OUT_NOT_FOUND', 'Move-out settlement not found');
    return settlement;
  }

  /**
   * `POST /move-outs/:id/confirm`: cierra la liquidación una sola vez. Devuelve el
   * depósito (cuando lo guarda la inmobiliaria sale de su cuenta o de la custodia del
   * locador; si lo guarda el locador, su cuenta corriente registra lo retenido), imputa
   * los cargos y las partes de boletas incluidos, deja el saldo que el inquilino todavía
   * debe como cargo pendiente y tilda el paso "Devolución del depósito" del seguimiento.
   */
  async confirm(id: string, data: unknown) {
    const input = parseOrThrow(ConfirmMoveOutSchema, data ?? {}, 'Invalid move-out confirmation');
    const tenantId = this.tenantContext.getTenantId()!;
    const userId = this.tenantContext.getUserId() ?? null;
    const { deposits: depositDefaults, ownerAccounts } = await this.defaults.get(tenantId);
    return this.prisma.client.$transaction(async (tx: Db) => {
      const settlement = await tx.moveOutSettlement.findFirst({ where: { id } });
      if (!settlement) throw notFound('MOVE_OUT_NOT_FOUND', 'Move-out settlement not found');
      if (settlement.status === MoveOutStatus.Confirmada) {
        throw conflict('MOVE_OUT_ALREADY_CONFIRMED', 'The move-out settlement was already confirmed');
      }
      const items = settlement.items as unknown as MoveOutItem[];
      if (
        depositDefaults.deductionsNeedLessorApproval &&
        !input.lessorApproved &&
        items.some((i) => i.included && NEEDS_APPROVAL.includes(i.kind))
      ) {
        throw conflict('LESSOR_APPROVAL_REQUIRED', 'The deductions need the lessor approval');
      }
      const claimed = await tx.moveOutSettlement.updateMany({
        where: { id, status: MoveOutStatus.Borrador },
        data: { status: MoveOutStatus.Confirmada, confirmedAt: new Date(), confirmedById: userId },
      });
      if (claimed.count === 0) throw conflict('MOVE_OUT_ALREADY_CONFIRMED', 'The move-out settlement was already confirmed');

      const contractId: string = settlement.contractId;
      const base = await this.basis(tx, contractId, settlement.date);
      const result = computeMoveOut({
        items,
        refundable: base.refundable.toFixed(2),
        collectedShare: base.collectedShare.toFixed(6),
      });
      const contract = await tx.contract.findFirst({
        where: { id: contractId },
        include: { persons: { include: { person: { select: { id: true } } } } },
      });
      const deposit = base.deposit;

      let movementId: string | null = null;
      if (result.refundToTenant.gt(0) && deposit?.heldBy === DepositHolder.Inmobiliaria) {
        const account = await this.deposits.holdingAccount(tx, tenantId, deposit, {
          accountId: input.accountId,
          method: input.method,
        });
        if (account.kind === FinancialAccountKind.Custodia) {
          const balance = (await this.cash.balances(tx, [account.id])).get(account.id) ?? new Money(0);
          if (new Money(balance.toString()).lt(result.refundToTenant)) {
            throw conflict('CUSTODY_INSUFFICIENT', 'The custody account does not hold enough to refund the deposit');
          }
        }
        const movement = await this.cash.recordMovement(tx, {
          tenantId,
          accountId: account.id,
          date: settlement.date,
          direction: CashDirection.Out,
          amount: result.refundToTenant.toFixed(2),
          currency: base.currency,
          category: CashCategory.Deposito,
          counterpartyId: getParty<any>(contract, 'Inquilino')?.person?.id ?? null,
          contractId,
          sourceType: 'MoveOutSettlement',
          sourceId: id,
          note: input.note ?? 'Devolución del depósito en la liquidación de egreso',
        });
        movementId = movement.id;
      }

      if (deposit?.heldBy === DepositHolder.Locador && deposit.heldByPersonId && result.retained.gt(0)) {
        await writeEntries(
          tx,
          { tenantId, closeDay: ownerAccounts.statementCloseDay, userId },
          [
            {
              personId: deposit.heldByPersonId,
              type: OwnerLedgerEntryType.CobroDirecto,
              amount: result.retained.negated().toFixed(2),
              currency: base.currency,
              date: settlement.date,
              description: 'Depósito retenido por el locador, aplicado a las deudas del egreso',
              sourceType: 'MoveOutSettlement',
              sourceId: id,
              contractId,
              propertyId: contract?.propertyId ?? null,
            },
          ],
        );
      }

      const included = items.filter((i) => i.included);
      const ids = (type: string) => included.filter((i) => i.sourceType === type && i.sourceId).map((i) => i.sourceId as string);
      const chargeIds = ids('PendingCharge');
      if (chargeIds.length > 0) {
        await tx.pendingCharge.updateMany({
          where: { id: { in: chargeIds }, contractId, status: PendingChargeStatus.Pendiente },
          data: { status: PendingChargeStatus.Imputado, imputedAt: new Date() },
        });
      }
      const allocationIds = ids('ServiceBillAllocation');
      if (allocationIds.length > 0) {
        await tx.serviceBillAllocation.updateMany({
          where: { id: { in: allocationIds }, contractId, billedAt: null },
          data: { billedAt: new Date() },
        });
      }
      if (result.owedByTenant.gt(0)) {
        await tx.pendingCharge.create({
          data: {
            tenantId,
            propertyId: contract.propertyId,
            contractId,
            chargedTo: ChargeTarget.Inquilino,
            kind: PendingChargeKind.Otro,
            description: `Saldo de la liquidación de egreso al ${dayKey(settlement.date)}`,
            amount: result.owedByTenant.toFixed(2),
            currency: base.currency,
            incurredAt: settlement.date,
            sourceType: 'MoveOutSettlement',
            sourceId: id,
            createdById: userId,
          },
        });
      }

      if (deposit) {
        await tx.contractDeposit.update({
          where: { id: deposit.id },
          data: {
            status: DepositStatus.Devuelto,
            refundedAt: settlement.date,
            refundedAmount: result.refundToTenant.toFixed(2),
          },
        });
      }
      const followUps = await tx.contractFollowUp.findMany({
        where: { contractId, kind: FollowUpKind.Devolucion },
        select: { id: true },
      });
      if (followUps.length > 0) {
        await tx.followUpTask.updateMany({
          where: { followUpId: { in: followUps.map((f: any) => f.id) }, code: 'DEPOSITO', done: false },
          data: { done: true, doneAt: new Date(), doneById: userId },
        });
      }

      const confirmed = await tx.moveOutSettlement.update({
        where: { id },
        data: {
          cashMovementId: movementId,
          totalOwed: result.totalOwed.toFixed(2),
          depositAvailable: result.depositAvailable.toFixed(2),
          netAmount: result.net.toFixed(2),
        },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'MoveOutSettlement',
        entityId: id,
        after: auditJson(confirmed),
        metadata: {
          operation: 'move-out-confirm',
          refundToTenant: result.refundToTenant.toFixed(2),
          owedByTenant: result.owedByTenant.toFixed(2),
          movementId,
        },
      });
      this.logger.log('Move-out confirmed', { contractId, id });
      return confirmed;
    });
  }

  /** Totales con la regla y el depósito del contrato. */
  private totals(items: readonly MoveOutItem[], base: Awaited<ReturnType<MoveOutService['basis']>>) {
    const r = computeMoveOut({
      items,
      refundable: base.refundable.toFixed(2),
      collectedShare: base.collectedShare.toFixed(6),
    });
    return {
      totalOwed: r.totalOwed.toFixed(2),
      depositAvailable: r.depositAvailable.toFixed(2),
      retained: r.retained.toFixed(2),
      refundToTenant: r.refundToTenant.toFixed(2),
      owedByTenant: r.owedByTenant.toFixed(2),
      netAmount: r.net.toFixed(2),
    };
  }

  /** Depósito, moneda y monto a devolver a la fecha del egreso. */
  async basis(db: Db, contractId: string, date: Date) {
    const contract = await db.contract.findFirst({
      where: { id: contractId },
      include: { adjustments: true },
    });
    if (!contract) throw notFound('CONTRACT_NOT_FOUND', 'Contract not found');
    const deposit = await db.contractDeposit.findFirst({ where: { contractId }, include: { installmentRows: true } });
    const currency: string = deposit?.currency ?? contract.rentCurrency;
    let refundable = new Money(0);
    let collectedShare = new Money(1);
    if (deposit) {
      const collected = collectedOf(deposit.installmentRows);
      const paidDates = deposit.installmentRows.filter((r: any) => r.paidAt).map((r: any) => r.paidAt.getTime());
      refundable = depositRefundAmount({
        amount: deposit.amount.toString(),
        refundRule: deposit.refundRule,
        rentSteps: rentStepsOf(contract, contract.adjustments),
        depositDate: paidDates.length > 0 ? new Date(Math.min(...paidDates)) : contract.startDate,
        refundDate: date,
      });
      collectedShare = new Money(deposit.amount.toString()).gt(0)
        ? collected.div(deposit.amount.toString())
        : new Money(0);
    }
    return {
      deposit,
      currency,
      refundable,
      collectedShare,
      summary: {
        contractId,
        date: dayKey(date),
        currency,
        deposit: deposit
          ? {
              id: deposit.id,
              amount: deposit.amount.toString(),
              currency: deposit.currency,
              heldBy: deposit.heldBy,
              refundRule: deposit.refundRule,
              refundInstallments: deposit.refundInstallments,
              refundDueDate: dayKey(refundDueDate(date, deposit.refundDueDays)),
              refundable: refundable.toFixed(2),
              collected: collectedOf(deposit.installmentRows).toFixed(2),
            }
          : null,
      },
    };
  }

  /** Para el PDF: la liquidación y el contrato con sus partes. */
  async detailForPdf(id: string) {
    const settlement = await this.get(id);
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: settlement.contractId },
      include: {
        property: true,
        persons: { include: { person: true } },
        lessors: { include: { person: true } },
      },
    });
    const deposit = await this.prisma.client.contractDeposit.findFirst({ where: { contractId: settlement.contractId } });
    return { settlement, contract, deposit };
  }
}
