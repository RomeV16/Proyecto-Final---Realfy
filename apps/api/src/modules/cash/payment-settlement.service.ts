import { Injectable } from '@nestjs/common';
import {
  CashCategory,
  CashDirection,
  CommissionType,
  PaymentFlow,
  PaymentReceiver,
  SettlementError,
  receiptSeriesFor,
  settlePayment,
} from '@realfy/shared';
import type { CommissionConfig, LessorDirectOwes, OperationalDefaults, SettlementResult } from '@realfy/shared';
import Decimal from 'decimal.js';
import { AuditService } from '../../common/audit/audit.service';
import { nextDocumentNumber } from '../../common/document-sequence/document-sequence';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { getLessorsAt, getParty } from '../contracts/contract-parties';
import { pickTermsAt, resolveRule } from '../contracts/contract-terms';
import { CashService } from './cash.service';
import { postPayment } from '../owner-accounts/ledger-posting';
import { auditJson, badRequest, notFound } from './cash.errors';

type Db = any;

export interface PaymentCashInput {
  receivedBy?: PaymentReceiver | null;
  accountId?: string | null;
  inCustody?: boolean | null;
  receivedByUserId?: string | null;
}

export interface PaymentCashContext {
  tenantId: string;
  /** Liquidación con sus renglones (ya con el punitorio, si se cobró). */
  liquidacion: { id: string; contractId: string; period: Date; currency: string; lineItems: any[] };
  /** El cobro recién creado en la misma transacción. */
  payment: { id: string; amount: Decimal.Value; method: string; paidAt: Date };
  /** Lo cobrado antes de este pago. */
  paidBefore: Decimal.Value;
  input: PaymentCashInput;
}

/** Reparto guardado en `payments.settlement` (importes como texto con 2 decimales). */
function serializeSettlement(r: SettlementResult) {
  const s = (v: Decimal.Value) => new Decimal(v).toFixed(2);
  return {
    flow: r.flow,
    currency: r.currency,
    enteHeldBy: r.enteHeldBy,
    buckets: Object.fromEntries(Object.entries(r.buckets).map(([k, v]) => [k, s(v)])),
    payment: Object.fromEntries(Object.entries(r.payment).map(([k, v]) => [k, s(v)])),
    agencyCash: s(r.agencyCash),
    custodyTotal: s(r.custodyTotal),
    positions: r.positions.map((p) => ({
      personId: p.personId,
      share: s(p.share),
      received: s(p.received),
      custody: s(p.custody),
      balance: s(p.balance),
    })),
    compensations: r.compensations.map((c) => ({ fromLessorId: c.fromLessorId, toLessorId: c.toLessorId, amount: s(c.amount) })),
  };
}

/** Comisión con que se reparte: la pactada en el contrato o, sin ella, el porcentaje de la inmobiliaria. */
export function commissionFor(contract: any, currency: string, defaults: OperationalDefaults): CommissionConfig {
  const agreed = contract?.commission;
  if (!agreed) return { type: CommissionType.FixedPercent, percentage: String(defaults.commissionPct) };
  if (agreed.currency !== currency && agreed.type !== CommissionType.FixedPercent) {
    throw new SettlementError(
      'SETTLEMENT_CURRENCY_MISMATCH',
      `La comisión del contrato es un monto en ${agreed.currency} y la liquidación está en ${currency}`,
    );
  }
  return {
    type: agreed.type,
    percentage: agreed.percentage?.toString() ?? null,
    fixedAmount: agreed.fixedAmount?.toString() ?? null,
    adminFee: agreed.adminFee?.toString() ?? null,
  };
}

/**
 * Lo que un cobro deja en la caja (ADR-0012), en la transacción que lo registra:
 * quién lo recibió (por defecto, según el flujo de pago del contrato), el
 * reparto entre inmobiliaria, entes y locadores (settlement-engine), los
 * movimientos de la cuenta de la inmobiliaria y de las custodias, y el recibo
 * numerado, que se emite una sola vez con el cobro.
 */
@Injectable()
export class PaymentSettlementService {
  constructor(
    private readonly cash: CashService,
    private readonly operationalDefaults: OperationalDefaultsService,
    private readonly audit: AuditService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async record(tx: Db, ctx: PaymentCashContext) {
    const { tenantId, liquidacion, payment, input } = ctx;
    const contract = await tx.contract.findFirst({
      where: { id: liquidacion.contractId },
      include: { commission: true, termsVersions: true, lessors: true, persons: true },
    });
    if (!contract) throw notFound('CONTRACT_NOT_FOUND', 'Contract not found');
    const defaults = await this.operationalDefaults.get(tenantId, tx);

    const versions: any[] = contract.termsVersions ?? [];
    const terms =
      pickTermsAt(versions, liquidacion.period) ??
      [...versions].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime())[0] ??
      null;
    const flowRule = resolveRule(defaults, terms, 'paymentFlow');
    // Lo que debe el locador que cobró: el pactado en el contrato o el de la inmobiliaria (ADR-0009).
    const lessorDirectOwes = resolveRule(defaults, terms, 'lessorDirectOwes') as LessorDirectOwes;
    const receivedBy: PaymentReceiver =
      input.receivedBy ??
      (input.accountId || input.inCustody || flowRule !== PaymentFlow.TodoLocador
        ? PaymentReceiver.Inmobiliaria
        : PaymentReceiver.Locador);
    const inCustody = receivedBy === PaymentReceiver.Inmobiliaria && !!input.inCustody;
    if (receivedBy === PaymentReceiver.Locador && input.accountId) {
      throw badRequest('VALIDATION_ERROR', 'A payment received by the lessor has no agency account');
    }

    const receivedByUserId = await this.receiver(tx, input.receivedByUserId, receivedBy);

    let settlement: SettlementResult | null = null;
    let settlementError: { code: string; message: string } | null = null;
    try {
      const lessors = await getLessorsAt(tx, contract, liquidacion.period);
      settlement = settlePayment({
        currency: liquidacion.currency,
        lines: liquidacion.lineItems.map((li: any) => ({
          amount: li.amount.toString(),
          beneficiary: li.beneficiary,
          commissionable: li.commissionable,
          currency: li.currency,
          type: li.type,
        })),
        commission: commissionFor(contract, liquidacion.currency, defaults),
        lessors: lessors.map((l: any) => ({ personId: l.personId, payoutPct: l.payoutPct.toString() })),
        paidBefore: ctx.paidBefore,
        amount: payment.amount,
        receivedBy,
        inCustody,
        options: { lessorDirectOwes, partialAllocation: defaults.cash.partialAllocation },
      });
    } catch (error) {
      if (!(error instanceof SettlementError)) throw error;
      // Lo que entra a la caja o al banco se registra igual; sin reparto no se puede
      // guardar en custodia ni saber cuánto debe el locador que cobró.
      if (receivedBy === PaymentReceiver.Locador || inCustody) throw badRequest(error.code, error.message);
      settlementError = { code: error.code, message: error.message };
    }

    let accountId: string | null = null;
    if (receivedBy === PaymentReceiver.Inmobiliaria) {
      const account = await this.cash.resolveAgencyAccount(tx, tenantId, {
        accountId: input.accountId,
        currency: liquidacion.currency,
        method: payment.method,
      });
      accountId = account.id;
      await this.writeMovements(tx, { tenantId, contract, liquidacion, payment, accountId: account.id, settlement });
    }

    let receiptId: string | null = null;
    if (receivedBy === PaymentReceiver.Inmobiliaria || defaults.cash.receiptWhenLessorReceives) {
      const series = receiptSeriesFor(defaults.cash.receiptSeries, { currency: liquidacion.currency, accountId });
      const number = await nextDocumentNumber(tx, tenantId, series);
      const receipt = await tx.receipt.create({
        data: {
          tenantId,
          series,
          number,
          issuedAt: payment.paidAt,
          amount: new Decimal(payment.amount).toFixed(2),
          currency: liquidacion.currency,
        },
      });
      receiptId = receipt.id;
    }

    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        receivedBy,
        accountId,
        inCustody,
        receiptId,
        receivedByUserId,
        settlement: settlement ? serializeSettlement(settlement) : { error: settlementError },
      },
      include: { receipt: true, account: { select: { id: true, name: true, kind: true, currency: true } } },
    });
    // Cuenta corriente de cada locador (ADR-0009): en la misma transacción, una sola vez por cobro.
    const ledgerEntries = settlement
      ? await postPayment(
          tx,
          { tenantId, closeDay: defaults.ownerAccounts.statementCloseDay, userId: this.tenantContext.getUserId() ?? null },
          { payment, liquidacion, contract, settlement },
        )
      : 0;
    await this.audit.record(tx, {
      action: 'CREATE',
      entity: 'Payment',
      entityId: payment.id,
      after: auditJson({ ...updated, settlement: undefined }),
      metadata: { operation: 'payment-register', flow: settlement?.flow ?? null, settlementError, ledgerEntries },
    });
    return updated;
  }

  /** Quién recibió en la oficina: el indicado o, si cobró la inmobiliaria, quien registra. */
  private async receiver(tx: Db, userId: string | null | undefined, receivedBy: PaymentReceiver) {
    if (userId) {
      const user = await tx.user.findFirst({ where: { id: userId }, select: { id: true } });
      if (!user) throw notFound('USER_NOT_FOUND', 'User not found');
      return userId;
    }
    return receivedBy === PaymentReceiver.Inmobiliaria ? (this.tenantContext.getUserId() ?? null) : null;
  }

  /** Entrada en la cuenta de la inmobiliaria y, en custodia, en la cuenta de cada locador. */
  private async writeMovements(
    tx: Db,
    ctx: {
      tenantId: string;
      contract: any;
      liquidacion: PaymentCashContext['liquidacion'];
      payment: PaymentCashContext['payment'];
      accountId: string;
      settlement: SettlementResult | null;
    },
  ) {
    const { tenantId, contract, liquidacion, payment, accountId, settlement } = ctx;
    const date = new Date(`${payment.paidAt.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const common = {
      tenantId,
      date,
      currency: liquidacion.currency,
      contractId: contract.id,
      sourceType: 'Payment',
      sourceId: payment.id,
    };
    const agencyCash = settlement ? settlement.agencyCash : new Decimal(payment.amount);
    if (agencyCash.gt(0)) {
      await this.cash.recordMovement(tx, {
        ...common,
        accountId,
        direction: CashDirection.In,
        amount: agencyCash,
        category: CashCategory.AlquilerCobrado,
        counterpartyId: getParty<any>(contract, 'Inquilino')?.personId ?? null,
      });
    }
    for (const position of settlement?.positions ?? []) {
      if (!position.custody.gt(0)) continue;
      const custody = await this.cash.ensureCustodyAccount(tx, tenantId, position.personId, liquidacion.currency);
      await this.cash.recordMovement(tx, {
        ...common,
        accountId: custody.id,
        direction: CashDirection.In,
        amount: position.custody,
        category: CashCategory.Custodia,
        counterpartyId: position.personId,
      });
    }
  }
}
