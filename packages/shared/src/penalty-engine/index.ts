import { Money, round2, type MoneyInput } from '../money';

/**
 * Motor de punitorios (puro).
 *
 * Calcula cuánto lleva acumulado de punitorio una liquidación vencida a una
 * fecha, día por día y sobre el saldo que quedaba ese día. No lee la base:
 * quien lo llama le da el vencimiento, el total, los pagos y la regla.
 *
 * Convenciones:
 * - Los días corren sobre el calendario UTC (las fechas guardadas son
 *   medianoche UTC; el "hoy" de Buenos Aires lo da `todayInAR`).
 * - Hay `graceDays` de gracia: el primer día con punitorio es el vencimiento
 *   más `graceDays` más 1. El día de `asOf` cuenta.
 * - La base de cada día es el saldo al comenzar ese día: el total menos los
 *   pagos fechados antes de ese día. Un pago del mismo día no baja la base de
 *   ese día, así el monto a pagar hoy coincide con lo que se liquida al cobrar.
 *   Un día sin saldo no devenga.
 * - Modos: `daily_fixed` (monto fijo por día), `daily_percent` (porcentaje
 *   diario simple sobre el saldo), `compound_percent` (porcentaje diario
 *   compuesto: cada día se capitaliza lo devengado) y `max_bna_or_daily`
 *   (cada día, la mayor entre `bnaMultiplier` veces la tasa activa del Banco
 *   Nación convertida a diaria y el porcentaje diario de `value`).
 * - Tasa BNA: se carga como TNA en porcentaje por mes (`IndexType.TasaActivaBNA`)
 *   y se convierte a diaria como TNA / 100 / `yearDays` (por defecto 365).
 *   Cada día usa el último valor publicado a esa fecha; si no hay ninguno,
 *   rige el piso diario y el día se cuenta en `daysWithoutRate`.
 * - Tope: lo devengado no pasa de `(maxMultiplier - 1)` por el saldo del primer
 *   día con punitorio (sin tope si `maxMultiplier - 1` es negativo).
 * - Redondeo: por defecto (`roundingMode` Total) se devenga sin redondear y el
 *   total se redondea una sola vez a 2 decimales, mitad hacia arriba; con
 *   `Diario` cada día se redondea antes de sumar.
 *
 * Opciones pactables por contrato (con valor por defecto de la inmobiliaria):
 * - `bnaRateKind`: `Nominal` (TNA / `yearDays`) o `Efectiva` (la tasa cargada es
 *   una TEA y la diaria es (1 + TEA)^(1 / `yearDays`) - 1).
 * - `capBase`: el tope se calcula sobre el saldo del primer día con punitorio
 *   (`SaldoInicioMora`) o sobre el total original (`TotalOriginal`).
 * - `missingRateBehavior`: un día sin tasa BNA devenga el piso (`AplicarPiso`) o
 *   no devenga y se informa en `blockedDays` (`Bloquear`).
 * - `partialPaymentAllocation`: ver `splitPayments`.
 */

export const PENALTY_MODES = ['daily_fixed', 'daily_percent', 'compound_percent', 'max_bna_or_daily'] as const;
export type PenaltyRuleMode = (typeof PENALTY_MODES)[number];

export const BNA_RATE_KINDS = ['Nominal', 'Efectiva'] as const;
export const PARTIAL_PAYMENT_ALLOCATIONS = ['RentaPrimero', 'PunitorioPrimero'] as const;
export const ROUNDING_MODES = ['Total', 'Diario'] as const;
export const CAP_BASES = ['SaldoInicioMora', 'TotalOriginal'] as const;
export const MISSING_RATE_BEHAVIORS = ['AplicarPiso', 'Bloquear'] as const;

export const DEFAULT_BNA_MULTIPLIER = '2';
export const DEFAULT_YEAR_DAYS = 365;

export interface PenaltyRule {
  mode: PenaltyRuleMode;
  /** Monto fijo por día (`daily_fixed`) o tasa diaria como fracción (0.003 = 0,3 %). */
  value: MoneyInput;
  graceDays: number;
  /** Tope como múltiplo del saldo: 2 permite punitorio hasta el 100 % del saldo. */
  maxMultiplier: MoneyInput;
  /** Solo `max_bna_or_daily`: veces la tasa activa BNA. Por defecto 2. */
  bnaMultiplier?: MoneyInput | null;
  /** Solo `max_bna_or_daily`: días del año para pasar la TNA a diaria. Por defecto 365. */
  yearDays?: number | null;
  /** Solo `max_bna_or_daily`: la tasa cargada es nominal anual (por defecto) o efectiva anual. */
  bnaRateKind?: (typeof BNA_RATE_KINDS)[number] | null;
  /** Cómo se imputa un pago parcial que cobra punitorios (ver `splitPayments`). Por defecto `RentaPrimero`. */
  partialPaymentAllocation?: (typeof PARTIAL_PAYMENT_ALLOCATIONS)[number] | null;
  roundingMode?: (typeof ROUNDING_MODES)[number] | null;
  capBase?: (typeof CAP_BASES)[number] | null;
  missingRateBehavior?: (typeof MISSING_RATE_BEHAVIORS)[number] | null;
}

/** Tasa activa del BNA vigente desde `from` (inicio de mes), TNA en porcentaje (40.5 = 40,5 %). */
export interface BnaRate {
  from: Date;
  annualPct: MoneyInput;
}

export interface PenaltyPayment {
  /** Día del pago (solo cuenta la fecha UTC). */
  date: Date;
  amount: MoneyInput;
}

export interface AccruePenaltyInput {
  dueDate: Date;
  asOf: Date;
  total: MoneyInput;
  payments?: ReadonlyArray<PenaltyPayment>;
  rule: PenaltyRule;
  bnaRates?: ReadonlyArray<BnaRate>;
}

export interface AccruedPenalty {
  /** Lo devengado a `asOf`, redondeado a 2 decimales (tope aplicado). */
  amount: Money;
  /** Días entre el vencimiento y `asOf`, sin descontar la gracia. */
  daysOverdue: number;
  /** Días que devengaron (después de la gracia y con saldo). */
  accruingDays: number;
  capHit: boolean;
  /** Saldo del primer día con punitorio. */
  baseAtStart: Money;
  /** Días de `max_bna_or_daily` regidos por la tasa BNA. */
  bnaDays: number;
  /** Días de `max_bna_or_daily` regidos por el piso diario. */
  floorDays: number;
  /** Días de `max_bna_or_daily` sin ninguna tasa BNA publicada. */
  daysWithoutRate: number;
  /** Días sin tasa que no devengaron por `missingRateBehavior` Bloquear. */
  blockedDays: number;
}

const MS_PER_DAY = 86_400_000;

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Días enteros entre dos fechas UTC, sin bajar de 0. */
export function daysOverdueBetween(dueDate: Date, asOf: Date): number {
  return Math.max(0, Math.floor((utcDay(asOf) - utcDay(dueDate)) / MS_PER_DAY));
}

/** Tasa diaria BNA de un día; `undefined` si no hay ninguna tasa publicada a esa fecha. */
function bnaDailyRate(
  day: number,
  rates: ReadonlyArray<{ from: number; annualPct: Money }>,
  multiplier: Money,
  yearDays: number,
  kind: 'Nominal' | 'Efectiva',
): Money | undefined {
  let found: Money | undefined;
  for (const r of rates) {
    if (r.from <= day) found = r.annualPct;
    else break;
  }
  if (found === undefined) return undefined;
  const annual = found.div(100);
  const daily =
    kind === 'Efectiva' ? new Money(1).plus(annual).pow(new Money(1).div(yearDays)).minus(1) : annual.div(yearDays);
  return daily.times(multiplier);
}

export function accruePenalty(input: AccruePenaltyInput): AccruedPenalty {
  const { rule } = input;
  const total = new Money(input.total);
  const value = new Money(rule.value);
  const daysOverdue = daysOverdueBetween(input.dueDate, input.asOf);
  const accruingDays = Math.max(0, daysOverdue - rule.graceDays);
  if (accruingDays === 0) {
    return {
      amount: new Money(0),
      daysOverdue,
      accruingDays: 0,
      capHit: false,
      baseAtStart: new Money(0),
      bnaDays: 0,
      floorDays: 0,
      daysWithoutRate: 0,
      blockedDays: 0,
    };
  }

  const payments = [...(input.payments ?? [])]
    .map((p) => ({ day: utcDay(p.date), amount: new Money(p.amount) }))
    .sort((a, b) => a.day - b.day);
  const rates = [...(input.bnaRates ?? [])]
    .map((r) => ({ from: utcDay(r.from), annualPct: new Money(r.annualPct) }))
    .sort((a, b) => a.from - b.from);
  const multiplier = new Money(rule.bnaMultiplier ?? DEFAULT_BNA_MULTIPLIER);
  const yearDays = rule.yearDays ?? DEFAULT_YEAR_DAYS;

  const firstDay = utcDay(input.dueDate) + (rule.graceDays + 1) * MS_PER_DAY;
  let accrued = new Money(0);
  let baseAtStart: Money | null = null;
  let counted = 0;
  let bnaDays = 0;
  let floorDays = 0;
  let daysWithoutRate = 0;
  let blockedDays = 0;
  const daily = rule.roundingMode === 'Diario';
  const kind = rule.bnaRateKind ?? 'Nominal';
  const blockMissing = rule.missingRateBehavior === 'Bloquear';

  for (let i = 0; i < accruingDays; i++) {
    const day = firstDay + i * MS_PER_DAY;
    const paid = payments.filter((p) => p.day < day).reduce((acc, p) => acc.plus(p.amount), new Money(0));
    const base = Money.max(total.minus(paid), new Money(0));
    if (baseAtStart === null) baseAtStart = base;
    if (base.lte(0)) continue;
    let day$: Money;
    switch (rule.mode) {
      case 'daily_fixed':
        day$ = value;
        break;
      case 'daily_percent':
        day$ = base.times(value);
        break;
      case 'compound_percent':
        day$ = base.plus(accrued).times(value);
        break;
      case 'max_bna_or_daily': {
        const bna = bnaDailyRate(day, rates, multiplier, yearDays, kind);
        if (bna === undefined) {
          daysWithoutRate += 1;
          if (blockMissing) {
            blockedDays += 1;
            continue;
          }
          floorDays += 1;
          day$ = base.times(value);
        } else if (bna.gt(value)) {
          bnaDays += 1;
          day$ = base.times(bna);
        } else {
          floorDays += 1;
          day$ = base.times(value);
        }
        break;
      }
      default: {
        const _exhaustive: never = rule.mode;
        throw new Error(`Unknown penalty mode: ${String(_exhaustive)}`);
      }
    }
    counted += 1;
    accrued = accrued.plus(daily ? round2(day$) : day$);
  }

  const start = baseAtStart ?? new Money(0);
  const capOn = rule.capBase === 'TotalOriginal' ? total : start;
  const cap = capOn.times(new Money(rule.maxMultiplier).minus(1));
  let capHit = false;
  if (cap.gte(0) && accrued.gt(cap)) {
    accrued = cap;
    capHit = true;
  }

  return {
    amount: round2(accrued),
    daysOverdue,
    accruingDays: counted,
    capHit,
    baseAtStart: start,
    bnaDays,
    floorDays,
    daysWithoutRate,
    blockedDays,
  };
}

export interface SplitPaymentsInput {
  /** Total de la liquidación, con los renglones Multa. */
  total: MoneyInput;
  /** Suma de los renglones Multa cobrados en la propia liquidación (los punitorios no devengan punitorios). */
  billedPenalty: MoneyInput;
  payments: ReadonlyArray<PenaltyPayment>;
  allocation?: (typeof PARTIAL_PAYMENT_ALLOCATIONS)[number] | null;
}

/**
 * Separa lo que es alquiler de lo que es punitorio ya cobrado en la misma
 * liquidación, para que el devengo corra solo sobre el alquiler impago. Con
 * `RentaPrimero` cada pago cubre primero el alquiler y el resto el punitorio;
 * con `PunitorioPrimero`, al revés. Devuelve el total de alquiler y los pagos
 * que lo redujeron, en orden de fecha.
 */
export function splitPayments(input: SplitPaymentsInput): { rentTotal: Money; rentPayments: PenaltyPayment[] } {
  const billed = new Money(input.billedPenalty);
  const rentTotal = Money.max(new Money(input.total).minus(billed), new Money(0));
  if (billed.lte(0)) return { rentTotal, rentPayments: [...input.payments] };
  const penaltyFirst = input.allocation === 'PunitorioPrimero';
  const sorted = [...input.payments].sort((a, b) => utcDay(a.date) - utcDay(b.date));
  let penaltyLeft = billed;
  let rentLeft = rentTotal;
  const rentPayments: PenaltyPayment[] = [];
  for (const p of sorted) {
    const amount = new Money(p.amount);
    let toRent: Money;
    if (penaltyFirst) {
      const toPenalty = Money.min(amount, penaltyLeft);
      penaltyLeft = penaltyLeft.minus(toPenalty);
      toRent = amount.minus(toPenalty);
    } else {
      toRent = Money.min(amount, rentLeft);
      const toPenalty = Money.min(amount.minus(toRent), penaltyLeft);
      penaltyLeft = penaltyLeft.minus(toPenalty);
    }
    rentLeft = Money.max(rentLeft.minus(toRent), new Money(0));
    rentPayments.push({ date: p.date, amount: toRent });
  }
  return { rentTotal, rentPayments };
}
