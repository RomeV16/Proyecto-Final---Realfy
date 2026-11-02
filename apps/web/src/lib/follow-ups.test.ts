import { describe, expect, it } from 'vitest';
import { dayAfter, oralExtensionFormSchema, periodEnd, renewFormSchema, type RenewFormValues } from './follow-ups';

const base: RenewFormValues = {
  start: '2027-01-01',
  end: '2028-12-31',
  rent: '200000',
  adjustmentType: '',
  adjustmentPeriod: 'Trimestral',
  customPct: '',
  guarantorPersonIds: [],
  feeAmount: '',
  feeCurrency: 'ARS',
  signedAt: '',
  notes: '',
};

describe('fechas de la renovación', () => {
  it('dayAfter pasa al día siguiente, también entre meses y años', () => {
    expect(dayAfter('2026-12-31T00:00:00.000Z')).toBe('2027-01-01');
    expect(dayAfter('2028-02-28')).toBe('2028-02-29');
  });

  it('periodEnd termina un día antes del mismo día N meses después', () => {
    expect(periodEnd('2027-01-01', 24)).toBe('2028-12-31');
    expect(periodEnd('2027-03-15', 12)).toBe('2028-03-14');
  });

  it('periodEnd corre un 31 al último día del mes más corto', () => {
    expect(periodEnd('2026-08-31', 6)).toBe('2027-02-27');
  });
});

describe('formulario de prórroga', () => {
  it('acepta fecha y nota, y devuelve el error en el campo que falla', () => {
    expect(oralExtensionFormSchema.safeParse({ until: '2027-03-31', note: ' Hablado ' })).toEqual({
      success: true,
      data: { until: '2027-03-31', note: 'Hablado' },
    });
    const bad = oralExtensionFormSchema.safeParse({ until: '', note: '' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues.map((i) => i.message).sort()).toEqual(['followUps.errors.note', 'followUps.errors.until']);
    }
  });
});

describe('formulario de renovación', () => {
  it('arma el cuerpo mínimo: fechas y alquiler', () => {
    expect(renewFormSchema.safeParse(base)).toEqual({
      success: true,
      data: { start: '2027-01-01', end: '2028-12-31', rent: '200000' },
    });
  });

  it('suma la regla, los garantes, los honorarios y las notas cuando se completan', () => {
    const result = renewFormSchema.safeParse({
      ...base,
      rent: '200.000,50'.replace(/\./g, '').replace(',', '.'),
      adjustmentType: 'FixedPercent',
      adjustmentPeriod: 'Semestral',
      customPct: '12',
      guarantorPersonIds: ['0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11'],
      feeAmount: '96000',
      feeCurrency: 'USD',
      signedAt: '2026-12-20',
      notes: ' Dos años ',
    });
    expect(result).toEqual({
      success: true,
      data: {
        start: '2027-01-01',
        end: '2028-12-31',
        rent: '200000.50',
        adjustment: { adjustmentType: 'FixedPercent', adjustmentPeriod: 'Semestral', customPct: '12' },
        guarantorPersonIds: ['0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11'],
        fee: { amount: '96000', currency: 'USD' },
        signedAt: '2026-12-20',
        notes: 'Dos años',
      },
    });
  });

  it('un tipo distinto del porcentaje fijo no manda el porcentaje', () => {
    const result = renewFormSchema.safeParse({ ...base, adjustmentType: 'IPC', customPct: '99' });
    expect(result).toMatchObject({ success: true, data: { adjustment: { adjustmentType: 'IPC', adjustmentPeriod: 'Trimestral' } } });
    if (result.success) expect((result.data.adjustment as Record<string, unknown>).customPct).toBeUndefined();
  });

  it('manda cada error al campo del formulario que corresponde', () => {
    const bad = renewFormSchema.safeParse({ ...base, rent: 'abc', end: '2027-01-01', adjustmentType: 'FixedPercent', customPct: '' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const keys = bad.error.issues.map((i) => i.message);
      expect(keys).toContain('followUps.errors.rent');
      expect(keys).toContain('followUps.errors.end');
      expect(keys.every((k) => k.startsWith('followUps.errors.'))).toBe(true);
    }
  });
});
