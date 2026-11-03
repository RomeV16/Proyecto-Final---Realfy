import { SalesFeesService, primaryPayers } from './sales-fees.service';
import { IDS, makeDb, makeTenantContext, operation, utc } from './sales.testing';

const NOW = new Date('2026-11-10T15:00:00Z');

beforeAll(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance'],
  });
});
afterAll(() => jest.useRealTimers());

const parties = [
  { role: 'Comprador', personId: IDS.buyer, sharePct: '100', createdAt: utc(2026, 11, 1) },
  { role: 'Vendedor', personId: IDS.seller, sharePct: '100', createdAt: utc(2026, 11, 1) },
];

function build() {
  const db = makeDb();
  const audit = { record: jest.fn() };
  const fees = { createInTx: jest.fn().mockResolvedValue(['f1', 'f2']) };
  const proposal = { preview: jest.fn().mockResolvedValue({ kind: 'Venta', pct: '3', saleAsset: 'Construido', estimate: ['3600.00'] }) };
  const defaults = { get: jest.fn().mockResolvedValue({ fees: { vatMode: 'NoAplica', vatPct: 21, installments: 1 } }) };
  const sales = { findOne: jest.fn().mockResolvedValue('operation') };
  const service = new SalesFeesService({ client: db } as any, makeTenantContext() as any, audit as any, fees as any, proposal as any, defaults as any, sales as any);
  db.salesOperation.findFirst.mockResolvedValue(operation({ status: 'SenaRecibida', parties }));
  return { service, db, audit, fees, proposal, sales };
}

describe('primaryPayers', () => {
  it('elige por lado a la parte de mayor porcentaje y, a igualdad, la cargada primero', () => {
    const list = [
      { role: 'Comprador', personId: 'b2', sharePct: '40', createdAt: utc(2026, 11, 1) },
      { role: 'Comprador', personId: 'b1', sharePct: '60', createdAt: utc(2026, 11, 2) },
      { role: 'Vendedor', personId: 's2', sharePct: '50', createdAt: utc(2026, 11, 3) },
      { role: 'Vendedor', personId: 's1', sharePct: '50', createdAt: utc(2026, 11, 2) },
    ];
    expect(primaryPayers(list)).toEqual([
      { role: 'Comprador', personId: 'b1' },
      { role: 'Vendedor', personId: 's1' },
    ]);
    expect(primaryPayers(list.slice(0, 2))).toEqual([{ role: 'Comprador', personId: 'b1' }]);
    expect(primaryPayers([])).toEqual([]);
  });
});

describe('SalesFeesService.preview', () => {
  it('propone el porcentaje por defecto sobre el precio y un pagador por lado', async () => {
    const { service, proposal } = build();
    const res: any = await service.preview('op1');
    expect(proposal.preview).toHaveBeenCalledWith({ kind: 'Venta', propertyId: IDS.prop, baseAmount: '120000.00', currency: 'USD' });
    expect(res).toMatchObject({ salesOpId: 'op1', baseAmount: '120000.00', pct: '3', firstDueDate: '2026-11-10' });
    expect(res.payers).toHaveLength(2);
  });

  it('sin precio la base queda vacía y con escritura propone su fecha', async () => {
    const { service, db, proposal } = build();
    db.salesOperation.findFirst.mockResolvedValue(operation({ price: null, escrituraDate: utc(2026, 11, 5), parties }));
    const res: any = await service.preview('op1');
    expect(res.baseAmount).toBeNull();
    expect(res.firstDueDate).toBe('2026-11-05');
    expect(proposal.preview.mock.calls[0][0].baseAmount).toBe('0');
  });
});

describe('SalesFeesService.create', () => {
  it('crea el honorario vinculado a la operación: cada parte paga el porcentaje por defecto', async () => {
    const { service, fees, audit, db, sales } = build();
    db.salesOperation.findFirst.mockResolvedValue(operation({ status: 'Boleto', agreedPrice: '100000.00', parties }));
    expect(await service.create('op1', {})).toBe('operation');
    expect(sales.findOne).toHaveBeenCalledWith('op1');
    const [, tenantId, input] = fees.createInTx.mock.calls[0];
    expect(tenantId).toBe('t1');
    expect(input).toMatchObject({
      kind: 'Venta',
      salesOpId: 'op1',
      propertyId: IDS.prop,
      basis: 'ValorOperacion',
      baseAmount: '100000.00',
      pct: '3',
      currency: 'USD',
      payerMode: 'CadaParte',
      vatPct: '21',
      installments: 1,
      firstDueDate: '2026-11-10',
      shares: [],
      staff: [],
    });
    expect(input.payers).toEqual([
      { role: 'Comprador', personId: IDS.buyer },
      { role: 'Vendedor', personId: IDS.seller },
    ]);
    expect(audit.record).toHaveBeenCalledWith(db, expect.objectContaining({ metadata: expect.objectContaining({ operation: 'sales-fee-create', feeIds: ['f1', 'f2'] }) }));
  });

  it('respeta lo que el usuario fija: porcentaje, base, cuotas, fecha y pagadores', async () => {
    const { service, fees, proposal, db } = build();
    db.salesOperation.findFirst.mockResolvedValue(operation({ status: 'Escriturada', escrituraDate: utc(2026, 11, 5), parties }));
    await service.create('op1', { pct: '2.5', baseAmount: '90000', installments: 3, firstDueDate: '2026-12-01', payers: [{ role: 'Vendedor', personId: IDS.seller }], notes: 'acordado' });
    expect(proposal.preview).not.toHaveBeenCalled();
    expect(fees.createInTx.mock.calls[0][2]).toMatchObject({ pct: '2.5', baseAmount: '90000', installments: 3, firstDueDate: '2026-12-01', notes: 'acordado', payers: [{ role: 'Vendedor', personId: IDS.seller }] });
  });

  it('la fecha de la escritura es la primera cuota por defecto', async () => {
    const { service, fees, db } = build();
    db.salesOperation.findFirst.mockResolvedValue(operation({ status: 'Escriturada', escrituraDate: utc(2026, 11, 5), parties }));
    await service.create('op1', {});
    expect(fees.createInTx.mock.calls[0][2].firstDueDate).toBe('2026-11-05');
  });

  it('rechaza etapas tempranas, un segundo honorario, la falta de precio o de partes y pagadores ajenos', async () => {
    const { service, db } = build();
    db.salesOperation.findFirst.mockResolvedValue(operation({ status: 'Publicada', parties }));
    await expect(service.create('op1', {})).rejects.toMatchObject({ response: { error: 'INVALID_STAGE_FOR_FEE' } });
    db.salesOperation.findFirst.mockResolvedValue(operation({ status: 'Boleto', parties }));
    db.fee.count.mockResolvedValue(1);
    await expect(service.create('op1', {})).rejects.toMatchObject({ response: { error: 'SALES_FEE_EXISTS' } });
    db.fee.count.mockResolvedValue(0);
    db.salesOperation.findFirst.mockResolvedValue(operation({ status: 'Boleto', price: null, parties }));
    await expect(service.create('op1', {})).rejects.toMatchObject({ response: { error: 'PRICE_REQUIRED' } });
    db.salesOperation.findFirst.mockResolvedValue(operation({ status: 'Boleto', parties: [] }));
    await expect(service.create('op1', {})).rejects.toMatchObject({ response: { error: 'PAYERS_REQUIRED' } });
    db.salesOperation.findFirst.mockResolvedValue(operation({ status: 'Boleto', parties }));
    await expect(service.create('op1', { payers: [{ role: 'Comprador', personId: IDS.seller }] })).rejects.toMatchObject({ response: { error: 'PAYER_NOT_PARTY' } });
  });
});
