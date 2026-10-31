import Decimal from 'decimal.js';
import { Money, allocateLargestRemainder, round2, sumMoney, toAmountString } from './index';

describe('Money', () => {
  it('no modifica la configuración global de Decimal', () => {
    const before = { p: Decimal.precision, r: Decimal.rounding };
    new Money('1.005').toDecimalPlaces(2);
    expect({ p: Decimal.precision, r: Decimal.rounding }).toEqual(before);
    expect(Money.precision).toBe(40);
    expect(Money.rounding).toBe(Decimal.ROUND_HALF_UP);
  });

  it('acepta instancias de Decimal', () => {
    expect(new Money(new Decimal('1.5')).plus(1).toString()).toBe('2.5');
  });
});

describe('round2', () => {
  it.each([
    ['1.005', '1.01'],
    ['1.004', '1'],
    ['2.675', '2.68'],
    ['-1.005', '-1.01'],
    ['0.125', '0.13'],
    ['10', '10'],
  ])('%s -> %s', (input, expected) => {
    expect(round2(input).toString()).toBe(expected);
  });
});

describe('toAmountString', () => {
  it('siempre da 2 decimales', () => {
    expect(toAmountString(1234.5)).toBe('1234.50');
    expect(toAmountString('0.005')).toBe('0.01');
    expect(toAmountString(0)).toBe('0.00');
    expect(toAmountString('99.999')).toBe('100.00');
  });
});

describe('sumMoney', () => {
  it('suma sin error de coma flotante', () => {
    expect(sumMoney([0.1, 0.2]).toString()).toBe('0.3');
    expect(sumMoney(['33.333', '33.333', '33.333']).toString()).toBe('99.999');
  });

  it('una lista vacía suma cero', () => {
    expect(sumMoney([]).toString()).toBe('0');
  });
});

describe('allocateLargestRemainder', () => {
  const total = (parts: Decimal[]) => sumMoney(parts).toFixed(2);

  it('reparte 100 en tres partes iguales sumando exactamente 100', () => {
    const parts = allocateLargestRemainder(100, [1, 1, 1]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['33.34', '33.33', '33.33']);
    expect(total(parts)).toBe('100.00');
  });

  it('respeta las proporciones', () => {
    const parts = allocateLargestRemainder('1000', [70, 30]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['700.00', '300.00']);
  });

  it('el centavo sobrante va al mayor resto', () => {
    const parts = allocateLargestRemainder('0.10', [1, 2, 4]);
    expect(total(parts)).toBe('0.10');
  });

  it('suma exacta con muchos pesos arbitrarios', () => {
    const weights = [3, 7, 11, 13, 17, 19, 23];
    const parts = allocateLargestRemainder('12345.67', weights);
    expect(total(parts)).toBe('12345.67');
    parts.forEach((p) => expect(p.decimalPlaces()).toBeLessThanOrEqual(2));
  });

  it('un peso cero recibe cero', () => {
    const parts = allocateLargestRemainder(50, [0, 1, 1]);
    expect(parts.map((p) => p.toFixed(2))).toEqual(['0.00', '25.00', '25.00']);
  });

  it('total cero y lista vacía', () => {
    expect(total(allocateLargestRemainder(0, [1, 2]))).toBe('0.00');
    expect(allocateLargestRemainder(10, [])).toEqual([]);
  });

  it('rechaza pesos negativos o que suman cero', () => {
    expect(() => allocateLargestRemainder(10, [1, -1, 2])).toThrow();
    expect(() => allocateLargestRemainder(10, [0, 0])).toThrow();
  });
});
