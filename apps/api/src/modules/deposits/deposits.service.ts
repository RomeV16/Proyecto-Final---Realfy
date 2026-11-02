import { Injectable, Logger } from '@nestjs/common';
import {
  CashCategory,
  CashDirection,
  CollectDepositInstallmentSchema,
  DepositHolder,
  DepositStatus,
  FinancialAccountKind,
  Money,
  UpsertDepositSchema,
  depositSchedule,
  depositStatusFor,
  sumMoney,
  todayInAR,
} from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { auditJson, badRequest, conflict, dayStart, notFound } from '../cash/cash.errors';
import { CashService } from '../cash/cash.service';
import { getParty } from '../contracts/contract-parties';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';

type Db = any;

const DEPOSIT_INCLUDE = {
  installmentRows: { orderBy: { number: 'asc' } },
  heldByPerson: { select: { id: true, firstName: true, lastName: true } },
} as const;

/** Importe cobrado: la suma de las cuotas con fecha de cobro. */
export function collectedOf(rows: ReadonlyArray<{ amount: unknown; paidAt: Date | null }>): Money {
  return sumMoney(rows.filter((r) => r.paidAt).map((r) => String(r.amount)));
}

/**
 * Depósito en garantía de un contrato (D9): importe y moneda, quién lo guarda,
 * cuotas y regla de devolución. Cobrar una cuota que guarda la inmobiliaria
 * entra a su caja o, si es dinero de un locador, a la custodia de ese locador.
 */
@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
    private readonly defaults: OperationalDefaultsService,
  ) {}

  /** `GET /contracts/:id/deposit`: el depósito con sus cuotas y los valores por defecto de la inmobiliaria. */
  async get(contractId: string) {
    const tenantId = this.tenantContext.getTenantId()!;
    await this.findContract(this.prisma.client, contractId);
    const deposit = await this.prisma.client.contractDeposit.findFirst({
      where: { contractId },
      include: DEPOSIT_INCLUDE,
    });
    const { deposits } = await this.defaults.get(tenantId);
    return { deposit: deposit ? this.present(deposit) : null, defaults: deposits };
  }

  /**
   * `PUT /contracts/:id/deposit`: alta o cambio. Con cuotas ya cobradas solo se
   * cambian la regla y el plazo de devolución, quién lo guarda y las notas; el importe, la moneda y las
   * cuotas no. Se mantiene al día `Contract.depositAmount` (en desuso) para las
   * plantillas de contrato.
   */
  async upsert(contractId: string, data: unknown) {
    const input = parseOrThrow(UpsertDepositSchema, data, 'Invalid deposit');
    const tenantId = this.tenantContext.getTenantId()!;
    const { deposits } = await this.defaults.get(tenantId);
    return this.prisma.client.$transaction(async (tx: Db) => {
      const contract = await this.findContract(tx, contractId);
      if (input.heldByPersonId) {
        const person = await tx.person.findFirst({ where: { id: input.heldByPersonId }, select: { id: true } });
        if (!person) throw badRequest('HOLDER_NOT_FOUND', 'The person who holds the deposit does not exist');
      }
      const existing = await tx.contractDeposit.findFirst({
        where: { contractId },
        include: { installmentRows: true },
      });
      if (existing?.status === DepositStatus.Devuelto) {
        throw conflict('DEPOSIT_REFUNDED', 'The deposit was already refunded');
      }
      const paid = existing ? existing.installmentRows.filter((r: any) => r.paidAt) : [];
      const sameShape =
        existing &&
        new Money(existing.amount.toString()).eq(input.amount) &&
        existing.currency === input.currency &&
        existing.installments === input.installments;
      if (paid.length > 0 && !sameShape) {
        throw conflict('DEPOSIT_HAS_PAYMENTS', 'The amount, currency and installments cannot change once an installment was collected');
      }
      if (paid.length > 0 && existing.heldBy !== input.heldBy) {
        throw conflict('DEPOSIT_HAS_PAYMENTS', 'Who holds the deposit cannot change once an installment was collected');
      }

      const data = {
        amount: input.amount,
        currency: input.currency,
        heldBy: input.heldBy,
        heldByPersonId: input.heldByPersonId ?? null,
        installments: input.installments,
        refundRule: input.refundRule,
        refundInstallments: input.refundInstallments,
        refundDueDays: input.refundDueDays ?? existing?.refundDueDays ?? deposits.refundDueDays,
        notes: input.notes ?? null,
      };
      const deposit = existing
        ? await tx.contractDeposit.update({ where: { id: existing.id }, data })
        : await tx.contractDeposit.create({ data: { ...data, tenantId, contractId } });

      if (paid.length === 0) {
        await tx.contractDepositInstallment.deleteMany({ where: { depositId: deposit.id } });
        const first = input.firstDueDate ? dayStart(input.firstDueDate) : dayStart(contract.startDate.toISOString());
        await tx.contractDepositInstallment.createMany({
          data: depositSchedule(input.amount, input.installments, first).map((row) => ({
            tenantId,
            depositId: deposit.id,
            number: row.number,
            dueDate: row.dueDate,
            amount: row.amount,
          })),
        });
        await tx.contractDeposit.update({ where: { id: deposit.id }, data: { status: DepositStatus.Pendiente } });
      }
      await tx.contract.update({
        where: { id: contractId },
        data: { depositAmount: input.amount, depositCurrency: input.currency },
      });
      const result = await tx.contractDeposit.findFirst({ where: { id: deposit.id }, include: DEPOSIT_INCLUDE });
      await this.audit.record(tx, {
        action: existing ? 'UPDATE' : 'CREATE',
        entity: 'ContractDeposit',
        entityId: deposit.id,
        before: existing ? auditJson(existing) : undefined,
        after: auditJson(result),
      });
      return this.present(result);
    });
  }

  /**
   * `POST /contracts/:id/deposit/installments/:number/collect`: cobra una cuota.
   * Si la guarda el locador solo se anota (no pasa por la caja); si la guarda la
   * inmobiliaria entra a la cuenta indicada, y con un locador dueño del dinero, a su custodia.
   * Una cuota se cobra una sola vez.
   */
  async collectInstallment(contractId: string, number: number, data: unknown) {
    const input = parseOrThrow(CollectDepositInstallmentSchema, data, 'Invalid installment collection');
    const tenantId = this.tenantContext.getTenantId()!;
    return this.prisma.client.$transaction(async (tx: Db) => {
      const contract = await this.findContract(tx, contractId, true);
      const deposit = await tx.contractDeposit.findFirst({ where: { contractId }, include: { installmentRows: true } });
      if (!deposit) throw notFound('DEPOSIT_NOT_FOUND', 'The contract has no deposit');
      if (deposit.status === DepositStatus.Devuelto) throw conflict('DEPOSIT_REFUNDED', 'The deposit was already refunded');
      const row = deposit.installmentRows.find((r: any) => r.number === number);
      if (!row) throw notFound('INSTALLMENT_NOT_FOUND', 'Installment not found');
      const paidAt = input.paidAt ? dayStart(input.paidAt) : todayInAR();

      const claimed = await tx.contractDepositInstallment.updateMany({
        where: { id: row.id, paidAt: null },
        data: { paidAt },
      });
      if (claimed.count === 0) throw conflict('INSTALLMENT_ALREADY_COLLECTED', 'The installment was already collected');

      let movementId: string | null = null;
      if (deposit.heldBy === DepositHolder.Inmobiliaria) {
        const tenantPerson = getParty<any>(contract, 'Inquilino')?.person;
        const account = deposit.heldByPersonId
          ? await this.cash.ensureCustodyAccount(tx, tenantId, deposit.heldByPersonId, deposit.currency)
          : await this.cash.resolveAgencyAccount(tx, tenantId, {
              accountId: input.accountId,
              currency: deposit.currency,
              method: input.method,
            });
        const movement = await this.cash.recordMovement(tx, {
          tenantId,
          accountId: account.id,
          date: paidAt,
          direction: CashDirection.In,
          amount: String(row.amount),
          currency: deposit.currency,
          category: CashCategory.Deposito,
          counterpartyId: tenantPerson?.id ?? null,
          contractId,
          sourceType: 'DepositInstallment',
          sourceId: row.id,
          note: input.note ?? `Cuota ${row.number}/${deposit.installments} del depósito`,
        });
        movementId = movement.id;
        await tx.contractDepositInstallment.update({ where: { id: row.id }, data: { cashMovementId: movementId } });
      }

      const rows = await tx.contractDepositInstallment.findMany({ where: { depositId: deposit.id }, orderBy: { number: 'asc' } });
      const status = depositStatusFor({ amount: deposit.amount.toString(), collected: collectedOf(rows).toFixed(2) });
      await tx.contractDeposit.update({ where: { id: deposit.id }, data: { status } });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'ContractDeposit',
        entityId: deposit.id,
        metadata: { operation: 'deposit-installment-collect', number, amount: String(row.amount), movementId },
      });
      this.logger.log('Deposit installment collected', { contractId, number });
      const result = await tx.contractDeposit.findFirst({ where: { id: deposit.id }, include: DEPOSIT_INCLUDE });
      return this.present(result);
    });
  }

  /** Cuenta donde está el dinero del depósito (para devolverlo): custodia del locador o caja/banco de la moneda. */
  async holdingAccount(tx: Db, tenantId: string, deposit: any, ctx: { accountId?: string | null; method: string }) {
    const account = deposit.heldByPersonId
      ? await this.cash.ensureCustodyAccount(tx, tenantId, deposit.heldByPersonId, deposit.currency)
      : await this.cash.resolveAgencyAccount(tx, tenantId, { ...ctx, currency: deposit.currency });
    if (account.kind === FinancialAccountKind.Custodia) {
      await this.cash.lockAccount(tx, tenantId, account.id);
    }
    return account;
  }

  private present(deposit: any) {
    const collected = collectedOf(deposit.installmentRows ?? []);
    return {
      ...deposit,
      collectedAmount: collected.toFixed(2),
      pendingAmount: Money.max(new Money(deposit.amount.toString()).minus(collected), new Money(0)).toFixed(2),
    };
  }

  private async findContract(db: Db, contractId: string, withParties = false) {
    const contract = await db.contract.findFirst({
      where: { id: contractId },
      include: withParties ? { persons: { include: { person: { select: { id: true, firstName: true, lastName: true } } } } } : undefined,
    });
    if (!contract) throw notFound('CONTRACT_NOT_FOUND', 'Contract not found');
    return contract;
  }
}
