import { DEFAULT_OPERATIONAL_DEFAULTS, OperationalDefaultsSchema } from '@realfy/shared';
import { PaymentSettlementService, commissionFor } from './payment-settlement.service';

const A = 'lessor-a';
const B = 'lessor-b';
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

function build(
  opts: {
    flow?: string;
    cash?: Record<string, unknown>;
    lessors?: any[];
    commission?: any;
    users?: string[];
    terms?: Record<string, unknown>;
    lines?: any[];
  } = {},
) {
  const contract = {
    id: 'contract-1',
    propertyId: 'prop-1',
    commission: opts.commission ?? null,
    termsVersions: opts.flow || opts.terms ? [{ validFrom: D('2026-01-01'), paymentFlow: opts.flow, ...(opts.terms ?? {}) }] : [],
    lessors: opts.lessors ?? [
      { personId: A, payoutPct: '50', validFrom: D('2026-01-01'), validTo: null },
      { personId: B, payoutPct: '50', validFrom: D('2026-01-01'), validTo: null },
    ],
    persons: [{ personId: 'tenant-person', role: 'Inquilino' }],
  };
  const movements: any[] = [];
  const ledger: any[] = [];
  const tx: any = {
    ownerLedgerEntry: {
      createMany: jest.fn(async ({ data }: any) => {
        ledger.push(...data);
        return { count: data.length };
      }),
    },
    contract: { findFirst: jest.fn(async () => contract) },
    user: { findFirst: jest.fn(async ({ where }: any) => ((opts.users ?? ['u2']).includes(where.id) ? { id: where.id } : null)) },
    receipt: { create: jest.fn(async ({ data }: any) => ({ id: 'rec-1', ...data })) },
    payment: { update: jest.fn(async ({ data }: any) => ({ id: 'pay-1', ...data })) },
    $queryRaw: jest.fn(async () => [{ next: 8 }]),
  };
  const cash = {
    resolveAgencyAccount: jest.fn(async (_tx: any, _t: string, ctx: any) => ({ id: ctx.accountId ?? 'caja-ars' })),
    ensureCustodyAccount: jest.fn(async (_tx: any, _t: string, owner: string) => ({ id: `custody-${owner}` })),
    recordMovement: jest.fn(async (_tx: any, input: any) => {
      movements.push(input);
      return input;
    }),
  };
  const defaults = OperationalDefaultsSchema.parse({ cash: opts.cash ?? {} });
  const audit = { record: jest.fn() };
  const service = new PaymentSettlementService(
    cash as any,
    { get: jest.fn(async () => defaults) } as any,
    audit as any,
    { getUserId: () => 'u1' } as any,
  );
  const ctx = (input: Record<string, unknown> = {}, amount = '100000') => ({
    tenantId: 't1',
    liquidacion: {
      id: 'liq-1',
      contractId: 'contract-1',
      period: D('2026-01-01'),
      currency: 'ARS',
      lineItems: opts.lines ?? [{ amount: '100000', beneficiary: 'Locador', commissionable: true, currency: 'ARS', type: 'Alquiler' }],
    },
    payment: { id: 'pay-1', amount, method: 'Efectivo', paidAt: new Date('2026-01-08T12:00:00.000Z') },
    paidBefore: '0',
    input,
  });
  return { service, tx, cash, movements, ledger, audit, ctx };
}

describe('PaymentSettlementService', () => {
  it('flujo de la inmobiliaria: ingreso en la caja, recibo numerado y reparto guardado', async () => {
    const { service, tx, movements, ctx, audit } = build();
    const res = await service.record(tx, ctx());
    expect(res).toMatchObject({ receivedBy: 'Inmobiliaria', accountId: 'caja-ars', receiptId: 'rec-1', receivedByUserId: 'u1' });
    expect(res.settlement).toMatchObject({ flow: 'Inmobiliaria', payment: { agency: '7000.00', lessors: '93000.00' } });
    expect(movements).toEqual([
      expect.objectContaining({ direction: 'In', category: 'AlquilerCobrado', amount: expect.anything(), counterpartyId: 'tenant-person', sourceId: 'pay-1' }),
    ]);
    expect(String(movements[0].amount)).toBe('100000');
    expect(tx.receipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ series: 'RECIBO_COBRO', number: 7, amount: '100000.00', currency: 'ARS' }),
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ entity: 'Payment', entityId: 'pay-1' }));
  });

  it('el flujo TodoLocador hace que el cobro lo reciba el locador: sin caja ni recibo', async () => {
    const { service, tx, movements, ctx } = build({ flow: 'TodoLocador' });
    const res = await service.record(tx, ctx());
    expect(res).toMatchObject({ receivedBy: 'Locador', accountId: null, receiptId: null, receivedByUserId: null });
    expect(res.settlement.positions.map((p: any) => p.balance)).toEqual(['-3500.00', '-3500.00']);
    expect(movements).toHaveLength(0);
    // Con una cuenta indicada, aunque el contrato sea TodoLocador, cobró la inmobiliaria.
    const explicit = await service.record(tx, ctx({ accountId: 'banco-1' }));
    expect(explicit).toMatchObject({ receivedBy: 'Inmobiliaria', accountId: 'banco-1' });
  });

  it('con la opción de recibo también cuando cobra el locador, y serie por moneda', async () => {
    const { service, tx, ctx } = build({ cash: { receiptWhenLessorReceives: true, receiptSeries: 'PorMoneda' } });
    const res = await service.record(tx, ctx({ receivedBy: 'Locador' }));
    expect(res.receiptId).toBe('rec-1');
    expect(tx.receipt.create.mock.calls[0][0].data.series).toBe('RECIBO_COBRO_ARS');
  });

  it('custodia: a la caja lo de la inmobiliaria y a la custodia de cada locador su parte', async () => {
    const { service, tx, movements, ctx } = build();
    const res = await service.record(tx, ctx({ inCustody: true }));
    expect(res.inCustody).toBe(true);
    expect(movements.map((m) => [m.accountId, m.category, String(m.amount)])).toEqual([
      ['caja-ars', 'AlquilerCobrado', '7000'],
      [`custody-${A}`, 'Custodia', '46500'],
      [`custody-${B}`, 'Custodia', '46500'],
    ]);
  });

  it('sin locadores válidos, lo que entra a la caja se registra igual y el reparto queda con el error', async () => {
    const { service, tx, movements, ctx } = build({ lessors: [] });
    const res = await service.record(tx, ctx());
    expect(res.settlement).toEqual({ error: expect.objectContaining({ code: 'SETTLEMENT_LESSOR_SHARES' }) });
    expect(String(movements[0].amount)).toBe('100000');
    // Pero sin reparto no hay custodia ni cobro del locador.
    await expect(service.record(tx, ctx({ inCustody: true }))).rejects.toMatchObject({
      response: { error: 'SETTLEMENT_LESSOR_SHARES' },
    });
    await expect(service.record(tx, ctx({ receivedBy: 'Locador' }))).rejects.toMatchObject({
      response: { error: 'SETTLEMENT_LESSOR_SHARES' },
    });
  });

  it('quién recibió en la oficina: el indicado si existe', async () => {
    const { service, tx, ctx } = build();
    expect((await service.record(tx, ctx({ receivedByUserId: 'u2' }))).receivedByUserId).toBe('u2');
    await expect(service.record(tx, ctx({ receivedByUserId: 'u9' }))).rejects.toMatchObject({
      response: { error: 'USER_NOT_FOUND' },
    });
  });

  it('un cobro del locador no lleva cuenta de la inmobiliaria', async () => {
    const { service, tx, ctx } = build();
    await expect(service.record(tx, ctx({ receivedBy: 'Locador', accountId: 'caja' }))).rejects.toMatchObject({
      response: { error: 'VALIDATION_ERROR' },
    });
  });
});

describe('PaymentSettlementService — cuenta corriente del locador (ADR-0009)', () => {
  const rows = (ledger: any[]) => ledger.map((e) => [e.personId, e.type, e.amount]);

  it('cobra la inmobiliaria: a cada locador su alquiler bruto y la comisión, con el cobro como origen (CP-451)', async () => {
    const { service, tx, ledger, ctx, audit } = build();
    await service.record(tx, ctx());
    expect(rows(ledger)).toEqual([
      [A, 'Alquiler', '50000.00'],
      [A, 'Comision', '-3500.00'],
      [B, 'Alquiler', '50000.00'],
      [B, 'Comision', '-3500.00'],
    ]);
    expect(ledger[0]).toMatchObject({
      tenantId: 't1',
      sourceType: 'Payment',
      sourceId: 'pay-1',
      contractId: 'contract-1',
      propertyId: 'prop-1',
      currency: 'ARS',
      date: D('2026-01-08'),
      period: D('2026-01-01'),
    });
    expect(tx.ownerLedgerEntry.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ metadata: expect.objectContaining({ ledgerEntries: 4 }) }));
  });

  it('cobra el locador: lo bruto y lo cobrado en mano; el saldo es lo que debe (CP-452)', async () => {
    const { service, tx, ledger, ctx } = build({ flow: 'TodoLocador' });
    await service.record(tx, ctx());
    expect(rows(ledger).filter((r) => r[0] === A)).toEqual([
      [A, 'Alquiler', '50000.00'],
      [A, 'Comision', '-3500.00'],
      [A, 'CobroDirecto', '-50000.00'],
    ]);
  });

  it('lo que debe el locador que cobró se pacta por contrato y pisa el de la inmobiliaria (CP-453)', async () => {
    const lines = [
      { amount: '100000', beneficiary: 'Locador', commissionable: true, currency: 'ARS', type: 'Alquiler' },
      { amount: '1000', beneficiary: 'Ente', commissionable: false, currency: 'ARS', type: 'Impuesto' },
    ];
    const own = build({ flow: 'TodoLocador', terms: { lessorDirectOwes: 'SoloInmobiliaria' }, lines });
    const res = await own.service.record(own.tx, own.ctx({}, '101000'));
    expect(res.settlement.enteHeldBy).toBe('Locador');
    // Recibió 46500 + 3500 + 500 de entes; lo que retiene para el ente no cuenta como cobrado para la inmobiliaria.
    expect(own.ledger.find((e) => e.personId === A && e.type === 'CobroDirecto').amount).toBe('-50000.00');

    const agencyDefault = build({ flow: 'TodoLocador', terms: { lessorDirectOwes: null }, lines });
    const res2 = await agencyDefault.service.record(agencyDefault.tx, agencyDefault.ctx({}, '101000'));
    expect(res2.settlement.enteHeldBy).toBe('Inmobiliaria');
    expect(agencyDefault.ledger.find((e) => e.personId === A && e.type === 'CobroDirecto').amount).toBe('-50500.00');
  });

  it('DEF-70 — un renglón Descuento (guardado en positivo) resta del total, de la comisión y de lo del locador (CP-660)', async () => {
    const line = (type: string, amount: string, commissionable: boolean) => ({
      amount,
      beneficiary: 'Locador',
      commissionable,
      currency: 'ARS',
      type,
    });
    // Devolución a favor del inquilino (sin comisión): la liquidación es 330000 - 12000 = 318000.
    const devolucion = build({ lines: [line('Alquiler', '330000', true), line('Descuento', '12000', false)] });
    const paid = await devolucion.service.record(devolucion.tx, devolucion.ctx({}, '318000'));
    expect(paid.settlement).toMatchObject({
      buckets: { total: '318000.00', commissionBase: '330000.00', commission: '23100.00', lessors: '294900.00' },
      payment: { agency: '23100.00', lessors: '294900.00' },
    });
    expect(rows(devolucion.ledger).filter((r) => r[0] === A)).toEqual([
      [A, 'Alquiler', '159000.00'],
      [A, 'Comision', '-11550.00'],
    ]);
    // Bonificación del 10 % (con comisión): la comisión corre sobre 90000.
    const bonificacion = build({ lines: [line('Alquiler', '100000', true), line('Descuento', '10000', true)] });
    const res = await bonificacion.service.record(bonificacion.tx, bonificacion.ctx({}, '90000'));
    expect(res.settlement).toMatchObject({ buckets: { total: '90000.00', commission: '6300.00', lessors: '83700.00' } });
  });

  it('un cobro sin reparto no deja asientos', async () => {
    const { service, tx, ledger, ctx } = build({ lessors: [] });
    await service.record(tx, ctx());
    expect(ledger).toEqual([]);
  });
});

describe('commissionFor', () => {
  it('la del contrato o el porcentaje de la inmobiliaria; un monto fijo en otra moneda no se mezcla', () => {
    expect(commissionFor(null, 'ARS', DEFAULT_OPERATIONAL_DEFAULTS)).toEqual({ type: 'FixedPercent', percentage: '7' });
    expect(
      commissionFor({ commission: { type: 'FixedAmount', currency: 'ARS', fixedAmount: 500, adminFee: null } }, 'ARS', DEFAULT_OPERATIONAL_DEFAULTS),
    ).toMatchObject({ type: 'FixedAmount', fixedAmount: '500' });
    expect(() =>
      commissionFor({ commission: { type: 'FixedAmount', currency: 'USD', fixedAmount: 5 } }, 'ARS', DEFAULT_OPERATIONAL_DEFAULTS),
    ).toThrow(expect.objectContaining({ code: 'SETTLEMENT_CURRENCY_MISMATCH' }));
  });
});
