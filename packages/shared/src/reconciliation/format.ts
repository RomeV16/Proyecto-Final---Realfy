import { LineItemType } from '../enums';
import { Money, round2, type MoneyInput } from '../money';

/**
 * Formato del resultado de un ciclo mensual para reconciliarlo (plan de
 * `docs/calidad/12-piloto.md`, sección 4): por contrato, los conceptos del
 * recibo, la comisión y el neto de cada locador; por locador y moneda, los
 * totales del estado de cuenta. Es plano y serializable para que lo puedan
 * escribir a mano un caso esperado, el motor puro (`runCycle`), la lectura de
 * la API o un script que lea la planilla de la inmobiliaria.
 *
 * Cada concepto es un importe en texto (o un porcentaje, en `ajuste-pct`). Un
 * concepto en cero no figura, así los dos lados se comparan con la misma regla.
 */
export interface ReconciliationResult {
  /** Mes del ciclo, `YYYY-MM`. */
  period: string;
  /** Contrato -> concepto -> importe. */
  contracts: Record<string, Record<string, string>>;
  /** `<locador> <moneda>` -> concepto del estado de cuenta -> importe. */
  statements: Record<string, Record<string, string>>;
}

export type ReconciliationScope = 'contrato' | 'estado';

/** Una diferencia de la comparación: lo que dice cada lado (null si ese lado no lo tiene). */
export interface ReconciliationDifference {
  scope: ReconciliationScope;
  key: string;
  concept: string;
  expected: string | null;
  actual: string | null;
}

/** Conceptos del recibo, en el orden en que se leen (los de cada locador van al final). */
export const CONTRACT_CONCEPTS = [
  'alquiler-mensual',
  'ajuste-pct',
  'alquiler',
  'ajuste-retroactivo',
  'descuentos',
  'impuestos-y-servicios:Ente',
  'impuestos-y-servicios:Locador',
  'cargos:Locador',
  'cargos:Inmobiliaria',
  'punitorios',
  'total',
  'comision',
  'neto-locadores',
  'cobrado',
] as const;

/** Conceptos del estado de cuenta del locador. */
export const STATEMENT_CONCEPTS = ['apertura', 'creditos', 'debitos', 'pagos', 'cierre'] as const;

/** Prefijo del neto de cada locador: `neto:<locador>`. */
export const LESSOR_NET_PREFIX = 'neto:';

export interface SnapshotLine {
  type: LineItemType | `${LineItemType}` | string;
  amount: MoneyInput;
  beneficiary: string;
}

/** Lo que hace falta de una liquidación para resumirla. */
export interface ContractSnapshot {
  lines: SnapshotLine[];
  total: MoneyInput;
  /** Alquiler mensual vigente en el mes y, si hubo ajuste en el mes, su porcentaje. */
  rent?: { monthly: MoneyInput; adjustmentPct?: MoneyInput | null } | null;
  /** Comisión y neto de los locadores de la liquidación completa (del reparto). */
  buckets?: { commission: MoneyInput; lessors: MoneyInput } | null;
  /** Cobros del ciclo, con la parte de cada locador según el reparto. */
  payments?: { amount: MoneyInput; shares: { lessor: string; share: MoneyInput }[] }[];
}

const money = (value: MoneyInput) => round2(value).toFixed(2);

function conceptOf(line: SnapshotLine): string {
  switch (line.type) {
    case LineItemType.Alquiler:
    case LineItemType.Ajuste:
      return 'alquiler';
    case LineItemType.AjusteRetroactivo:
      return 'ajuste-retroactivo';
    case LineItemType.Descuento:
      return 'descuentos';
    case LineItemType.Impuesto:
    case LineItemType.Servicio:
      return `impuestos-y-servicios:${line.beneficiary}`;
    case LineItemType.Multa:
      return 'punitorios';
    default:
      return `cargos:${line.beneficiary}`;
  }
}

/** Resume una liquidación en conceptos comparables (los que suman cero no figuran). */
export function contractConcepts(snapshot: ContractSnapshot): Record<string, string> {
  const sums = new Map<string, Money>();
  const add = (concept: string, value: MoneyInput) =>
    sums.set(concept, (sums.get(concept) ?? new Money(0)).plus(round2(value)));

  for (const line of snapshot.lines) {
    add(conceptOf(line), new Money(line.amount).abs());
  }
  add('total', snapshot.total);
  if (snapshot.buckets) {
    add('comision', snapshot.buckets.commission);
    add('neto-locadores', snapshot.buckets.lessors);
  }
  for (const payment of snapshot.payments ?? []) {
    add('cobrado', payment.amount);
    for (const share of payment.shares) add(`${LESSOR_NET_PREFIX}${share.lessor}`, share.share);
  }

  const out: Record<string, string> = {};
  if (snapshot.rent) {
    out['alquiler-mensual'] = money(snapshot.rent.monthly);
    if (snapshot.rent.adjustmentPct != null) {
      out['ajuste-pct'] = new Money(snapshot.rent.adjustmentPct).toDecimalPlaces(4).toFixed(4);
    }
  }
  const ordered = [...sums.keys()].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
  for (const concept of ordered) {
    const value = sums.get(concept)!;
    if (!value.isZero()) out[concept] = value.toFixed(2);
  }
  return out;
}

function rank(concept: string): number {
  const index = (CONTRACT_CONCEPTS as readonly string[]).indexOf(concept);
  return index === -1 ? CONTRACT_CONCEPTS.length : index;
}

/** Totales de un estado de cuenta como conceptos comparables. */
export function statementConcepts(statement: {
  opening: MoneyInput;
  credits: MoneyInput;
  debits: MoneyInput;
  payouts: MoneyInput;
  closing: MoneyInput;
}): Record<string, string> {
  return {
    apertura: money(statement.opening),
    creditos: money(statement.credits),
    debitos: money(statement.debits),
    pagos: money(statement.payouts),
    cierre: money(statement.closing),
  };
}

/** Clave del estado de un locador en una moneda. */
export function statementKey(lessor: string, currency: string): string {
  return `${lessor} ${currency}`;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

function same(a: string, b: string): boolean {
  if (NUMERIC.test(a) && NUMERIC.test(b)) return new Money(a).eq(new Money(b));
  return a === b;
}

function compareGroup(
  scope: ReconciliationScope,
  expected: Record<string, Record<string, string>>,
  actual: Record<string, Record<string, string>>,
): ReconciliationDifference[] {
  const out: ReconciliationDifference[] = [];
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const exp = expected[key] ?? {};
    const act = actual[key] ?? {};
    const concepts = [...new Set([...Object.keys(exp), ...Object.keys(act)])].sort(
      (a, b) => rank(a) - rank(b) || a.localeCompare(b),
    );
    for (const concept of concepts) {
      const e = exp[concept] ?? null;
      const a = act[concept] ?? null;
      if (e !== null && a !== null && same(e, a)) continue;
      out.push({ scope, key, concept, expected: e, actual: a });
    }
  }
  return out;
}

/**
 * Compara dos resultados de un mismo ciclo con tolerancia cero: un importe
 * igual al centavo no es diferencia; uno que falta en un lado, sí. Devuelve las
 * diferencias en orden estable (contratos, después estados; por clave y concepto).
 */
export function compareReconciliation(
  expected: ReconciliationResult,
  actual: ReconciliationResult,
): ReconciliationDifference[] {
  const period: ReconciliationDifference[] =
    expected.period === actual.period
      ? []
      : [{ scope: 'contrato', key: '*', concept: 'periodo', expected: expected.period, actual: actual.period }];
  return [
    ...period,
    ...compareGroup('contrato', expected.contracts, actual.contracts),
    ...compareGroup('estado', expected.statements, actual.statements),
  ];
}

/** Diferencias como tabla de texto, una por renglón (vacío si no hay). */
export function formatDifferences(differences: ReconciliationDifference[]): string {
  return differences
    .map((d) => `${d.scope} ${d.key} ${d.concept}: esperado ${d.expected ?? '—'}, obtenido ${d.actual ?? '—'}`)
    .join('\n');
}

