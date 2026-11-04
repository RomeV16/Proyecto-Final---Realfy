import { CashService } from './cash.service';

const ACC = '00000000-0000-4000-8000-0000000000a1';
const OWNER = '00000000-0000-4000-8000-0000000000b1';

function build(account: any, existing: any = null, sums: any[] = []) {
  const db: any = {
    financialAccount: { findFirst: jest.fn(async () => account) },
    cashMovement: {
      findFirst: jest.fn(async () => existing),
      create: jest.fn(async ({ data }: any) => ({ id: 'mov', ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...existing, ...data })),
      delete: jest.fn(async () => ({})),
      groupBy: jest.fn(async () => sums),
    },
    $queryRaw: jest.fn(async () => [{ id: ACC }]),
  };
  db.$transaction = jest.fn((fn: any) => fn(db));
  const audit = { record: jest.fn() };
  const service = new CashService(
    { client: db } as any,
    { getTenantId: () => 't1', getUserId: () => 'u1' } as any,
    audit as any,
    { get: jest.fn() } as any,
  );
  return { service, db, audit };
}

const custody = { id: ACC, kind: 'Custodia', currency: 'USD', isActive: true, ownerPersonId: OWNER };
const caja = { id: ACC, kind: 'Caja', currency: 'ARS', isActive: true, ownerPersonId: null };
const row = (over: Record<string, unknown> = {}) => ({
  id: 'op1',
  amount: '500.00',
  direction: 'In',
  date: new Date('2026-10-31T00:00:00.000Z'),
  ...over,
});

describe('CashService.setOpeningBalance', () => {
  it('crea el asiento de apertura en la moneda de la cuenta, con motivo en la auditoría', async () => {
    const { service, db, audit } = build(custody, null, [{ accountId: ACC, direction: 'In', _sum: { amount: '500' } }]);
    const res = await service.setOpeningBalance(ACC, { amount: '500', date: '2026-10-31', reason: 'Custodia al corte' });
    expect(db.cashMovement.create.mock.calls[0][0].data).toMatchObject({
      accountId: ACC,
      direction: 'In',
      amount: '500.00',
      currency: 'USD',
      category: 'SaldoInicial',
      sourceType: 'OpeningBalance',
      sourceId: ACC,
    });
    expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'CREATE', metadata: { reason: 'Custodia al corte', currency: 'USD' } });
    expect(res).toMatchObject({ changed: true, balance: '500.00', currency: 'USD' });
  });

  it('reenviar lo mismo no cambia nada ni audita', async () => {
    const { service, db, audit } = build(custody, row());
    const res = await service.setOpeningBalance(ACC, { amount: 500, date: '2026-10-31', reason: 'Custodia al corte' });
    expect(res.changed).toBe(false);
    expect(db.cashMovement.create).not.toHaveBeenCalled();
    expect(db.cashMovement.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('un importe distinto corrige el mismo asiento', async () => {
    const { service, db, audit } = build(custody, row());
    await service.setOpeningBalance(ACC, { amount: '650.50', date: '2026-10-31', reason: 'Corrección del conteo' });
    expect(db.cashMovement.update.mock.calls[0][0]).toMatchObject({ where: { id: 'op1' }, data: { amount: '650.50', direction: 'In' } });
    expect(db.cashMovement.create).not.toHaveBeenCalled();
    expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'UPDATE' });
  });

  it('un saldo negativo en caja o banco es una salida', async () => {
    const { service, db } = build(caja);
    await service.setOpeningBalance(ACC, { amount: '-120.00', reason: 'Descubierto al corte' });
    expect(db.cashMovement.create.mock.calls[0][0].data).toMatchObject({ direction: 'Out', amount: '120.00', currency: 'ARS' });
  });

  it('la custodia no arranca en negativo', async () => {
    const { service } = build(custody);
    await expect(service.setOpeningBalance(ACC, { amount: '-1', reason: 'Prueba' })).rejects.toMatchObject({
      response: { error: 'CUSTODY_OPENING_NEGATIVE' },
    });
  });

  it('cero sin asiento no deja nada; cero con asiento lo quita', async () => {
    const none = build(caja);
    expect((await none.service.setOpeningBalance(ACC, { amount: '0', reason: 'Sin saldo' })).changed).toBe(false);
    expect(none.db.cashMovement.create).not.toHaveBeenCalled();
    const some = build(caja, row());
    const res = await some.service.setOpeningBalance(ACC, { amount: '0', reason: 'Se anula la apertura' });
    expect(some.db.cashMovement.delete).toHaveBeenCalled();
    expect(some.audit.record.mock.calls[0][1]).toMatchObject({ action: 'DELETE' });
    expect(res).toMatchObject({ movement: null, changed: true });
  });

  it('rechaza una cuenta inactiva, un cuerpo inválido y campos de más', async () => {
    await expect(build({ ...caja, isActive: false }).service.setOpeningBalance(ACC, { amount: '1', reason: 'Prueba' })).rejects.toMatchObject({
      response: { error: 'ACCOUNT_INACTIVE' },
    });
    const { service } = build(caja);
    await expect(service.setOpeningBalance(ACC, { amount: '1.234', reason: 'Prueba' })).rejects.toBeDefined();
    await expect(service.setOpeningBalance(ACC, { amount: '1', reason: 'ab' })).rejects.toBeDefined();
    await expect(service.setOpeningBalance(ACC, { amount: '1', reason: 'Prueba', currency: 'EUR' })).rejects.toBeDefined();
  });
});
