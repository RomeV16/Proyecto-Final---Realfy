import { afterEach, describe, expect, it } from 'vitest';
import {
  formatCompNumber,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatLocalDate,
  formatMoney,
  formatMoneyCompact,
  formatMoneyFixed,
  formatMoneyRounded,
  formatMonthShort,
  formatNumber,
  formatPercent,
  formatPeriod,
  formatYearShort,
  intlLocale,
  toUtcDay,
} from './format';

const nbsp = ' ';
const normalize = (text: string) => text.replaceAll(nbsp, ' ');

describe('intlLocale', () => {
  it('traduce los locales de la app y deja pasar los de Intl', () => {
    expect(intlLocale()).toBe('es-AR');
    expect(intlLocale('es')).toBe('es-AR');
    expect(intlLocale('en')).toBe('en-US');
    expect(intlLocale('pt-BR')).toBe('pt-BR');
  });
});

describe('formatMoney', () => {
  it('muestra de 0 a 2 decimales por defecto', () => {
    expect(normalize(formatMoney(1500))).toBe('$ 1.500');
    expect(normalize(formatMoney('1234.5'))).toBe('$ 1.234,5');
  });

  it('usa el símbolo de cada moneda y cae a ARS sin moneda', () => {
    expect(normalize(formatMoney(100, 'USD'))).toBe('US$ 100');
    expect(normalize(formatMoney(100, null))).toBe('$ 100');
  });

  it('valores nulos o inválidos son 0, o el texto pedido', () => {
    expect(normalize(formatMoney(null))).toBe('$ 0');
    expect(normalize(formatMoney('abc'))).toBe('$ 0');
    expect(formatMoney(undefined, 'ARS', { placeholder: '—' })).toBe('—');
  });

  it('respeta el locale pedido', () => {
    expect(normalize(formatMoney(1234.5, 'USD', { locale: 'en' }))).toBe('$1,234.5');
  });
});

describe('variantes de dinero', () => {
  it('formatMoneyFixed fija dos decimales y usa guion si falta', () => {
    expect(normalize(formatMoneyFixed(1500))).toBe('$ 1.500,00');
    expect(normalize(formatMoneyFixed('10', 'USD'))).toBe('US$ 10,00');
    expect(formatMoneyFixed(null)).toBe('—');
  });

  it('formatMoneyRounded redondea al peso', () => {
    expect(normalize(formatMoneyRounded(1234.56))).toBe('$ 1.235');
  });

  it('formatMoneyCompact abrevia miles y millones', () => {
    expect(formatMoneyCompact(2_500_000)).toBe('$2,5M');
    expect(formatMoneyCompact(2_500_000, 'en')).toBe('$2.5M');
    expect(formatMoneyCompact(-1_500_000)).toBe('$-1,5M');
    expect(formatMoneyCompact(45_000)).toBe('$45K');
    expect(formatMoneyCompact(900)).toBe('$900');
  });
});

describe('formatNumber y formatPercent', () => {
  it('formatea con separadores del locale', () => {
    expect(formatNumber(1234567.891)).toBe('1.234.567,891');
    expect(formatNumber('1500', { decimals: 2 })).toBe('1.500,00');
    expect(formatNumber(1500, { locale: 'en' })).toBe('1,500');
  });

  it('valores faltantes o no numéricos dan guion', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber('x')).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(Number.NaN)).toBe('—');
  });

  it('formatPercent muestra enteros sin decimales y un decimal si hace falta', () => {
    expect(formatPercent(7)).toBe('7 %');
    expect(formatPercent(7.5)).toBe('7,5 %');
    expect(formatPercent('12.345', { decimals: 2 })).toBe('12,35 %');
  });
});

describe('fechas de solo día (UTC)', () => {
  it('muestran el día que dice la API', () => {
    expect(formatDate('2026-11-01T00:00:00.000Z')).toBe('01/11/2026');
    expect(formatDate('2026-11-01')).toBe('01/11/2026');
  });

  it('estilos predefinidos y personalizados', () => {
    const iso = '2026-11-01T00:00:00.000Z';
    expect(formatDate(iso, 'medium')).toBe('1 de nov de 2026');
    expect(formatDate(iso, 'mediumPadded')).toBe('01 de nov de 2026');
    expect(formatDate(iso, 'long')).toBe('1 de noviembre de 2026');
    expect(formatDate(iso, 'monthYear')).toBe('nov 2026');
    expect(formatDate(iso, 'dayMonth')).toBe('1 nov');
    expect(formatDate(iso, { month: 'long' })).toBe('noviembre');
    expect(formatDate(iso, 'long', 'en')).toBe('November 1, 2026');
  });

  it('falta o es ilegible: guion', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(formatDate('no es fecha')).toBe('—');
  });

  it('acepta objetos Date', () => {
    expect(formatDate(new Date(Date.UTC(2026, 10, 1)))).toBe('01/11/2026');
  });

  it('un valor con hora conserva el día escrito en la cadena', () => {
    expect(formatDate('2026-11-01T23:30:00-03:00')).toBe('01/11/2026');
  });

  it('piezas sueltas: día y mes, mes corto y año corto', () => {
    expect(formatDayMonth('2026-08-10')).toBe('10 ago');
    expect(formatMonthShort('2026-08-10')).toBe('ago');
    expect(formatYearShort('2026-08-10')).toBe('26');
    expect(formatMonthShort(null)).toBe('—');
  });
});

describe('toUtcDay', () => {
  it('devuelve la medianoche UTC del día', () => {
    expect(toUtcDay('2026-11-01T15:00:00Z')).toBe(Date.UTC(2026, 10, 1));
    expect(toUtcDay(undefined)).toBeNull();
    expect(toUtcDay('basura')).toBeNull();
    expect(toUtcDay(new Date('invalid'))).toBeNull();
  });

  it('una cadena sin forma de fecha se interpreta como instante', () => {
    expect(toUtcDay('Nov 1, 2026 12:00 UTC')).toBe(Date.UTC(2026, 10, 1));
  });
});

describe('formatPeriod', () => {
  it('arma el período desde año y mes, o desde una fecha', () => {
    expect(formatPeriod(2026, 8)).toBe('Agosto de 2026');
    expect(formatPeriod('2026-08-01T00:00:00.000Z')).toBe('Agosto de 2026');
    expect(formatPeriod(2026, 8, 'en')).toBe('August 2026');
  });

  it('sin datos: guion', () => {
    expect(formatPeriod(2026)).toBe('—');
    expect(formatPeriod(null)).toBe('—');
  });
});

describe('formatCompNumber', () => {
  it('completa con ceros', () => {
    expect(formatCompNumber(1, 42)).toBe('0001-00000042');
  });
});

describe('instantes (zona horaria del usuario)', () => {
  const previousTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = previousTz;
  });

  it('formatLocalDate usa el día local del instante', () => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
    // 01:00 UTC del 2 de noviembre es la noche del 1 en Buenos Aires.
    expect(formatLocalDate('2026-11-02T01:00:00Z', 'numeric')).toBe('01/11/2026');
    expect(formatLocalDate(new Date('2026-11-02T01:00:00Z'), 'mediumPadded')).toBe('01 de nov de 2026');
    expect(formatLocalDate(null)).toBe('—');
    expect(formatLocalDate('x')).toBe('—');
  });

  it('formatDateTime muestra fecha y hora locales', () => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
    expect(normalize(formatDateTime('2026-11-02T01:30:00Z'))).toBe('1 de nov de 2026, 10:30 p. m.');
    expect(
      normalize(formatDateTime('2026-11-02T01:30:00Z', { hour: '2-digit', minute: '2-digit', hour12: false })),
    ).toBe('22:30');
    expect(formatDateTime(undefined)).toBe('—');
  });
});

describe('regresión: una fecha de solo día no se corre en Argentina', () => {
  const previousTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = previousTz;
  });

  it('el mismo valor sale distinto como día solo y como instante', () => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
    const iso = '2026-11-01T00:00:00.000Z';
    expect(formatDate(iso)).toBe('01/11/2026');
    // Lo que hacían los helpers locales: leerlo en la zona del navegador.
    expect(formatLocalDate(iso, 'numeric')).toBe('31/10/2026');
  });

  it('en el este del meridiano también coincide', () => {
    process.env.TZ = 'Asia/Tokyo';
    expect(formatDate('2026-11-01T00:00:00.000Z')).toBe('01/11/2026');
  });
});
