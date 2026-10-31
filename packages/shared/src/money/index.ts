import Decimal from 'decimal.js';

/**
 * Decimal propio del dinero: 40 dígitos significativos y ROUND_HALF_UP (el
 * modo que usaban los motores). Es un clon, así que no toca la configuración
 * global de `decimal.js` que comparten el resto de los módulos.
 */
export const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Money = InstanceType<typeof Money>;

export type MoneyInput = Decimal.Value;

/** Redondea a 2 decimales, mitad hacia arriba. */
export function round2(value: MoneyInput): Money {
  return new Money(value).toDecimalPlaces(2, Money.ROUND_HALF_UP);
}

/** Importe como texto con exactamente 2 decimales ("1234.50"). */
export function toAmountString(value: MoneyInput): string {
  return round2(value).toFixed(2);
}

/** Suma exacta; el resultado no se redondea. */
export function sumMoney(values: MoneyInput[]): Money {
  return values.reduce<Money>((acc, v) => acc.plus(v), new Money(0));
}

/**
 * Reparte `total` en proporción a `weights` por el método del mayor resto:
 * cada parte se trunca al centavo y los centavos que sobran van a las partes
 * con mayor resto (a igualdad, la primera). La suma de las partes es
 * exactamente `total` redondeado a 2 decimales.
 */
export function allocateLargestRemainder(total: MoneyInput, weights: MoneyInput[]): Money[] {
  if (weights.length === 0) return [];
  const ws = weights.map((w) => new Money(w));
  if (ws.some((w) => w.isNegative())) {
    throw new Error('Los pesos del reparto no pueden ser negativos');
  }
  const weightSum = sumMoney(ws);
  if (weightSum.isZero()) {
    throw new Error('Los pesos del reparto suman cero');
  }
  const totalCents = round2(total).times(100);
  const exact = ws.map((w) => totalCents.times(w).div(weightSum));
  const floors = exact.map((e) => e.floor());
  let leftover = totalCents.minus(sumMoney(floors)).toNumber();
  const order = exact
    .map((e, index) => ({ index, remainder: e.minus(e.floor()) }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
  const cents = [...floors];
  for (const { index } of order) {
    if (leftover <= 0) break;
    cents[index] = cents[index].plus(1);
    leftover -= 1;
  }
  return cents.map((c) => c.div(100));
}
