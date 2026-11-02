import { Money, allocateLargestRemainder, round2, sumMoney } from '../money';
import type { MoneyInput } from '../money';
import { LineBeneficiary, LineItemType, OwnerLedgerEntryType as T } from '../enums';

/**
 * Cuenta corriente y estado de cuenta del locador (ADR-0009). Puro, sin acceso
 * a la base.
 *
 * Cada asiento lleva signo desde el punto de vista del locador: positivo, la
 * inmobiliaria le debe (su parte de un alquiler cobrado, un punitorio, un
 * reintegro); negativo, se le descuenta (comisión, honorarios, cargos, pagos a
 * entes hechos por él) o ya recibió el dinero (transferencia, entrega de
 * efectivo, lo que cobró directamente del inquilino). El saldo es la suma: si es
 * positivo, la inmobiliaria le debe; si es negativo, el locador le debe a la
 * inmobiliaria.
 */

// ─── Opciones de la inmobiliaria ────────────────────────

/** Cuándo se descuenta del estado del locador un cargo del centro de carga. */
export enum LessorChargeTiming {
  /** Al generar el estado (borrador) del período en que se imputa. */
  AlGenerarEstado = 'AlGenerarEstado',
  /** Recién al emitir el estado; el borrador lo muestra como previsto. */
  AlEmitirEstado = 'AlEmitirEstado',
}

// ─── Clasificación de los asientos ──────────────────────

/** Asientos que son dinero que ya le llegó al locador: van en "pagos" del estado. */
export const PAYOUT_ENTRY_TYPES: readonly T[] = [T.Transferencia, T.EntregaEfectivo, T.CobroDirecto];

/** Lo que entra al saldo de apertura en lugar de a los movimientos del período. */
const OPENING_ENTRY_TYPES: readonly T[] = [T.SaldoInicial];

/** Concepto del asiento que corresponde a un renglón de la liquidación a favor del locador. */
export function ledgerTypeForLine(type: LineItemType | `${LineItemType}` | string): T {
  switch (type) {
    case LineItemType.Alquiler:
    case LineItemType.Ajuste:
    case LineItemType.AjusteRetroactivo:
    case LineItemType.Descuento:
      return T.Alquiler;
    case LineItemType.Multa:
      return T.Punitorio;
    case LineItemType.Impuesto:
    case LineItemType.Servicio:
      return T.ReintegroImpuesto;
    default:
      return T.Ajuste;
  }
}

// ─── Asientos de un cobro ───────────────────────────────

export interface PostingLine {
  amount: MoneyInput;
  beneficiary: LineBeneficiary | `${LineBeneficiary}` | string;
  type: LineItemType | `${LineItemType}` | string;
}

export interface PostingPosition {
  personId: string;
  /** Lo que le corresponde de este cobro (neto de comisión y gastos). */
  share: MoneyInput;
  /** Lo que recibió en mano (flujo "cobra el locador"). */
  received?: MoneyInput;
  /** Saldo con la inmobiliaria que deja el cobro. */
  balance: MoneyInput;
}

export interface PaymentPostingInput {
  flow: 'Inmobiliaria' | 'Custodia' | 'Locador' | string;
  /** Renglones de la liquidación completa. */
  lines: PostingLine[];
  /** Comisión, gastos administrativos y parte neta de los locadores de la liquidación completa. */
  buckets: { commission: MoneyInput; adminFee: MoneyInput; lessors: MoneyInput };
  positions: PostingPosition[];
}

export interface LedgerPosting {
  personId: string;
  type: T;
  amount: Money;
  /** Solo en `CobroDirecto`: lo que recibió y lo que retiene para pagar entes. */
  received?: Money;
  keptForEnte?: Money;
}

/** Orden de los créditos; el centavo de redondeo va al primero que haya (normalmente el alquiler). */
const CREDIT_ORDER: readonly T[] = [T.Alquiler, T.Punitorio, T.ReintegroImpuesto, T.Ajuste];

/**
 * Asientos que deja un cobro en la cuenta de cada locador, a partir del reparto
 * del cobro (settlement-engine): la parte bruta de cada concepto a favor del
 * locador (alquiler, punitorio, reintegro de impuestos y servicios, otros), la
 * comisión y los gastos administrativos (negativos), en la proporción de lo que
 * le tocó de este cobro. El redondeo de cada concepto va al centavo y la
 * diferencia con su parte se suma al primer crédito, así que los asientos de
 * cada locador suman exactamente su parte.
 *
 * Si cobró el locador (flujo "Locador"), se agrega `CobroDirecto`: lo que ya
 * tiene en mano, menos lo que retiene para pagar entes. Así el saldo queda en
 * lo que le debe a la inmobiliaria (negativo).
 */
export function paymentPostings(input: PaymentPostingInput): LedgerPosting[] {
  const gross = new Map<T, Money>();
  for (const line of input.lines) {
    if (line.beneficiary !== LineBeneficiary.Locador) continue;
    const type = ledgerTypeForLine(line.type);
    gross.set(type, (gross.get(type) ?? new Money(0)).plus(round2(line.amount)));
  }
  const all: [T, Money][] = [
    ...CREDIT_ORDER.filter((t) => gross.has(t)).map((t): [T, Money] => [t, gross.get(t)!]),
    [T.Comision, round2(input.buckets.commission).negated()],
    [T.Honorario, round2(input.buckets.adminFee).negated()],
  ];
  const components = all.filter(([, v]) => !v.isZero());
  const net = round2(input.buckets.lessors);
  const residualTarget = components.find(([, v]) => v.gt(0))?.[0] ?? T.Ajuste;

  const out: LedgerPosting[] = [];
  for (const position of input.positions) {
    const share = round2(position.share);
    const balance = round2(position.balance);
    const parts = new Map<T, Money>();
    const add = (type: T, value: Money) => parts.set(type, (parts.get(type) ?? new Money(0)).plus(value));
    if (!share.isZero()) {
      if (net.isZero()) {
        add(T.Ajuste, share);
      } else {
        for (const [type, value] of components) add(type, round2(value.times(share).div(net)));
        const residual = share.minus(sumMoney([...parts.values()]));
        if (!residual.isZero()) add(residualTarget, residual);
      }
    }
    let direct: LedgerPosting | null = null;
    if (input.flow === 'Locador') {
      const amount = balance.minus(share);
      if (!amount.isZero()) {
        const received = round2(position.received ?? amount.negated());
        direct = {
          personId: position.personId,
          type: T.CobroDirecto,
          amount,
          received,
          keptForEnte: received.plus(amount),
        };
      }
    }
    for (const type of [...CREDIT_ORDER, T.Comision, T.Honorario]) {
      const value = parts.get(type);
      if (value && !value.isZero()) out.push({ personId: position.personId, type, amount: value });
    }
    if (direct) out.push(direct);
  }
  return out;
}

// ─── Repartos ───────────────────────────────────────────

/**
 * Reparte un importe con signo entre personas según su porcentaje (mayor
 * resto): las partes suman exactamente el importe. Sin porcentajes, en partes
 * iguales.
 */
export function splitByShare(
  amount: MoneyInput,
  shares: { personId: string; pct?: MoneyInput | null }[],
): { personId: string; amount: Money }[] {
  if (shares.length === 0) return [];
  const value = round2(amount);
  const weights = shares.map((s) => new Money(s.pct ?? 0));
  const usable = weights.some((w) => w.gt(0)) && weights.every((w) => !w.isNegative());
  const parts = allocateLargestRemainder(value.abs(), usable ? weights : shares.map(() => 1));
  return shares.map((s, i) => ({ personId: s.personId, amount: value.isNegative() ? parts[i].negated() : parts[i] }));
}

/** Honorario por gestión de una reparación: el porcentaje pactado sobre su importe, al centavo. */
export function repairManagementFee(amount: MoneyInput, pct: MoneyInput | null | undefined): Money {
  if (pct === null || pct === undefined) return new Money(0);
  return round2(new Money(amount).abs().times(pct).div(100));
}

// ─── Períodos ───────────────────────────────────────────

/**
 * Mes del estado de cuenta al que va un asiento de esa fecha. Sin día de
 * cierre, el mes calendario; con día de cierre `d`, lo posterior al día `d` va
 * al mes siguiente (el estado de un mes cubre del día d+1 del mes anterior al
 * día d).
 */
export function statementPeriodFor(date: Date | string, closeDay: number | null | undefined): Date {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (!closeDay || d.getUTCDate() <= closeDay) return new Date(Date.UTC(y, m, 1));
  return new Date(Date.UTC(y, m + 1, 1));
}

/** Primer y último día que cubre el estado de un período (fechas a medianoche UTC). */
export function statementPeriodRange(period: Date | string, closeDay: number | null | undefined): { from: Date; to: Date } {
  const p = new Date(period);
  const y = p.getUTCFullYear();
  const m = p.getUTCMonth();
  if (!closeDay) return { from: new Date(Date.UTC(y, m, 1)), to: new Date(Date.UTC(y, m + 1, 0)) };
  return { from: new Date(Date.UTC(y, m - 1, closeDay + 1)), to: new Date(Date.UTC(y, m, closeDay)) };
}

// ─── Estado de cuenta ───────────────────────────────────

export interface StatementEntry {
  type: T | `${T}`;
  amount: MoneyInput;
  date?: Date | string | null;
  propertyId?: string | null;
  /** Nombre de la unidad para ordenar y titular el grupo. */
  groupLabel?: string | null;
}

export interface StatementGroup<E extends StatementEntry> {
  propertyId: string | null;
  label: string | null;
  credits: Money;
  debits: Money;
  payouts: Money;
  /** Créditos menos débitos menos pagos del grupo. */
  net: Money;
  entries: E[];
}

export interface StatementResult<E extends StatementEntry> {
  /** Cierre del estado anterior más los saldos iniciales cargados en el período. */
  opening: Money;
  /** Suma de los saldos iniciales del período (ya incluida en `opening`). */
  initial: Money;
  credits: Money;
  /** Descuentos, en positivo. */
  debits: Money;
  /** Dinero que ya le llegó al locador, en positivo. */
  payouts: Money;
  closing: Money;
  byType: Partial<Record<T, Money>>;
  /** Movimientos por unidad (los de saldo inicial no van en ningún grupo). */
  groups: StatementGroup<E>[];
}

const time = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);

/**
 * Estado de cuenta de un locador en una moneda: saldo de apertura (el cierre
 * del estado anterior más los saldos iniciales), créditos, débitos, pagos y
 * cierre, con los movimientos agrupados por unidad para el PDF consolidado. El
 * cierre es apertura + créditos − débitos − pagos, que es la suma de los
 * asientos más el cierre anterior.
 */
export function computeStatement<E extends StatementEntry>(input: {
  previousClosing?: MoneyInput | null;
  entries: E[];
}): StatementResult<E> {
  const zero = new Money(0);
  let initial = zero;
  let credits = zero;
  let debits = zero;
  let payouts = zero;
  const byType: Partial<Record<T, Money>> = {};
  const groups = new Map<string, StatementGroup<E>>();

  const sorted = input.entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => time(a.entry.date) - time(b.entry.date) || a.index - b.index)
    .map((x) => x.entry);

  for (const entry of sorted) {
    const type = entry.type as T;
    const amount = round2(entry.amount);
    byType[type] = (byType[type] ?? zero).plus(amount);
    if (OPENING_ENTRY_TYPES.includes(type)) {
      initial = initial.plus(amount);
      continue;
    }
    const key = entry.propertyId ?? '';
    let group = groups.get(key);
    if (!group) {
      group = {
        propertyId: entry.propertyId ?? null,
        label: entry.groupLabel ?? null,
        credits: zero,
        debits: zero,
        payouts: zero,
        net: zero,
        entries: [],
      };
      groups.set(key, group);
    }
    group.entries.push(entry);
    group.net = group.net.plus(amount);
    if (PAYOUT_ENTRY_TYPES.includes(type)) {
      payouts = payouts.minus(amount);
      group.payouts = group.payouts.minus(amount);
    } else if (amount.isNegative()) {
      debits = debits.minus(amount);
      group.debits = group.debits.minus(amount);
    } else {
      credits = credits.plus(amount);
      group.credits = group.credits.plus(amount);
    }
  }

  const opening = round2(input.previousClosing ?? 0).plus(initial);
  const ordered = [...groups.values()].sort((a, b) => {
    if (!a.propertyId !== !b.propertyId) return a.propertyId ? -1 : 1;
    return (a.label ?? '').localeCompare(b.label ?? '', 'es') || (a.propertyId ?? '').localeCompare(b.propertyId ?? '');
  });
  return {
    opening,
    initial,
    credits,
    debits,
    payouts,
    closing: opening.plus(credits).minus(debits).minus(payouts),
    byType,
    groups: ordered,
  };
}

/**
 * Un estado por moneda: nunca se suman importes de monedas distintas. Cada
 * moneda arranca del cierre anterior de esa moneda.
 */
export function statementsByCurrency<E extends StatementEntry & { currency: string }>(input: {
  previousClosing?: Record<string, MoneyInput>;
  entries: E[];
}): Map<string, StatementResult<E>> {
  const byCurrency = new Map<string, E[]>();
  for (const entry of input.entries) {
    byCurrency.set(entry.currency, [...(byCurrency.get(entry.currency) ?? []), entry]);
  }
  for (const currency of Object.keys(input.previousClosing ?? {})) {
    if (!byCurrency.has(currency)) byCurrency.set(currency, []);
  }
  const out = new Map<string, StatementResult<E>>();
  for (const currency of [...byCurrency.keys()].sort((a, b) => a.localeCompare(b))) {
    out.set(
      currency,
      computeStatement({ previousClosing: input.previousClosing?.[currency] ?? 0, entries: byCurrency.get(currency)! }),
    );
  }
  return out;
}
