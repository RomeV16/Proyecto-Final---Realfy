import { describe, expect, it } from 'vitest';
import { IndexType } from '@realfy/shared';
import {
  formatPeriod,
  formatValue,
  granularityOf,
  isPercent,
  originOf,
  parseBulk,
  toDecimalString,
  toInputPeriod,
  toPeriodIso,
  SYSTEM_TENANT_ID,
} from './index-values';

describe('granularityOf / isPercent', () => {
  it('ICL y UVA son diarios; el resto, mensuales', () => {
    expect(granularityOf(IndexType.ICL)).toBe('day');
    expect(granularityOf(IndexType.UVA)).toBe('day');
    expect(granularityOf(IndexType.IPC)).toBe('month');
    expect(granularityOf(IndexType.CVS)).toBe('month');
    expect(granularityOf(IndexType.CER)).toBe('month');
  });

  it('solo los mensuales son porcentaje', () => {
    expect(isPercent(IndexType.IPC)).toBe(true);
    expect(isPercent(IndexType.ICL)).toBe(false);
  });
});

describe('toPeriodIso', () => {
  it('mes en ISO y en formato local', () => {
    expect(toPeriodIso('2026-09', 'month')).toBe('2026-09-01T00:00:00.000Z');
    expect(toPeriodIso('9/2026', 'month')).toBe('2026-09-01T00:00:00.000Z');
    expect(toPeriodIso('  09/2026 ', 'month')).toBe('2026-09-01T00:00:00.000Z');
    expect(toPeriodIso('2026-9', 'month')).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rechaza meses inválidos o texto', () => {
    expect(toPeriodIso('2026-13', 'month')).toBeNull();
    expect(toPeriodIso('2026-00', 'month')).toBeNull();
    expect(toPeriodIso('13/2026', 'month')).toBeNull();
    expect(toPeriodIso('septiembre', 'month')).toBeNull();
    expect(toPeriodIso('', 'month')).toBeNull();
    expect(toPeriodIso('2026-09-15', 'month')).toBeNull();
  });

  it('día en ISO y en formato local', () => {
    expect(toPeriodIso('2026-09-15', 'day')).toBe('2026-09-15T00:00:00.000Z');
    expect(toPeriodIso('15/09/2026', 'day')).toBe('2026-09-15T00:00:00.000Z');
    expect(toPeriodIso('5/9/2026', 'day')).toBe('2026-09-05T00:00:00.000Z');
  });

  it('rechaza días inexistentes y respeta bisiestos', () => {
    expect(toPeriodIso('2026-02-30', 'day')).toBeNull();
    expect(toPeriodIso('31/04/2026', 'day')).toBeNull();
    expect(toPeriodIso('2026-02-29', 'day')).toBeNull();
    expect(toPeriodIso('2028-02-29', 'day')).toBe('2028-02-29T00:00:00.000Z');
    expect(toPeriodIso('2026-09', 'day')).toBeNull();
    expect(toPeriodIso('hoy', 'day')).toBeNull();
  });
});

describe('toDecimalString', () => {
  it('acepta punto, coma decimal y porcentaje', () => {
    expect(toDecimalString('1.9')).toBe('1.9');
    expect(toDecimalString('1,9')).toBe('1.9');
    expect(toDecimalString(' 1,9 % ')).toBe('1.9');
    expect(toDecimalString('-0,5%')).toBe('-0.5');
    expect(toDecimalString('12')).toBe('12');
    expect(toDecimalString('0,123456')).toBe('0.123456');
  });

  it('rechaza ambiguos, vacíos y con demasiados decimales', () => {
    expect(toDecimalString('2.176,21')).toBeNull();
    expect(toDecimalString('0,1234567')).toBeNull();
    expect(toDecimalString('')).toBeNull();
    expect(toDecimalString('abc')).toBeNull();
    expect(toDecimalString('1,')).toBeNull();
    expect(toDecimalString('+1')).toBeNull();
  });
});

describe('parseBulk', () => {
  it('lee líneas con distintos separadores y coma decimal', () => {
    const text = [
      '2026-06;1,9',
      '2026-07\t2.1',
      '2026-08 2,3%',
      '2026-09,1,9',
      '2026-10,2.5',
    ].join('\n');
    const { rows, errors } = parseBulk(text, IndexType.IPC);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.period.slice(0, 7), r.value])).toEqual([
      ['2026-06', '1.9'],
      ['2026-07', '2.1'],
      ['2026-08', '2.3'],
      ['2026-09', '1.9'],
      ['2026-10', '2.5'],
    ]);
    expect(rows.every((r) => r.indexType === IndexType.IPC && r.source === 'manual')).toBe(true);
  });

  it('ignora líneas vacías, soporta CRLF y numera desde la línea original', () => {
    const { rows, errors } = parseBulk('2026-01;1\r\n\r\nbasura\r\n2026-02;2', IndexType.CER);
    expect(rows).toHaveLength(2);
    expect(errors).toEqual([{ line: 3, text: 'basura', reason: 'format' }]);
  });

  it('informa período inválido, valor inválido y duplicados', () => {
    const { rows, errors } = parseBulk(
      ['2026-13;1', '2026-01;1', '01/2026;2', '2026-02;1.1234567'].join('\n'),
      IndexType.IPC,
    );
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => [e.line, e.reason])).toEqual([
      [1, 'period'],
      [3, 'duplicate'],
      [4, 'value'],
    ]);
  });

  it('usa día para índices diarios', () => {
    const { rows, errors } = parseBulk('2026-09-15;1500,25\n15/09/2026;1', IndexType.UVA);
    expect(rows[0]).toMatchObject({ period: '2026-09-15T00:00:00.000Z', value: '1500.25' });
    expect(errors).toEqual([{ line: 2, text: '15/09/2026;1', reason: 'duplicate' }]);
    expect(parseBulk('2026-09;1', IndexType.ICL).errors[0].reason).toBe('period');
  });

  it('texto vacío no produce nada', () => {
    expect(parseBulk('  \n\n', IndexType.IPC)).toEqual({ rows: [], errors: [] });
  });
});

describe('formato', () => {
  it('formatPeriod mensual y diario en UTC', () => {
    expect(formatPeriod('2026-09-01T00:00:00.000Z', IndexType.IPC, 'en-US')).toBe('Sep 2026');
    expect(formatPeriod('2026-09-15T00:00:00.000Z', IndexType.UVA, 'en-US')).toBe('Sep 15, 2026');
    expect(formatPeriod('no es fecha', IndexType.IPC, 'es-AR')).toBe('no es fecha');
  });

  it('formatValue según tipo', () => {
    expect(formatValue('1.9', IndexType.IPC, 'en-US')).toBe('1.9');
    expect(formatValue(1500.5, IndexType.UVA, 'en-US')).toBe('1,500.50');
    expect(formatValue('x', IndexType.IPC, 'en-US')).toBe('x');
  });

  it('toInputPeriod', () => {
    expect(toInputPeriod('2026-09-01T00:00:00.000Z', IndexType.IPC)).toBe('2026-09');
    expect(toInputPeriod('2026-09-15T00:00:00.000Z', IndexType.ICL)).toBe('2026-09-15');
  });
});

describe('originOf', () => {
  it('distingue carga propia y fuentes públicas', () => {
    expect(originOf({ tenantId: 't1', source: 'indec' })).toBe('manual');
    expect(originOf({ tenantId: SYSTEM_TENANT_ID, source: 'indec-csv' })).toBe('indec');
    expect(originOf({ tenantId: SYSTEM_TENANT_ID, source: 'bcra' })).toBe('bcra');
    expect(originOf({ tenantId: SYSTEM_TENANT_ID, source: null })).toBe('system');
  });
});
