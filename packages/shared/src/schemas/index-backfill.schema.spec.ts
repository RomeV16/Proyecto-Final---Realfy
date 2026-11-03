import { BackfillIndexDataSchema } from './contract.schema';

describe('BackfillIndexDataSchema (CP-1236)', () => {
  const ok = { indexType: 'ICL', from: '2025-01-01', to: '2025-02-01' };

  it('acepta ICL y UVA con un rango válido, inclusive en los dos extremos', () => {
    expect(BackfillIndexDataSchema.safeParse(ok).success).toBe(true);
    expect(BackfillIndexDataSchema.safeParse({ ...ok, indexType: 'UVA', to: '2025-01-01' }).success).toBe(true);
  });

  it.each([
    ['índice mensual', { ...ok, indexType: 'IPC' }],
    ['rango invertido', { ...ok, from: '2025-03-01' }],
    ['más de 3.660 días', { ...ok, from: '2015-01-01' }],
    ['fecha futura', { ...ok, to: '2999-01-01' }],
    ['fecha inexistente', { ...ok, from: '2025-02-30' }],
    ['formato con hora', { ...ok, from: '2025-01-01T00:00:00Z' }],
  ])('rechaza %s', (_name, body) => {
    expect(BackfillIndexDataSchema.safeParse(body).success).toBe(false);
  });

  it('el ancho máximo es de 3.660 días', () => {
    // 2016-01-01 a 2025-12-30 son 3.651 días de diferencia; hasta 2026-01-10, 3.662.
    expect(BackfillIndexDataSchema.safeParse({ ...ok, from: '2016-01-01', to: '2025-12-30' }).success).toBe(true);
    expect(BackfillIndexDataSchema.safeParse({ ...ok, from: '2016-01-01', to: '2026-01-10' }).success).toBe(false);
  });
});
