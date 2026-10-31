import { AdjustmentPeriod } from '../enums';
import {
  AR_TIME_ZONE,
  addMonthsClamped,
  formatDateAR,
  monthStartUTC,
  normalizeTimeZone,
  periodFilter,
  periodKey,
  periodToMonths,
  todayInAR,
} from './index';

const utc = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m - 1, d, h));

describe('periodToMonths', () => {
  it.each([
    [AdjustmentPeriod.Mensual, 1],
    [AdjustmentPeriod.Bimestral, 2],
    [AdjustmentPeriod.Trimestral, 3],
    [AdjustmentPeriod.Cuatrimestral, 4],
    [AdjustmentPeriod.Semestral, 6],
    [AdjustmentPeriod.Anual, 12],
  ])('%s dura %i meses', (period, months) => {
    expect(periodToMonths(period)).toBe(months);
  });

  it('lanza ante un período desconocido en vez de asumir uno', () => {
    expect(() => periodToMonths('Quincenal')).toThrow('Quincenal');
    expect(() => periodToMonths('')).toThrow();
  });
});

describe('addMonthsClamped', () => {
  it('recorta el 31 de enero al fin de febrero (año común y bisiesto)', () => {
    expect(addMonthsClamped(utc(2025, 1, 31), 1)).toEqual(utc(2025, 2, 28));
    expect(addMonthsClamped(utc(2024, 1, 31), 1)).toEqual(utc(2024, 2, 29));
  });

  it('el 29 de febrero bisiesto más 12 meses cae en el 28', () => {
    expect(addMonthsClamped(utc(2024, 2, 29), 12)).toEqual(utc(2025, 2, 28));
    expect(addMonthsClamped(utc(2024, 2, 29), 48)).toEqual(utc(2028, 2, 29));
  });

  it('el 31 de enero trimestral da 30 de abril, 31 de julio y 31 de octubre', () => {
    const start = utc(2025, 1, 31);
    expect(addMonthsClamped(start, 3)).toEqual(utc(2025, 4, 30));
    expect(addMonthsClamped(start, 6)).toEqual(utc(2025, 7, 31));
    expect(addMonthsClamped(start, 9)).toEqual(utc(2025, 10, 31));
  });

  it('cruza el año y acepta meses negativos o cero', () => {
    expect(addMonthsClamped(utc(2025, 11, 15), 3)).toEqual(utc(2026, 2, 15));
    expect(addMonthsClamped(utc(2025, 3, 31), -1)).toEqual(utc(2025, 2, 28));
    expect(addMonthsClamped(utc(2025, 1, 10), -2)).toEqual(utc(2024, 11, 10));
    expect(addMonthsClamped(utc(2025, 5, 31), 0)).toEqual(utc(2025, 5, 31));
  });

  it('conserva la hora UTC y no muta la fecha de entrada', () => {
    const input = utc(2025, 1, 31, 15);
    expect(addMonthsClamped(input, 1)).toEqual(utc(2025, 2, 28, 15));
    expect(input).toEqual(utc(2025, 1, 31, 15));
  });
});

describe('monthStartUTC / periodFilter / periodKey', () => {
  it('monthStartUTC es el primer instante del mes', () => {
    expect(monthStartUTC(2025, 2).toISOString()).toBe('2025-02-01T00:00:00.000Z');
  });

  it('periodFilter de un mes cubre [inicio, inicio del siguiente)', () => {
    expect(periodFilter(2025, 2)).toEqual({ gte: utc(2025, 2, 1), lt: utc(2025, 3, 1) });
    expect(periodFilter(2024, 2)).toEqual({ gte: utc(2024, 2, 1), lt: utc(2024, 3, 1) });
  });

  it('periodFilter de diciembre termina el 1 de enero siguiente', () => {
    expect(periodFilter(2025, 12)).toEqual({ gte: utc(2025, 12, 1), lt: utc(2026, 1, 1) });
  });

  it('periodFilter de solo año cubre el año completo', () => {
    expect(periodFilter(2025)).toEqual({ gte: utc(2025, 1, 1), lt: utc(2026, 1, 1) });
  });

  it('periodFilter sin año no filtra, aunque haya mes', () => {
    expect(periodFilter()).toBeUndefined();
    expect(periodFilter(undefined, 3)).toBeUndefined();
    expect(periodFilter(null, null)).toBeUndefined();
  });

  it('periodKey usa el mes UTC con dos dígitos', () => {
    expect(periodKey(utc(2025, 1, 1))).toBe('2025-01');
    expect(periodKey(utc(2025, 12, 31, 23))).toBe('2025-12');
    expect(periodKey(new Date('2025-03-01T00:00:00.000Z'))).toBe('2025-03');
  });
});

describe('todayInAR', () => {
  it('a las 02:00 UTC todavía es el día anterior en Buenos Aires', () => {
    expect(todayInAR(new Date('2025-03-01T02:00:00Z'))).toEqual(utc(2025, 2, 28));
  });

  it('a las 03:00 UTC ya es el día nuevo', () => {
    expect(todayInAR(new Date('2025-03-01T03:00:00Z'))).toEqual(utc(2025, 3, 1));
  });

  it('cruza el año y el 29 de febrero bisiesto', () => {
    expect(todayInAR(new Date('2026-01-01T01:00:00Z'))).toEqual(utc(2025, 12, 31));
    expect(todayInAR(new Date('2024-03-01T02:59:00Z'))).toEqual(utc(2024, 2, 29));
  });

  it('sin argumento devuelve medianoche UTC', () => {
    const today = todayInAR();
    expect(today.getUTCHours() + today.getUTCMinutes() + today.getUTCSeconds()).toBe(0);
  });
});

describe('formatDateAR', () => {
  it('formatea una fecha a medianoche UTC sin retroceder un día', () => {
    expect(formatDateAR(utc(2025, 3, 1))).toBe('01/03/2025');
    expect(formatDateAR(utc(2025, 12, 31))).toBe('31/12/2025');
  });

  it('acepta un texto ISO', () => {
    expect(formatDateAR('2024-02-29T00:00:00.000Z')).toBe('29/02/2024');
  });
});

describe('normalizeTimeZone', () => {
  it('normaliza el nombre viejo de Buenos Aires y rellena lo vacío', () => {
    expect(normalizeTimeZone('America/Buenos_Aires')).toBe(AR_TIME_ZONE);
    expect(normalizeTimeZone(AR_TIME_ZONE)).toBe(AR_TIME_ZONE);
    expect(normalizeTimeZone(undefined)).toBe(AR_TIME_ZONE);
    expect(normalizeTimeZone(null)).toBe(AR_TIME_ZONE);
  });

  it('deja pasar una zona de otro lugar', () => {
    expect(normalizeTimeZone('America/Montevideo')).toBe('America/Montevideo');
  });
});
