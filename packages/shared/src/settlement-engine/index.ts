import { Money, allocateLargestRemainder, round2, sumMoney } from '../money';
import type { MoneyInput } from '../money';
import { LessorDirectOwes, LineBeneficiary, PaymentReceiver } from '../enums';
import { calculateCommission, InvalidCommissionError } from '../commission-engine';
import type { CommissionConfig } from '../commission-engine';

// ─── Opciones (valores por defecto de la inmobiliaria) ──

/** Qué le debe el locador a la inmobiliaria cuando el inquilino le paga directamente (pactable por contrato). */
export { LessorDirectOwes };

/** Cómo se reparte un pago parcial entre inmobiliaria, entes y locadores. */
export enum PartialAllocation {
  /** En proporción a lo que le toca a cada uno en la liquidación. */
  Proporcional = 'Proporcional',
  /** Primero la inmobiliaria; el resto, en proporción entre entes y locadores. */
  InmobiliariaPrimero = 'InmobiliariaPrimero',
}

/** Entre quiénes se admite una compensación. */
export enum CompensationScope {
  /** Cualquier locador de la inmobiliaria puede cubrir a un locador del contrato. */
  CualquierLocador = 'CualquierLocador',
  /** Solo entre locadores del mismo contrato. */
  MismoContrato = 'MismoContrato',
}

export interface SettlementOptions {
  lessorDirectOwes: LessorDirectOwes;
  partialAllocation: PartialAllocation;
}

export const DEFAULT_SETTLEMENT_OPTIONS: SettlementOptions = {
  lessorDirectOwes: LessorDirectOwes.TodoLoAjeno,
  partialAllocation: PartialAllocation.Proporcional,
};

// ─── Tipos ──────────────────────────────────────────────

export interface SettlementLine {
  amount: MoneyInput;
  beneficiary: LineBeneficiary | `${LineBeneficiary}`;
  commissionable: boolean;
  currency?: string | null;
}

export interface SettlementLessor {
  personId: string;
  payoutPct: MoneyInput;
}

export interface SettlementInput {
  currency: string;
  lines: SettlementLine[];
  /** Comisión pactada (o la de la inmobiliaria); null = sin comisión. */
  commission: CommissionConfig | null;
  /** Locadores vigentes con su porcentaje de cobro (suman 100). */
  lessors: SettlementLessor[];
  /** Lo cobrado antes de este pago sobre la misma liquidación. */
  paidBefore?: MoneyInput;
  amount: MoneyInput;
  receivedBy: PaymentReceiver | `${PaymentReceiver}`;
  /** La inmobiliaria guarda la parte de los locadores en custodia hasta entregarla. */
  inCustody?: boolean;
  /** Locador que recibió el pago (flujo directo); sin él, cada locador recibió su parte. */
  receiverPersonId?: string | null;
  options?: Partial<SettlementOptions>;
}

/** Lo que le toca a cada uno en la liquidación completa. */
export interface SettlementBuckets {
  total: Money;
  commissionBase: Money;
  commission: Money;
  adminFee: Money;
  agencyLines: Money;
  /** Comisión + gastos administrativos + renglones de la inmobiliaria. */
  agency: Money;
  ente: Money;
  /** Renglones del locador menos comisión y gastos administrativos. */
  lessors: Money;
}

export interface SettlementPosition {
  personId: string;
  /** Lo que le corresponde de este pago. */
  share: Money;
  /** Lo que recibió en mano (flujo directo). */
  received: Money;
  /** Lo que la inmobiliaria guarda en su custodia. */
  custody: Money;
  /** Positivo: la inmobiliaria le debe; negativo: le debe a la inmobiliaria. */
  balance: Money;
}

export interface SettlementCompensation {
  fromLessorId: string;
  toLessorId: string;
  amount: Money;
}

export type SettlementFlow = 'Inmobiliaria' | 'Custodia' | 'Locador';

export interface SettlementResult {
  flow: SettlementFlow;
  currency: string;
  buckets: SettlementBuckets;
  /** La parte de este pago de cada destino. */
  payment: { amount: Money; agency: Money; ente: Money; lessors: Money };
  /** Lo que entra en la caja o el banco de la inmobiliaria. */
  agencyCash: Money;
  /** Lo que entra en las cuentas de custodia de los locadores. */
  custodyTotal: Money;
  /** Quién guarda la parte de los entes de este pago. */
  enteHeldBy: 'Inmobiliaria' | 'Locador';
  positions: SettlementPosition[];
  compensations: SettlementCompensation[];
}

export type SettlementErrorCode =
  | 'SETTLEMENT_INVALID_AMOUNT'
  | 'SETTLEMENT_CURRENCY_MISMATCH'
  | 'SETTLEMENT_NEGATIVE_SHARE'
  | 'SETTLEMENT_EXCEEDS_TOTAL'
  | 'SETTLEMENT_LESSOR_SHARES'
  | 'SETTLEMENT_CUSTODY_REQUIRES_AGENCY'
  | 'COMPENSATION_REQUIRES_LESSOR_RECEIPT'
  | 'COMPENSATION_SAME_LESSOR'
  | 'COMPENSATION_OUT_OF_SCOPE'
  | 'COMPENSATION_EXCEEDS_PAYMENT';

/** Un reparto que no se puede hacer; `code` es el código de dominio que devuelve la API. */
export class SettlementError extends Error {
  constructor(
    readonly code: SettlementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SettlementError';
  }
}

// ─── Motor ──────────────────────────────────────────────

const ZERO = new Money(0);

/** Cuánto le toca a cada destino de la liquidación completa. */
export function settlementBuckets(
  lines: SettlementLine[],
  commission: CommissionConfig | null,
  currency: string,
): SettlementBuckets {
  for (const line of lines) {
    if (line.currency && line.currency !== currency) {
      throw new SettlementError(
        'SETTLEMENT_CURRENCY_MISMATCH',
        `Un renglón en ${line.currency} no se reparte en ${currency}: no hay conversión implícita`,
      );
    }
  }
  const sumOf = (pick: (l: SettlementLine) => boolean) =>
    sumMoney(lines.filter(pick).map((l) => round2(l.amount)));
  const total = sumOf(() => true);
  const commissionBase = sumOf((l) => l.commissionable);
  const agencyLines = sumOf((l) => l.beneficiary === LineBeneficiary.Inmobiliaria);
  const ente = sumOf((l) => l.beneficiary === LineBeneficiary.Ente);
  const lessorLines = sumOf((l) => l.beneficiary === LineBeneficiary.Locador);

  let commissionAmount = ZERO;
  let adminFee = ZERO;
  if (commission) {
    if (commissionBase.isNegative()) {
      throw new SettlementError('SETTLEMENT_NEGATIVE_SHARE', 'La base de la comisión es negativa');
    }
    try {
      const result = calculateCommission(commissionBase, commission);
      commissionAmount = new Money(result.commissionAmount);
      adminFee = new Money(result.adminFeeAmount);
    } catch (error) {
      if (error instanceof InvalidCommissionError) {
        throw new SettlementError('SETTLEMENT_NEGATIVE_SHARE', error.message);
      }
      throw error;
    }
  }
  const agency = commissionAmount.plus(adminFee).plus(agencyLines);
  const lessors = lessorLines.minus(commissionAmount).minus(adminFee);
  for (const [name, value] of [
    ['la inmobiliaria', agency],
    ['los entes', ente],
    ['los locadores', lessors],
  ] as const) {
    if (value.isNegative()) {
      throw new SettlementError(
        'SETTLEMENT_NEGATIVE_SHARE',
        `La parte de ${name} queda negativa (${value.toFixed(2)})`,
      );
    }
  }
  return { total, commissionBase, commission: commissionAmount, adminFee, agencyLines, agency, ente, lessors };
}

interface Split {
  agency: Money;
  ente: Money;
  lessors: Money;
}

/** Cuánto de cada destino queda cubierto cuando se cobró `paid` de la liquidación. */
function coveredAt(paid: Money, b: SettlementBuckets, mode: PartialAllocation): Split {
  if (paid.eq(b.total)) return { agency: b.agency, ente: b.ente, lessors: b.lessors };
  if (paid.isZero()) return { agency: ZERO, ente: ZERO, lessors: ZERO };
  if (mode === PartialAllocation.InmobiliariaPrimero) {
    const agency = Money.min(paid, b.agency);
    const rest = paid.minus(agency);
    if (rest.isZero()) return { agency, ente: ZERO, lessors: ZERO };
    const [ente, lessors] = allocateLargestRemainder(rest, [b.ente, b.lessors]);
    return { agency, ente, lessors };
  }
  const [agency, ente, lessors] = allocateLargestRemainder(paid, [b.agency, b.ente, b.lessors]);
  return { agency, ente, lessors };
}

/** Reparto acumulado entre locadores: la parte de este pago es la diferencia con lo anterior. */
function lessorSplit(before: Money, after: Money, weights: Money[]): Money[] {
  const at = (value: Money) =>
    value.isZero() ? weights.map(() => ZERO) : allocateLargestRemainder(value, weights);
  const a = at(after);
  const b = at(before);
  return a.map((v, i) => v.minus(b[i]));
}

function proportional(value: Money, weights: Money[]): Money[] {
  return value.isZero() ? weights.map(() => ZERO) : allocateLargestRemainder(value, weights);
}

/**
 * Reparte un pago aplicado a una liquidación entre la inmobiliaria (comisión,
 * gastos administrativos y renglones propios), los entes y cada locador según
 * su porcentaje de cobro, por el método del mayor resto. Los pagos parciales se
 * reparten de forma acumulada, así que la suma de los pagos que saldan la
 * liquidación es exactamente la liquidación.
 *
 * Tres flujos:
 * - la inmobiliaria recibe (caja o banco): guarda la parte de los locadores
 *   hasta pagarla; su saldo con cada locador es positivo;
 * - la inmobiliaria recibe y guarda la parte de los locadores en custodia;
 * - el locador recibe directamente: le debe a la inmobiliaria la comisión, los
 *   renglones de la inmobiliaria y (según la opción) los de entes. Si recibió
 *   otro locador (compensación), ese locador le debe a cada locador su parte.
 *
 * No hay conversión implícita: todo se reparte en la moneda de la liquidación.
 */
export function settlePayment(input: SettlementInput): SettlementResult {
  const options = { ...DEFAULT_SETTLEMENT_OPTIONS, ...(input.options ?? {}) };
  const amount = round2(input.amount);
  const paidBefore = round2(input.paidBefore ?? 0);
  if (!amount.gt(0) || paidBefore.isNegative()) {
    throw new SettlementError('SETTLEMENT_INVALID_AMOUNT', `Importe inválido: ${amount.toFixed(2)}`);
  }
  const buckets = settlementBuckets(input.lines, input.commission, input.currency);
  const paidAfter = paidBefore.plus(amount);
  if (paidAfter.gt(buckets.total)) {
    throw new SettlementError(
      'SETTLEMENT_EXCEEDS_TOTAL',
      `Lo cobrado (${paidAfter.toFixed(2)}) supera el total de la liquidación (${buckets.total.toFixed(2)})`,
    );
  }
  const receivedBy = input.receivedBy as PaymentReceiver;
  if (input.inCustody && receivedBy !== PaymentReceiver.Inmobiliaria) {
    throw new SettlementError(
      'SETTLEMENT_CUSTODY_REQUIRES_AGENCY',
      'Solo lo que recibe la inmobiliaria puede quedar en custodia',
    );
  }

  const before = coveredAt(paidBefore, buckets, options.partialAllocation);
  const after = coveredAt(paidAfter, buckets, options.partialAllocation);
  const payment = {
    amount,
    agency: after.agency.minus(before.agency),
    ente: after.ente.minus(before.ente),
    lessors: after.lessors.minus(before.lessors),
  };

  const lessors = input.lessors;
  const weights = lessors.map((l) => new Money(l.payoutPct));
  if (buckets.lessors.gt(0)) {
    const pctSum = sumMoney(weights);
    if (lessors.length === 0 || !pctSum.eq(100) || weights.some((w) => w.isNegative())) {
      throw new SettlementError(
        'SETTLEMENT_LESSOR_SHARES',
        `Los porcentajes de cobro de los locadores suman ${pctSum.toString()} y deben sumar 100`,
      );
    }
  }
  const shares = lessors.length ? lessorSplit(before.lessors, after.lessors, weights) : [];

  const flow: SettlementFlow =
    receivedBy === PaymentReceiver.Locador ? 'Locador' : input.inCustody ? 'Custodia' : 'Inmobiliaria';
  if (flow === 'Locador' && !input.receiverPersonId && lessors.length === 0) {
    throw new SettlementError('SETTLEMENT_LESSOR_SHARES', 'El contrato no tiene locadores vigentes que hayan recibido el cobro');
  }
  const enteHeldBy =
    flow === 'Locador' && options.lessorDirectOwes === LessorDirectOwes.SoloInmobiliaria
      ? 'Locador'
      : 'Inmobiliaria';
  const positions: SettlementPosition[] = lessors.map((l, i) => ({
    personId: l.personId,
    share: shares[i],
    received: ZERO,
    custody: flow === 'Custodia' ? shares[i] : ZERO,
    balance: shares[i],
  }));
  const compensations: SettlementCompensation[] = [];

  if (flow === 'Locador') {
    const owed = enteHeldBy === 'Locador' ? payment.agency : payment.agency.plus(payment.ente);
    const keptForEnte = enteHeldBy === 'Locador' ? payment.ente : ZERO;
    const receiver = input.receiverPersonId ?? null;
    if (!receiver) {
      const owes = proportional(owed, weights);
      const ente = proportional(keptForEnte, weights);
      positions.forEach((p, i) => {
        p.received = p.share.plus(owes[i]).plus(ente[i]);
        p.balance = owes[i].negated();
      });
    } else {
      let holder = positions.find((p) => p.personId === receiver);
      if (!holder) {
        holder = { personId: receiver, share: ZERO, received: ZERO, custody: ZERO, balance: ZERO };
        positions.push(holder);
      }
      holder.received = amount;
      holder.balance = holder.share.plus(keptForEnte).minus(amount);
      for (const p of positions) {
        if (p !== holder && p.share.gt(0)) {
          compensations.push({ fromLessorId: receiver, toLessorId: p.personId, amount: p.share });
        }
      }
    }
  }

  const custodyTotal = sumMoney(positions.map((p) => p.custody));
  return {
    flow,
    currency: input.currency,
    buckets,
    payment,
    agencyCash: flow === 'Locador' ? ZERO : amount.minus(custodyTotal),
    custodyTotal,
    enteHeldBy,
    positions,
    compensations,
  };
}

// ─── Compensaciones ─────────────────────────────────────

export interface CompensationCheck {
  paymentAmount: MoneyInput;
  receivedBy: PaymentReceiver | `${PaymentReceiver}`;
  /** Compensaciones ya registradas sobre el mismo pago. */
  alreadyCompensated: MoneyInput[];
  amount: MoneyInput;
  fromLessorId: string;
  toLessorId: string;
  /** Locadores del contrato del pago. */
  contractLessorIds: string[];
  scope: CompensationScope | `${CompensationScope}`;
}

/**
 * Valida una compensación: el pago lo recibió un locador (`from`) y parte le
 * corresponde a otro locador del contrato (`to`). La suma de las
 * compensaciones de un pago no supera el pago.
 */
export function checkCompensation(input: CompensationCheck): Money {
  const amount = round2(input.amount);
  if (!amount.gt(0)) {
    throw new SettlementError('SETTLEMENT_INVALID_AMOUNT', `Importe inválido: ${amount.toFixed(2)}`);
  }
  if (input.receivedBy !== PaymentReceiver.Locador) {
    throw new SettlementError(
      'COMPENSATION_REQUIRES_LESSOR_RECEIPT',
      'Solo se compensa un cobro que recibió un locador',
    );
  }
  if (input.fromLessorId === input.toLessorId) {
    throw new SettlementError('COMPENSATION_SAME_LESSOR', 'Un locador no se compensa consigo mismo');
  }
  const inContract = new Set(input.contractLessorIds);
  if (!inContract.has(input.toLessorId)) {
    throw new SettlementError(
      'COMPENSATION_OUT_OF_SCOPE',
      'El locador compensado tiene que ser locador del contrato del cobro',
    );
  }
  if (input.scope === CompensationScope.MismoContrato && !inContract.has(input.fromLessorId)) {
    throw new SettlementError(
      'COMPENSATION_OUT_OF_SCOPE',
      'La inmobiliaria solo admite compensaciones entre locadores del mismo contrato',
    );
  }
  const used = sumMoney(input.alreadyCompensated.map((v) => round2(v)));
  const available = round2(input.paymentAmount).minus(used);
  if (amount.gt(available)) {
    throw new SettlementError(
      'COMPENSATION_EXCEEDS_PAYMENT',
      `La compensación (${amount.toFixed(2)}) supera lo que queda del cobro (${available.toFixed(2)})`,
    );
  }
  return amount;
}

// ─── Monedas ────────────────────────────────────────────

/**
 * Importe de destino de una conversión con tipo de cambio explícito
 * (unidades de destino por unidad de origen), redondeado al centavo.
 */
export function convertAmount(amount: MoneyInput, rate: MoneyInput): Money {
  const a = new Money(amount);
  const r = new Money(rate);
  if (!a.gt(0) || !r.gt(0)) {
    throw new SettlementError('SETTLEMENT_INVALID_AMOUNT', 'El importe y el tipo de cambio tienen que ser positivos');
  }
  return round2(a.times(r));
}

/** Saldo de una cuenta: entradas menos salidas. */
export function accountBalance(movements: { direction: 'In' | 'Out' | string; amount: MoneyInput }[]): Money {
  return sumMoney(movements.map((m) => (m.direction === 'Out' ? new Money(m.amount).negated() : new Money(m.amount))));
}
