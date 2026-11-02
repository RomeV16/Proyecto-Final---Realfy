import { PayoffQuerySchema, PenaltyConfigSchema, WaiveAllQuerySchema, WaivePenaltySchema } from './penalty-config.schema';

const base = { mode: 'max_bna_or_daily', value: '0.003', graceDays: 0, maxMultiplier: '2.0' };

describe('PenaltyConfigSchema', () => {
  it('las opciones pactables son opcionales y toman sus valores', () => {
    expect(PenaltyConfigSchema.safeParse(base).success).toBe(true);
    const full = {
      ...base,
      bnaMultiplier: '2',
      yearDays: 360,
      bnaRateKind: 'Efectiva',
      partialPaymentAllocation: 'PunitorioPrimero',
      roundingMode: 'Diario',
      capBase: 'TotalOriginal',
      missingRateBehavior: 'Bloquear',
    };
    expect(PenaltyConfigSchema.parse(full)).toEqual(full);
  });

  it.each([
    { yearDays: 366 },
    { bnaRateKind: 'Otra' },
    { partialPaymentAllocation: 'x' },
    { roundingMode: 'x' },
    { capBase: 'x' },
    { missingRateBehavior: 'x' },
    { mode: 'otro' },
  ])('rechaza %j', (patch) => {
    expect(PenaltyConfigSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });
});

describe('esquemas de condonación y monto a pagar', () => {
  it('el motivo es obligatorio y se recorta', () => {
    expect(WaivePenaltySchema.parse({ reason: '  x ' })).toEqual({ reason: 'x' });
    expect(WaivePenaltySchema.safeParse({ reason: '   ' }).success).toBe(false);
  });

  it('las fechas son YYYY-MM-DD válidas y opcionales', () => {
    expect(PayoffQuerySchema.parse({})).toEqual({});
    expect(PayoffQuerySchema.safeParse({ date: '2026-03-20' }).success).toBe(true);
    expect(PayoffQuerySchema.safeParse({ date: '20/03/2026' }).success).toBe(false);
    expect(WaiveAllQuerySchema.safeParse({ upTo: '2026-13-45' }).success).toBe(false);
  });
});
