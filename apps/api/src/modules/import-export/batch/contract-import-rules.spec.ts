import { AdjustmentPeriod, ContractStatus, ScheduleStatus } from '@realfy/shared';
import type { ImportContractRow } from '@realfy/shared';
import {
  adjustmentPercentage,
  assertContractRow,
  checkAdjustmentHistory,
  importedSchedule,
} from './contract-import-rules';
import { ImportRowError } from './import-types';

function row(overrides: Partial<ImportContractRow> = {}): ImportContractRow {
  return {
    externalRef: 'C-1',
    propertyExternalRef: 'U-1',
    contractType: 'Alquiler',
    status: 'Activo',
    startDate: '2025-01-01',
    endDate: '2027-12-31',
    rentAmount: 150000,
    currency: 'ARS',
    tenants: ['P-1'],
    lessors: [{ personExternalRef: 'L-1', capacity: 'Propietario', payoutPct: 100 }],
    terms: {
      adjustmentType: 'IPC',
      adjustmentPeriod: 'Trimestral',
      adjustmentBase: 'Vigente',
      fixedInitialMonths: 0,
      paymentFlow: 'Partido',
    },
    selfManaged: false,
    ...overrides,
  } as ImportContractRow;
}

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as ImportRowError).details[0].code;
  }
  return undefined;
};

describe('adjustmentPercentage', () => {
  it('sale de los montos y redondea a 4 decimales', () => {
    expect(adjustmentPercentage({ previousAmount: 100000, newAmount: 123456.789 })).toBe(23.4568);
  });

  it('el factor manda sobre los montos', () => {
    expect(adjustmentPercentage({ previousAmount: 100, newAmount: 999, factor: 1.2 })).toBe(20);
  });

  it('un monto anterior en cero no divide', () => {
    expect(adjustmentPercentage({ previousAmount: 0, newAmount: 50 })).toBe(0);
  });
});

describe('checkAdjustmentHistory', () => {
  const h = (periodNumber: number, previousAmount: number, newAmount: number) => ({
    periodNumber,
    appliedAt: '2025-04-01',
    previousAmount,
    newAmount,
  });

  it('ordena por período y acepta una cadena que termina en el monto vigente', () => {
    const out = checkAdjustmentHistory(
      row({ rentAmount: 150, initialRent: 100, adjustmentsHistory: [h(2, 120, 150), h(1, 100, 120)] }),
    );
    expect(out.map((x) => x.periodNumber)).toEqual([1, 2]);
  });

  it('sin historial no valida nada', () => {
    expect(checkAdjustmentHistory(row())).toEqual([]);
  });

  it('una cadena cortada es ADJUSTMENT_HISTORY_INVALID', () => {
    expect(
      codeOf(() => checkAdjustmentHistory(row({ rentAmount: 150, adjustmentsHistory: [h(1, 100, 120), h(2, 119, 150)] }))),
    ).toBe('ADJUSTMENT_HISTORY_INVALID');
  });

  it('un período repetido es ADJUSTMENT_HISTORY_INVALID', () => {
    expect(
      codeOf(() => checkAdjustmentHistory(row({ rentAmount: 150, adjustmentsHistory: [h(1, 100, 120), h(1, 120, 150)] }))),
    ).toBe('ADJUSTMENT_HISTORY_INVALID');
  });

  it('el primero tiene que partir del alquiler inicial', () => {
    expect(
      codeOf(() => checkAdjustmentHistory(row({ rentAmount: 120, initialRent: 90, adjustmentsHistory: [h(1, 100, 120)] }))),
    ).toBe('ADJUSTMENT_HISTORY_INVALID');
  });

  it('el último tiene que dar el monto vigente: RENT_MISMATCH', () => {
    expect(codeOf(() => checkAdjustmentHistory(row({ rentAmount: 130, adjustmentsHistory: [h(1, 100, 120)] })))).toBe(
      'RENT_MISMATCH',
    );
  });

  it('tolera un centavo de diferencia', () => {
    expect(() => checkAdjustmentHistory(row({ rentAmount: 120.005, adjustmentsHistory: [h(1, 100, 120)] }))).not.toThrow();
  });
});

describe('assertContractRow', () => {
  it('una fila completa pasa', () => {
    expect(() => assertContractRow(row())).not.toThrow();
  });

  it('el fin antes del inicio es INVALID_DATES', () => {
    expect(codeOf(() => assertContractRow(row({ endDate: '2024-12-31' })))).toBe('INVALID_DATES');
    expect(codeOf(() => assertContractRow(row({ actualEndDate: '2024-01-01' })))).toBe('INVALID_DATES');
  });

  it('un contrato activo con locadores que no suman 100 es LESSOR_SHARES_INVALID', () => {
    const lessors = [
      { personExternalRef: 'L-1', capacity: 'Propietario', payoutPct: 60 },
      { personExternalRef: 'L-2', capacity: 'Propietario', payoutPct: 30 },
    ] as ImportContractRow['lessors'];
    expect(codeOf(() => assertContractRow(row({ lessors })))).toBe('LESSOR_SHARES_INVALID');
    expect(codeOf(() => assertContractRow(row({ lessors: [] })))).toBe('LESSOR_SHARES_INVALID');
  });

  it('un contrato no vigente puede traer locadores que no suman 100 (historial)', () => {
    const lessors = [{ personExternalRef: 'L-1', capacity: 'Propietario', payoutPct: 50 }] as ImportContractRow['lessors'];
    expect(() => assertContractRow(row({ status: ContractStatus.Vencido, lessors }))).not.toThrow();
    expect(() => assertContractRow(row({ status: ContractStatus.Vencido, lessors: undefined, tenants: undefined }))).not.toThrow();
  });

  it('un alquiler activo sin inquilino es MISSING_INQUILINO', () => {
    expect(codeOf(() => assertContractRow(row({ tenants: [] })))).toBe('MISSING_INQUILINO');
  });

  it('repartos con decimales que suman 100 pasan', () => {
    const lessors = [
      { personExternalRef: 'A', capacity: 'Propietario', payoutPct: 33.3333 },
      { personExternalRef: 'B', capacity: 'Propietario', payoutPct: 33.3333 },
      { personExternalRef: 'C', capacity: 'Propietario', payoutPct: 33.3334 },
    ] as ImportContractRow['lessors'];
    expect(() => assertContractRow(row({ lessors }))).not.toThrow();
  });
});

describe('importedSchedule', () => {
  const today = new Date('2026-06-15T00:00:00.000Z');
  const start = new Date('2025-01-01T00:00:00.000Z');
  const end = new Date('2026-12-31T00:00:00.000Z');

  it('uno por período hasta el fin del contrato', () => {
    const s = importedSchedule(start, end, AdjustmentPeriod.Semestral, new Set(), today);
    expect(s.map((e) => e.periodNumber)).toEqual([1, 2, 3]);
    expect(s[0].date.toISOString().slice(0, 10)).toBe('2025-07-01');
  });

  it('aplicados por historial, salteados los vencidos sin historial y pendientes los futuros', () => {
    const s = importedSchedule(start, end, AdjustmentPeriod.Semestral, new Set([1]), today);
    expect(s.map((e) => e.status)).toEqual([
      ScheduleStatus.Applied,
      ScheduleStatus.Skipped,
      ScheduleStatus.Pending,
    ]);
  });
});
