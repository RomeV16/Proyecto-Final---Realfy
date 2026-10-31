import Decimal from 'decimal.js';
import { AdjustmentBase, AdjustmentType } from '../enums';
import {
  assessCoverage,
  calculateAdjustment,
  calculateEscalonado,
  calculateIPC,
  calculateTrueUp,
  calculateUVA,
  expectedMonthlyPeriods,
  isWithinFixedInitialPeriod,
  monthsBetween,
  monthsInRange,
  resolveAdjustmentBasis,
  shiftWindowByLag,
} from './index';

/**
 * Reglas del contrato en el motor de ajuste: rezago, base, meses fijos,
 * escalonado, UVA, provisorio y corrección. Los valores esperados se calcularon
 * a mano antes de escribir cada caso.
 */
const d = (v: string | number) => new Decimal(v);
const utc = (y: number, m: number, day = 1) => new Date(Date.UTC(y, m - 1, day));
const base = d('100000.00');

describe('rezago del índice', () => {
  const window = { from: utc(2025, 1), until: utc(2025, 4), startExclusive: false };

  it('con rezago 0 la ventana no cambia y cubre enero a abril', () => {
    expect(shiftWindowByLag(window, 0)).toBe(window);
    expect(expectedMonthlyPeriods(window)).toEqual(['2025-01', '2025-02', '2025-03', '2025-04']);
  });

  it('con rezago 2 el ajuste de abril usa los meses que terminan en febrero', () => {
    const shifted = shiftWindowByLag(window, 2);
    expect(shifted.from).toEqual(utc(2024, 11));
    expect(shifted.until).toEqual(utc(2025, 2));
    expect(expectedMonthlyPeriods(shifted)).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
  });

  it('tras un ajuste previo el mes inicial queda afuera también con rezago', () => {
    const after = { from: utc(2025, 1), until: utc(2025, 4), startExclusive: true };
    expect(expectedMonthlyPeriods(after)).toEqual(['2025-02', '2025-03', '2025-04']);
    expect(expectedMonthlyPeriods(shiftWindowByLag(after, 2))).toEqual(['2024-12', '2025-01', '2025-02']);
  });

  it('recorta el día al fin de mes del destino', () => {
    const shifted = shiftWindowByLag({ from: utc(2025, 1, 31), until: utc(2025, 3, 31), startExclusive: false }, 1);
    expect(shifted.until).toEqual(utc(2025, 2, 28));
    expect(shifted.from).toEqual(utc(2024, 12, 31));
  });

  it('una fecha de inicio a mitad de mes deja afuera el primero de ese mes', () => {
    const w = { from: utc(2025, 1, 15), until: utc(2025, 4), startExclusive: false };
    expect(expectedMonthlyPeriods(w)).toEqual(['2025-02', '2025-03', '2025-04']);
  });

  it('el IPC 2 %, 3 % y 2,5 % de la ventana con rezago encadena a 107.686,50', () => {
    // 1,02 × 1,03 × 1,025 = 1,076865
    const result = calculateIPC([d('2'), d('3'), d('2.5')], base);
    expect(result.newRent.toFixed(2)).toBe('107686.50');
  });
});

describe('base del ajuste: Original o Vigente', () => {
  const vigenteWindow = { from: utc(2025, 2), until: utc(2025, 4), startExclusive: true };
  const input = {
    initialRent: '100000.00',
    currentRent: '120000.00',
    periodStart: utc(2025, 1),
    vigenteWindow,
  };

  it('Vigente aplica el índice del período al alquiler de hoy', () => {
    const basis = resolveAdjustmentBasis({ ...input, base: AdjustmentBase.Vigente });
    expect(basis.baseRent).toBe('120000.00');
    expect(basis.window).toBe(vigenteWindow);
    // 1,02 × 1,02 = 1,0404
    const result = calculateIPC([d('2'), d('2')], d(basis.baseRent));
    expect(result.newRent.toFixed(2)).toBe('124848.00');
  });

  it('Original aplica el factor acumulado desde el inicio del tramo al alquiler inicial', () => {
    const basis = resolveAdjustmentBasis({ ...input, base: AdjustmentBase.Original });
    expect(basis.baseRent).toBe('100000.00');
    expect(basis.window).toEqual({ from: utc(2025, 1), until: utc(2025, 4), startExclusive: false });
    // cuatro meses al 2 %: 1,02^4 = 1,08243216
    const result = calculateIPC([d('2'), d('2'), d('2'), d('2')], d(basis.baseRent));
    expect(result.newRent.toFixed(2)).toBe('108243.22');
  });
});

describe('meses fijos iniciales y meses transcurridos', () => {
  it('un ajuste antes de cumplirse los meses fijos no se aplica', () => {
    expect(isWithinFixedInitialPeriod(utc(2025, 1), utc(2025, 10), 12)).toBe(true);
    expect(isWithinFixedInitialPeriod(utc(2025, 1), utc(2025, 12, 31), 12)).toBe(true);
  });

  it('el ajuste que cae justo al cumplirse los meses fijos sí se aplica', () => {
    expect(isWithinFixedInitialPeriod(utc(2025, 1), utc(2026, 1), 12)).toBe(false);
  });

  it('sin meses fijos nunca está dentro del período fijo', () => {
    expect(isWithinFixedInitialPeriod(utc(2025, 1), utc(2025, 2), 0)).toBe(false);
  });

  it('cuenta meses completos', () => {
    expect(monthsBetween(utc(2025, 1, 10), utc(2025, 7, 10))).toBe(6);
    expect(monthsBetween(utc(2025, 1, 10), utc(2025, 7, 9))).toBe(5);
    expect(monthsBetween(utc(2025, 7), utc(2025, 1))).toBe(0);
  });
});

describe('escalonado', () => {
  const steps = [
    { fromMonth: 1, pct: d('3') },
    { fromMonth: 13, pct: d('5') },
  ];

  it('rige el escalón vigente al mes del ajuste', () => {
    expect(calculateEscalonado(steps, 6, base).newRent.toFixed(2)).toBe('103000.00');
    expect(calculateEscalonado(steps, 12, base).newRent.toFixed(2)).toBe('103000.00');
    expect(calculateEscalonado(steps, 13, base).newRent.toFixed(2)).toBe('105000.00');
    expect(calculateEscalonado(steps, 30, base).percentage.toFixed(2)).toBe('5.00');
  });

  it('antes del primer escalón el alquiler no cambia', () => {
    const result = calculateEscalonado(steps, 0, base);
    expect(result.newRent.toFixed(2)).toBe('100000.00');
    expect(result.percentage.toFixed(2)).toBe('0.00');
  });

  it('sin escalones es un error, no un 0 %', () => {
    expect(() => calculateEscalonado([], 6, base)).toThrow('at least one step');
  });

  it('el dispatcher lo resuelve', () => {
    const result = calculateAdjustment({ type: AdjustmentType.Escalonado, steps, monthsElapsed: 13, baseRent: base });
    expect(result.newRent.toFixed(2)).toBe('105000.00');
  });
});

describe('UVA', () => {
  it('el cociente de la UVA entre las dos fechas: 1000 a 1250 es 25 %', () => {
    const result = calculateUVA(d('1000'), d('1250'), base);
    expect(result.newRent.toFixed(2)).toBe('125000.00');
    expect(result.percentage.toFixed(2)).toBe('25.00');
  });

  it('un valor inicial en cero es un error', () => {
    expect(() => calculateUVA(d(0), d(10), base)).toThrow('UVA start value cannot be zero');
  });

  it('el dispatcher lo resuelve', () => {
    const result = calculateAdjustment({
      type: AdjustmentType.UVA,
      startValue: d('1000'),
      endValue: d('1100'),
      baseRent: base,
    });
    expect(result.newRent.toFixed(2)).toBe('110000.00');
  });
});

describe('cobertura de la ventana y ajuste provisorio', () => {
  const expected = ['2025-02', '2025-03', '2025-04'];
  const obs = (period: string, value: string, isEstimate = false) => ({ period, value: d(value), isEstimate });

  it('todo oficial: sin estimados ni faltantes', () => {
    const c = assessCoverage(expected, [obs('2025-02', '2'), obs('2025-03', '3'), obs('2025-04', '2.5')]);
    expect(c.values.map(String)).toEqual(['2', '3', '2.5']);
    expect(c.estimatedPeriods).toEqual([]);
    expect(c.missingPeriods).toEqual([]);
  });

  it('un mes sin oficial pero con estimado se usa y se informa como provisorio', () => {
    const c = assessCoverage(expected, [obs('2025-02', '2'), obs('2025-03', '3'), obs('2025-04', '2.5', true)]);
    expect(c.estimatedPeriods).toEqual(['2025-04']);
    expect(c.missingPeriods).toEqual([]);
    // 1,02 × 1,03 × 1,025 = 1,076865
    expect(calculateIPC(c.values, base).newRent.toFixed(2)).toBe('107686.50');
  });

  it('el oficial gana al estimado del mismo mes', () => {
    const c = assessCoverage(['2025-04'], [obs('2025-04', '2.5', true), obs('2025-04', '2.8')]);
    expect(c.values.map(String)).toEqual(['2.8']);
    expect(c.estimatedPeriods).toEqual([]);
  });

  it('un mes sin oficial ni estimado queda faltante y no se rellena', () => {
    const c = assessCoverage(expected, [obs('2025-02', '2'), obs('2025-03', '3')]);
    expect(c.missingPeriods).toEqual(['2025-04']);
    expect(c.values).toHaveLength(2);
  });

  it('una ventana vacía no tiene meses faltantes', () => {
    expect(assessCoverage([], []).missingPeriods).toEqual([]);
  });
});

describe('corrección del ajuste provisorio', () => {
  it('estimado 2,5 % contra oficial 2,8 %: 315,18 por mes y 945,54 en tres meses', () => {
    // provisorio 1,0506 × 1,025 = 1,076865 -> 107.686,50; oficial 1,0506 × 1,028 = 1,0800168 -> 108.001,68
    const provisional = calculateIPC([d('2'), d('3'), d('2.5')], base).newRent;
    const official = calculateIPC([d('2'), d('3'), d('2.8')], base).newRent;
    const result = calculateTrueUp({
      provisionalRent: provisional,
      officialRent: official,
      fromPeriod: '2025-04',
      toPeriod: '2025-06',
    });
    expect(result.monthlyDelta.toFixed(2)).toBe('315.18');
    expect(result.months.map((m) => m.period)).toEqual(['2025-04', '2025-05', '2025-06']);
    expect(result.total.toFixed(2)).toBe('945.54');
  });

  it('si el estimado se pasó, la diferencia es negativa (a favor del inquilino)', () => {
    const result = calculateTrueUp({
      provisionalRent: d('108000.00'),
      officialRent: d('107500.00'),
      fromPeriod: '2025-12',
      toPeriod: '2026-01',
    });
    expect(result.monthlyDelta.toFixed(2)).toBe('-500.00');
    expect(result.months.map((m) => m.period)).toEqual(['2025-12', '2026-01']);
    expect(result.total.toFixed(2)).toBe('-1000.00');
  });

  it('un oficial igual al estimado no deja diferencia', () => {
    const result = calculateTrueUp({
      provisionalRent: d('108000.00'),
      officialRent: d('108000.00'),
      fromPeriod: '2025-04',
      toPeriod: '2025-04',
    });
    expect(result.total.toFixed(2)).toBe('0.00');
  });

  it('un rango invertido no tiene meses a corregir', () => {
    expect(monthsInRange('2025-06', '2025-04')).toEqual([]);
    expect(monthsInRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});
