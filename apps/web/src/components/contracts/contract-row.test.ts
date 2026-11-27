import { describe, expect, it } from 'vitest';
import { nextAdjustmentDate, termInfo, type ContractItem } from './contract-row';

const day = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);

const contract = (over: Partial<ContractItem> = {}): ContractItem => ({
  id: 'c-1',
  contractType: 'Alquiler',
  status: 'Activo',
  startDate: '2026-02-01T00:00:00.000Z',
  endDate: '2028-01-31T00:00:00.000Z',
  adjustmentType: 'IPC',
  adjustmentPeriod: 'Trimestral',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('termInfo', () => {
  it('un contrato del 1/2/2026 al 31/1/2028 dura 24 meses y a fin de noviembre corre el mes 10', () => {
    const info = termInfo('2026-02-01T00:00:00.000Z', '2028-01-31T00:00:00.000Z', day('2026-11-27'));
    expect(info).toMatchObject({ totalMonths: 24, currentMonth: 10, started: true });
    expect(info!.pct).toBeGreaterThan(40);
    expect(info!.pct).toBeLessThan(42);
    expect(info!.daysLeft).toBe(430);
  });

  it('antes del inicio no avanzó y después del fin queda en el último mes', () => {
    const before = termInfo('2026-02-01', '2027-01-31', day('2026-01-10'));
    expect(before).toMatchObject({ pct: 0, currentMonth: 1, totalMonths: 12, started: false });
    const after = termInfo('2026-02-01', '2027-01-31', day('2027-03-01'));
    expect(after).toMatchObject({ pct: 100, currentMonth: 12, totalMonths: 12 });
    expect(after!.daysLeft).toBeLessThan(0);
  });

  it('sin fecha de fin, con fechas ilegibles o con el fin antes del inicio no hay plazo', () => {
    expect(termInfo('2026-02-01', null)).toBeNull();
    expect(termInfo('no es fecha', '2027-01-01')).toBeNull();
    expect(termInfo('2026-02-01', '2026-01-01')).toBeNull();
  });
});

describe('nextAdjustmentDate', () => {
  it('toma el próximo múltiplo del período desde el inicio', () => {
    expect(nextAdjustmentDate(contract(), day('2026-11-27'))?.toISOString()).toBe('2027-02-01T00:00:00.000Z');
    expect(nextAdjustmentDate(contract(), day('2026-02-01'))?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(nextAdjustmentDate(contract({ adjustmentPeriod: 'Anual' }), day('2026-11-27'))?.toISOString()).toBe(
      '2027-02-01T00:00:00.000Z',
    );
  });

  it('si el contrato todavía no empezó, el primero es un período después del inicio', () => {
    expect(nextAdjustmentDate(contract(), day('2025-12-01'))?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('no hay próximo ajuste si no tiene, si el período es desconocido o si cae después del fin', () => {
    expect(nextAdjustmentDate(contract({ adjustmentType: null }))).toBeNull();
    expect(nextAdjustmentDate(contract({ adjustmentPeriod: null }))).toBeNull();
    expect(nextAdjustmentDate(contract({ adjustmentPeriod: 'Quincenal' }), day('2026-11-27'))).toBeNull();
    expect(nextAdjustmentDate(contract({ startDate: 'x' }))).toBeNull();
    expect(nextAdjustmentDate(contract({ endDate: '2026-12-31T00:00:00.000Z' }), day('2026-11-27'))).toBeNull();
  });
});
