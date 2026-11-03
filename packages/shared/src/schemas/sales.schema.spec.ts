import {
  CreateKeySetSchema,
  CreateSalesFeeSchema,
  CreateSalesOperationSchema,
  ForfeitSalesDepositSchema,
  KeyCheckOutSchema,
  SetSalesPartiesSchema,
  TransitionSalesSchema,
  UpdateSalesDocCheckSchema,
} from './sales.schema';

const P1 = '33333333-3333-4333-8333-333333333333';
const P2 = '44444444-4444-4444-8444-444444444444';
const PR = '11111111-1111-4111-8111-111111111111';

describe('esquemas de ventas', () => {
  it('una operación nueva arranca en captación, sin exclusividad y en dólares', () => {
    expect(CreateSalesOperationSchema.parse({ propertyId: PR })).toMatchObject({
      status: 'Captacion',
      exclusive: false,
      currency: 'USD',
      parties: [],
    });
  });

  it.each([
    ['las partes de un lado no suman 100', [{ role: 'Vendedor', personId: P1, sharePct: '60' }, { role: 'Vendedor', personId: P2, sharePct: '30' }]],
    ['una persona repetida en un lado', [{ role: 'Comprador', personId: P1, sharePct: '50' }, { role: 'Comprador', personId: P1, sharePct: '50' }]],
  ])('rechaza: %s', (_label, parties) => {
    expect(SetSalesPartiesSchema.safeParse({ parties }).success).toBe(false);
  });

  it('acepta un reparto de 100 y la misma persona de lados distintos', () => {
    const parties = [
      { role: 'Vendedor', personId: P1, sharePct: '50.5' },
      { role: 'Vendedor', personId: P2, sharePct: 49.5 },
      { role: 'Comprador', personId: P1 },
    ];
    expect(SetSalesPartiesSchema.safeParse({ parties }).success).toBe(true);
  });

  it('cada transición pide sus datos', () => {
    expect(TransitionSalesSchema.safeParse({ to: 'Cancelada' }).success).toBe(false);
    expect(TransitionSalesSchema.safeParse({ to: 'Cancelada', reason: 'se cayó' }).success).toBe(true);
    expect(TransitionSalesSchema.safeParse({ to: 'Boleto' }).success).toBe(false);
    expect(TransitionSalesSchema.safeParse({ to: 'Boleto', boletoDate: '2026-11-20' }).success).toBe(true);
    expect(TransitionSalesSchema.safeParse({ to: 'Escriturada' }).success).toBe(false);
    expect(TransitionSalesSchema.safeParse({ to: 'Reservada' }).success).toBe(true);
  });

  it('retener una seña exige el motivo; el honorario y la documentación se validan', () => {
    expect(ForfeitSalesDepositSchema.safeParse({}).success).toBe(false);
    expect(ForfeitSalesDepositSchema.safeParse({ note: 'el comprador desistió' }).success).toBe(true);
    expect(UpdateSalesDocCheckSchema.safeParse({}).success).toBe(false);
    expect(UpdateSalesDocCheckSchema.safeParse({ done: true }).success).toBe(true);
    expect(CreateSalesFeeSchema.safeParse({ pct: '3', payers: [{ role: 'Otro', personId: P1 }] }).success).toBe(false);
    expect(CreateSalesFeeSchema.safeParse({ pct: '3', payers: [{ role: 'Comprador', personId: P1 }] }).success).toBe(true);
  });

  it('las llaves: quien las tiene se identifica y la salida no es a la oficina', () => {
    expect(CreateKeySetSchema.parse({ label: 'Principal' })).toMatchObject({ holder: 'Oficina', copies: 1 });
    expect(CreateKeySetSchema.safeParse({ label: 'Principal', holder: 'Propietario' }).success).toBe(false);
    expect(CreateKeySetSchema.safeParse({ label: 'Principal', holder: 'Propietario', holderPersonId: P1 }).success).toBe(true);
    expect(KeyCheckOutSchema.safeParse({ holder: 'Oficina' }).success).toBe(false);
    expect(KeyCheckOutSchema.safeParse({ holder: 'Tercero' }).success).toBe(false);
    expect(KeyCheckOutSchema.safeParse({ holder: 'Tercero', holderName: 'Escribana' }).success).toBe(true);
  });
});
