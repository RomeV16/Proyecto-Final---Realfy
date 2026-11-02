import { Injectable } from '@nestjs/common';
import {
  CashCategory,
  CashDirection,
  CompensationScope,
  CreateCompensationSchema,
  FinancialAccountKind,
  PaymentMethod,
  checkCompensation,
  personName,
  todayInAR,
} from '@realfy/shared';
import Decimal from 'decimal.js';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { getLessorsAt } from '../contracts/contract-parties';
import { CashService } from './cash.service';
import { postCompensation } from '../owner-accounts/ledger-posting';
import { auditJson, badRequest, conflict, notFound, rethrowSettlement } from './cash.errors';

type Db = any;

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;

/**
 * Compensaciones entre locadores (ADR-0012): un cobro que recibió un locador
 * (`from`) y le correspondía, en todo o en parte, a otro locador del contrato
 * (`to`). Queda registrada para la cuenta corriente de cada uno; si `from`
 * tiene efectivo en custodia, la compensación puede pagarse con él.
 */
@Injectable()
export class CompensationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly operationalDefaults: OperationalDefaultsService,
    private readonly cash: CashService,
  ) {}

  async list(query: { paymentId?: string; personId?: string }) {
    const where: Record<string, unknown> = {};
    if (query.paymentId) where.paymentId = query.paymentId;
    if (query.personId) where.OR = [{ fromLessorId: query.personId }, { toLessorId: query.personId }];
    return this.prisma.client.compensation.findMany({
      where,
      include: { fromLessor: PERSON, toLessor: PERSON },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: unknown) {
    const input = parseOrThrow(CreateCompensationSchema, data, 'Invalid compensation');
    const tenantId = this.tenantContext.getTenantId()!;
    const { cash, ownerAccounts } = await this.operationalDefaults.get(tenantId);

    return this.prisma.client.$transaction(async (tx: Db) => {
      const payment = await tx.payment.findFirst({
        where: { id: input.paymentId },
        include: { liquidacion: { include: { contract: { include: { lessors: true } } } }, compensations: true },
      });
      if (!payment) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
      const from = await tx.person.findFirst({
        where: { id: input.fromLessorId },
        select: { id: true, _count: { select: { lessorships: true } } },
      });
      if (!from) throw notFound('PERSON_NOT_FOUND', 'Lessor not found');
      if (from._count.lessorships === 0) {
        throw badRequest('COMPENSATION_OUT_OF_SCOPE', 'Only a lessor of the agency can cover another lessor');
      }

      const lessors = await getLessorsAt(tx, payment.liquidacion.contract, payment.liquidacion.period);
      const amount = input.amount ?? this.pendingShare(payment, input.toLessorId);
      let checked: Decimal;
      try {
        checked = checkCompensation({
          paymentAmount: payment.amount.toString(),
          receivedBy: payment.receivedBy,
          alreadyCompensated: payment.compensations.map((c: any) => c.amount.toString()),
          amount,
          fromLessorId: input.fromLessorId,
          toLessorId: input.toLessorId,
          contractLessorIds: lessors.map((l: any) => l.personId),
          scope: cash.compensationScope as CompensationScope,
        });
      } catch (error) {
        rethrowSettlement(error);
      }

      const compensation = await tx.compensation.create({
        data: {
          tenantId,
          paymentId: payment.id,
          fromLessorId: input.fromLessorId,
          toLessorId: input.toLessorId,
          amount: checked.toFixed(2),
          currency: payment.currency,
          note: input.note ?? null,
          createdById: this.tenantContext.getUserId() ?? null,
        },
        include: { fromLessor: PERSON, toLessor: PERSON },
      });
      const movements = input.fromCustody
        ? await this.payFromCustody(tx, { tenantId, payment, compensation, toAccountId: input.toAccountId ?? null })
        : [];
      // Cuenta corriente: resta a quien cobró y suma a quien le correspondía (ADR-0009).
      await postCompensation(
        tx,
        { tenantId, closeDay: ownerAccounts.statementCloseDay, userId: this.tenantContext.getUserId() ?? null },
        {
          compensation,
          contract: payment.liquidacion.contract,
          period: payment.liquidacion.period,
          date: todayInAR(),
          names: { from: personName(compensation.fromLessor), to: personName(compensation.toLessor) },
        },
      );
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'Compensation',
        entityId: compensation.id,
        after: auditJson(compensation),
        metadata: { operation: 'compensation', fromCustody: !!input.fromCustody },
      });
      return { ...compensation, movements };
    });
  }

  /** Parte de `to` en el cobro (según el reparto guardado) menos lo ya compensado a su favor. */
  private pendingShare(payment: any, toLessorId: string): string {
    const position = payment.settlement?.positions?.find((p: any) => p.personId === toLessorId);
    if (!position) {
      throw badRequest('VALIDATION_ERROR', 'The payment has no share for that lessor: indicate the amount');
    }
    const done = payment.compensations
      .filter((c: any) => c.toLessorId === toLessorId)
      .reduce((acc: Decimal, c: any) => acc.plus(c.amount.toString()), new Decimal(0));
    return new Decimal(position.share).minus(done).toFixed(2);
  }

  /**
   * El efectivo que la inmobiliaria guarda para `from` cubre la compensación:
   * sale de su custodia y entra en la cuenta indicada (por defecto, la caja de
   * la moneda), donde queda para `to` como cualquier cobro.
   */
  private async payFromCustody(
    tx: Db,
    ctx: { tenantId: string; payment: any; compensation: any; toAccountId: string | null },
  ) {
    const { tenantId, payment, compensation } = ctx;
    const custody = await tx.financialAccount.findFirst({
      where: { kind: FinancialAccountKind.Custodia, ownerPersonId: compensation.fromLessorId, currency: payment.currency },
    });
    if (!custody) throw conflict('CUSTODY_EMPTY', 'The lessor has no custody account in that currency');
    await this.cash.lockAccount(tx, tenantId, custody.id);
    const balance = (await this.cash.balances(tx, [custody.id])).get(custody.id) ?? new Decimal(0);
    const amount = new Decimal(compensation.amount.toString());
    if (amount.gt(balance)) {
      throw conflict('CUSTODY_INSUFFICIENT', `Only ${balance.toFixed(2)} ${payment.currency} are in custody`);
    }
    const target = await this.cash.resolveAgencyAccount(tx, tenantId, {
      accountId: ctx.toAccountId,
      currency: payment.currency,
      method: PaymentMethod.Efectivo,
    });
    const common = {
      tenantId,
      date: todayInAR(),
      amount,
      currency: payment.currency,
      category: CashCategory.Compensacion,
      contractId: payment.liquidacion.contractId,
      sourceType: 'Compensation',
      sourceId: compensation.id,
    };
    const out = await this.cash.recordMovement(tx, {
      ...common,
      accountId: custody.id,
      direction: CashDirection.Out,
      counterpartyId: compensation.fromLessorId,
    });
    const inbound = await this.cash.recordMovement(tx, {
      ...common,
      accountId: target.id,
      direction: CashDirection.In,
      counterpartyId: compensation.toLessorId,
    });
    return [out, inbound];
  }
}
