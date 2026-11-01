import { rentAtDate, rentChangeInMonth } from './rent-at';
import { scheduledPeriod } from './generation-window';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('rentAtDate: alquiler vigente a la fecha', () => {
  const adjustments = [
    { adjustmentDate: d('2026-01-01'), previousAmount: '100000', newAmount: '130000', isProvisional: false },
    { adjustmentDate: d('2026-07-01'), previousAmount: '130000', newAmount: '160000', isProvisional: false },
  ];

  it('un período pasado usa el alquiler de entonces, no el vigente hoy', () => {
    const base = { contractRent: '160000', adjustments, termsVersions: [] };
    expect(rentAtDate({ ...base, date: d('2025-11-01') })).toEqual({ amount: '100000', isProvisional: false });
    expect(rentAtDate({ ...base, date: d('2026-03-01') })).toEqual({ amount: '130000', isProvisional: false });
    expect(rentAtDate({ ...base, date: d('2026-07-01') })).toEqual({ amount: '160000', isProvisional: false });
    expect(rentAtDate({ ...base, date: d('2027-02-01') })).toEqual({ amount: '160000', isProvisional: false });
  });

  it('sin ajustes rige el alquiler del contrato', () => {
    expect(rentAtDate({ contractRent: '90000', adjustments: [], termsVersions: [], date: d('2026-03-01') })).toEqual({
      amount: '90000',
      isProvisional: false,
    });
  });

  it('el mismo día, un ajuste definitivo pisa al provisional', () => {
    const both = [
      { adjustmentDate: d('2026-01-01'), previousAmount: '100000', newAmount: '125000', isProvisional: true },
      { adjustmentDate: d('2026-01-01'), previousAmount: '100000', newAmount: '130000', isProvisional: false },
    ];
    expect(rentAtDate({ contractRent: '130000', adjustments: both, termsVersions: [], date: d('2026-02-01') })).toEqual({
      amount: '130000',
      isProvisional: false,
    });
  });

  it('un ajuste provisional marca la liquidación como provisional', () => {
    const prov = [{ adjustmentDate: d('2026-01-01'), previousAmount: '100000', newAmount: '125000', isProvisional: true }];
    expect(rentAtDate({ contractRent: '125000', adjustments: prov, termsVersions: [], date: d('2026-02-01') })).toEqual({
      amount: '125000',
      isProvisional: true,
    });
  });

  it('un alquiler fijado por las reglas rige desde su fecha si es posterior al último ajuste', () => {
    const terms = [{ validFrom: d('2026-04-01'), rentOverride: '120000' }];
    const base = { contractRent: '160000', adjustments, termsVersions: terms };
    expect(rentAtDate({ ...base, date: d('2026-03-01') }).amount).toBe('130000');
    expect(rentAtDate({ ...base, date: d('2026-05-01') }).amount).toBe('120000');
    expect(rentAtDate({ ...base, date: d('2026-08-01') }).amount).toBe('160000');
  });
});

describe('scheduledPeriod: mes que el proceso diario debe tener generado', () => {
  it('a 10 días del mes siguiente genera ese mes', () => {
    expect(scheduledPeriod(d('2026-10-22'), 10)).toEqual({ year: 2026, month: 11 });
    expect(scheduledPeriod(d('2026-10-31'), 10)).toEqual({ year: 2026, month: 11 });
  });

  it('antes de la ventana no hay nada que generar', () => {
    expect(scheduledPeriod(d('2026-10-21'), 10)).toBeNull();
    expect(scheduledPeriod(d('2026-10-05'), 10)).toBeNull();
  });

  it('cruza el fin de año', () => {
    expect(scheduledPeriod(d('2026-12-25'), 10)).toEqual({ year: 2027, month: 1 });
  });

  it('con otra anticipación se corre la ventana', () => {
    expect(scheduledPeriod(d('2026-10-17'), 15)).toEqual({ year: 2026, month: 11 });
    expect(scheduledPeriod(d('2026-10-16'), 15)).toBeNull();
  });

  it('sin anticipación, el día 1 genera el mes que empieza', () => {
    expect(scheduledPeriod(d('2026-11-01'), 0)).toEqual({ year: 2026, month: 11 });
    expect(scheduledPeriod(d('2026-10-31'), 0)).toBeNull();
  });
});

describe('rentChangeInMonth: cambio de alquiler dentro del mes', () => {
  const adjustments = [
    { adjustmentDate: d('2026-11-15'), previousAmount: '300000', newAmount: '330000', isProvisional: false },
    { adjustmentDate: d('2026-12-01'), previousAmount: '330000', newAmount: '360000', isProvisional: false },
  ];
  const range = (start: string, end: string) => ({ periodStart: d(start), monthEnd: d(end) });

  it('devuelve el cambio que cae después del día 1', () => {
    expect(rentChangeInMonth({ adjustments, termsVersions: [], ...range('2026-11-01', '2026-11-30') })).toEqual({
      effectiveDate: d('2026-11-15'),
      newAmount: '330000',
      isProvisional: false,
    });
  });

  it('un cambio el día 1 no es de mitad de mes; un mes sin cambios devuelve null', () => {
    expect(rentChangeInMonth({ adjustments, termsVersions: [], ...range('2026-12-01', '2026-12-31') })).toBeNull();
    expect(rentChangeInMonth({ adjustments, termsVersions: [], ...range('2026-10-01', '2026-10-31') })).toBeNull();
  });

  it('también cuenta un alquiler fijado por las reglas y marca lo provisional', () => {
    const terms = [{ validFrom: d('2026-11-20'), rentOverride: '310000' }];
    expect(rentChangeInMonth({ adjustments: [], termsVersions: terms, ...range('2026-11-01', '2026-11-30') })).toEqual({
      effectiveDate: d('2026-11-20'),
      newAmount: '310000',
      isProvisional: false,
    });
    const prov = [{ adjustmentDate: d('2026-11-10'), previousAmount: '1', newAmount: '2', isProvisional: true }];
    expect(
      rentChangeInMonth({ adjustments: prov, termsVersions: [], ...range('2026-11-01', '2026-11-30') })?.isProvisional,
    ).toBe(true);
  });
});
