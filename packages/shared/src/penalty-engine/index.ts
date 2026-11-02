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
 * - Redondeo: se devenga sin redondear y el total se redondea una sola vez a
 *   2 decimales, mitad hacia arriba.
 */

export const PENALTY_MODES = ['daily_fixed', 'daily_percent', 'compound_percent', 'max_bna_or_daily'] as const;
export type PenaltyRuleMode = (typeof PENALTY_MODES)[number];

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
): Money | undefined {
  let found: Money | undefined;
  for (const r of rates) {
    if (r.from <= day) found = r.annualPct;
    else break;
  }
  return found === undefined ? undefined : found.div(100).div(yearDays).times(multiplier);
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

  for (let i = 0; i < accruingDays; i++) {
    const day = firstDay + i * MS_PER_DAY;
    const paid = payments.filter((p) => p.day < day).reduce((acc, p) => acc.plus(p.amount), new Money(0));
    const base = Money.max(total.minus(paid), new Money(0));
    if (baseAtStart === null) baseAtStart = base;
    if (base.lte(0)) continue;
    counted += 1;
    switch (rule.mode) {
      case 'daily_fixed':
        accrued = accrued.plus(value);
        break;
      case 'daily_percent':
        accrued = accrued.plus(base.times(value));
        break;
      case 'compound_percent':
        accrued = accrued.plus(base.plus(accrued).times(value));
        break;
      case 'max_bna_or_daily': {
        const bna = bnaDailyRate(day, rates, multiplier, yearDays);
        if (bna === undefined) {
          daysWithoutRate += 1;
          floorDays += 1;
          accrued = accrued.plus(base.times(value));
        } else if (bna.gt(value)) {
          bnaDays += 1;
          accrued = accrued.plus(base.times(bna));
        } else {
          floorDays += 1;
          accrued = accrued.plus(base.times(value));
        }
        break;
      }
      default: {
        const _exhaustive: never = rule.mode;
        throw new Error(`Unknown penalty mode: ${String(_exhaustive)}`);
      }
    }
  }

  const start = baseAtStart ?? new Money(0);
  const cap = start.times(new Money(rule.maxMultiplier).minus(1));
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
  };
}
