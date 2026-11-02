import { Prisma } from '@prisma/client';
import { CashService } from './cash.service';

const ACC = '00000000-0000-4000-8000-0000000000a1';
const ACC2 = '00000000-0000-4000-8000-0000000000a2';
const OWNER = '00000000-0000-4000-8000-0000000000b1';

function build(opts: { accounts?: any[]; sums?: any[]; cash?: Record<string, unknown> } = {}) {
  const accounts = opts.accounts ?? [];
  const created: any[] = [];
  const db: any = {
    financialAccount: {
      findMany: jest.fn(async () => accounts),
      findFirst: jest.fn(async ({ where }: any) =>
        accounts.find((a) =>
          Object.entries(where).every(([k, v]) => (a as any)[k] === v || (k === 'isActive' && a.isActive !== false && v)),
        ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `new-${created.length}`, isActive: true, ...data };
        created.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => ({ ...accounts.find((a) => a.id === where.id), ...data })),
    },
    cashMovement: {
      groupBy: jest.fn(async () => opts.sums ?? []),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => ({ id: 'mov', ...data })),
    },
    person: { findFirst: jest.fn(async ({ where }: any) => (where.id === OWNER ? { id: OWNER, firstName: 'Ana', lastName: 'Locadora' } : null)) },
    contract: { findFirst: jest.fn(async () => null) },
    tenant: { findUnique: jest.fn() },
    $queryRaw: jest.fn(async () => [{ id: ACC }]),
  };
  db.$transaction = jest.fn((fn: any) => fn(db));
  const audit = { record: jest.fn() };
  const defaults = {
    get: jest.fn(async () => ({ cash: { custodyInAgencyBalance: false, ...(opts.cash ?? {}) } })),
  };
  const service = new CashService(
    { client: db } as any,
    { getTenantId: () => 't1', getUserId: () => 'u1' } as any,
    audit as any,
    defaults as any,
  );
  return { service, db, audit, created };
}

const sum = (accountId: string, direction: 'In' | 'Out', amount: string) => ({ accountId, direction, _sum: { amount } });

describe('CashService — cuentas', () => {
  const caja = { id: ACC, kind: 'Caja', currency: 'ARS', isActive: true, ownerPersonId: null };
  const custodia = { id: ACC2, kind: 'Custodia', currency: 'ARS', isActive: true, ownerPersonId: OWNER };

  it('saldos por cuenta y totales por moneda; la custodia suma solo si la inmobiliaria lo eligió', async () => {
    const sums = [sum(ACC, 'In', '1000'), sum(ACC, 'Out', '250.5'), sum(ACC2, 'In', '300')];
    const off = await build({ accounts: [caja, custodia], sums }).service.listAccounts({});
    expect(off.items.map((i: any) => i.balance)).toEqual(['749.50', '300.00']);
    expect(off.totals).toEqual([{ currency: 'ARS', agency: '749.50', custody: '300.00', total: '749.50' }]);
    const on = await build({ accounts: [caja, custodia], sums, cash: { custodyInAgencyBalance: true } }).service.listAccounts({
      includeInactive: 'true',
    });
    expect(on.totals[0].total).toBe('1049.50');
  });

  it('filtra por clase, moneda y dueño', async () => {
    const { service, db } = build();
    await service.listAccounts({ kind: 'Custodia', currency: 'USD', ownerPersonId: OWNER });
    expect(db.financialAccount.findMany.mock.calls[0][0].where).toEqual({
      kind: 'Custodia',
      currency: 'USD',
      ownerPersonId: OWNER,
      isActive: true,
    });
  });

  it('alta con auditoría; custodia con dueño inexistente o repetida se rechaza', async () => {
    const { service, audit } = build();
    const acc = await service.createAccount({ kind: 'Custodia', name: 'Custodia Ana', currency: 'USD', ownerPersonId: OWNER });
    expect(acc).toMatchObject({ kind: 'Custodia', balance: '0.00' });
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entity: 'FinancialAccount' }));

    await expect(
      service.createAccount({ kind: 'Custodia', name: 'X', currency: 'USD', ownerPersonId: ACC }),
    ).rejects.toMatchObject({ response: { error: 'PERSON_NOT_FOUND' } });

    const dup = build();
    dup.db.financialAccount.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(
      dup.service.createAccount({ kind: 'Custodia', name: 'X', currency: 'USD', ownerPersonId: OWNER }),
    ).rejects.toMatchObject({ response: { error: 'ACCOUNT_EXISTS' } });
  });

  it('no desactiva una cuenta con saldo; sí la renombra', async () => {
    const { service } = build({ accounts: [caja], sums: [sum(ACC, 'In', '10')] });
    await expect(service.updateAccount(ACC, { isActive: false })).rejects.toMatchObject({
      response: { error: 'ACCOUNT_HAS_BALANCE' },
    });
    expect(await service.updateAccount(ACC, { name: 'Caja chica' })).toMatchObject({ name: 'Caja chica' });
    await expect(build().service.updateAccount(ACC, { name: 'X' })).rejects.toMatchObject({
      response: { error: 'ACCOUNT_NOT_FOUND' },
    });
  });
});

describe('CashService — movimientos', () => {
  const caja = { id: ACC, kind: 'Caja', currency: 'ARS', isActive: true, ownerPersonId: null };
  const usd = { id: ACC2, kind: 'Banco', currency: 'USD', isActive: true, ownerPersonId: null };

  it('lista con filtros de cuenta, categoría, contrato y fechas', async () => {
    const { service, db } = build();
    const res = await service.listMovements({
      accountId: ACC,
      category: 'Gasto',
      contractId: ACC2,
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(res).toMatchObject({ total: 0, page: 1, limit: 20 });
    expect(db.cashMovement.findMany.mock.calls[0][0].where).toEqual({
      accountId: ACC,
      category: 'Gasto',
      contractId: ACC2,
      date: { gte: new Date('2026-01-01T00:00:00.000Z'), lte: new Date('2026-01-31T00:00:00.000Z') },
    });
  });

  it('un movimiento manual toma la moneda de la cuenta y valida contraparte y contrato', async () => {
    const { service, db } = build({ accounts: [caja] });
    const body = { accountId: ACC, date: '2026-02-01', direction: 'Out', amount: '100', category: 'Gasto' };
    const mov = await service.createMovement(body);
    expect(mov).toMatchObject({ currency: 'ARS', amount: '100.00', sourceType: 'Manual', createdById: 'u1' });
    await expect(service.createMovement({ ...body, counterpartyId: ACC })).rejects.toMatchObject({
      response: { error: 'PERSON_NOT_FOUND' },
    });
    await expect(service.createMovement({ ...body, contractId: ACC })).rejects.toMatchObject({
      response: { error: 'CONTRACT_NOT_FOUND' },
    });
    db.financialAccount.findFirst.mockResolvedValueOnce({ ...caja, isActive: false });
    await expect(service.createMovement(body)).rejects.toMatchObject({ response: { error: 'ACCOUNT_INACTIVE' } });
  });

  it('una conversión escribe dos movimientos con el tipo de cambio; misma moneda se rechaza', async () => {
    const { service } = build({ accounts: [caja, usd] });
    const res: any = await service.createConversion({
      fromAccountId: ACC2,
      toAccountId: ACC,
      date: '2026-02-01',
      amount: '10',
      rate: '1234.567',
    });
    expect([res.out.direction, res.out.amount, res.out.currency]).toEqual(['Out', '10.00', 'USD']);
    expect([res.in.direction, res.in.amount, res.in.currency, res.in.rate]).toEqual(['In', '12345.67', 'ARS', '1234.567']);
    const same = build({ accounts: [caja, { ...caja, id: ACC2 }] });
    await expect(
      same.service.createConversion({ fromAccountId: ACC, toAccountId: ACC2, date: '2026-02-01', amount: '1', rate: '1' }),
    ).rejects.toMatchObject({ response: { error: 'CONVERSION_SAME_CURRENCY' } });
  });

  it('recordMovement rechaza importes no positivos', async () => {
    const { service, db } = build();
    await expect(
      service.recordMovement(db, {
        tenantId: 't1',
        accountId: ACC,
        date: new Date(),
        direction: 'In' as any,
        amount: '0',
        currency: 'ARS',
        category: 'Gasto' as any,
      }),
    ).rejects.toMatchObject({ response: { error: 'INVALID_AMOUNT' } });
  });
});

describe('CashService — custodia y cuentas por defecto', () => {
  const custodia = { id: ACC, kind: 'Custodia', currency: 'USD', isActive: true, ownerPersonId: OWNER };

  it('entrega todo el saldo o una parte, nunca más de lo que hay', async () => {
    const ok = build({ accounts: [custodia], sums: [sum(ACC, 'In', '465')] });
    const all = await ok.service.deliverCustody(ACC, { date: '2026-01-15' });
    expect(all.balance).toBe('0.00');
    expect(all.movement).toMatchObject({ direction: 'Out', amount: '465.00', category: 'Custodia', counterpartyId: OWNER });
    await expect(ok.service.deliverCustody(ACC, { date: '2026-01-15', amount: '465.01' })).rejects.toMatchObject({
      response: { error: 'CUSTODY_INSUFFICIENT' },
    });
    await expect(build({ accounts: [custodia] }).service.deliverCustody(ACC, { date: '2026-01-15' })).rejects.toMatchObject({
      response: { error: 'CUSTODY_EMPTY' },
    });
    await expect(
      build({ accounts: [{ ...custodia, kind: 'Caja' }] }).service.deliverCustody(ACC, { date: '2026-01-15' }),
    ).rejects.toMatchObject({ response: { error: 'ACCOUNT_NOT_CUSTODY' } });
    const other = build();
    other.db.$queryRaw.mockResolvedValueOnce([]);
    await expect(other.service.deliverCustody(ACC, { date: '2026-01-15' })).rejects.toMatchObject({
      response: { error: 'ACCOUNT_NOT_FOUND' },
    });
  });

  it('cuenta del cobro: la indicada de la misma moneda, o la caja/el banco de la moneda creados al primer uso', async () => {
    const caja = { id: ACC2, kind: 'Caja', currency: 'ARS', isActive: true, ownerPersonId: null };
    const { service, db, created } = build({ accounts: [caja] });
    expect(await service.resolveAgencyAccount(db, 't1', { accountId: ACC2, currency: 'ARS', method: 'Transferencia' })).toBe(caja);
    await expect(
      service.resolveAgencyAccount(db, 't1', { accountId: ACC2, currency: 'USD', method: 'Efectivo' }),
    ).rejects.toMatchObject({ response: { error: 'CURRENCY_MISMATCH' } });
    expect(await service.resolveAgencyAccount(db, 't1', { currency: 'ARS', method: 'Efectivo' })).toBe(caja);
    const banco = await service.resolveAgencyAccount(db, 't1', { currency: 'ARS', method: 'Transferencia' });
    expect(banco).toMatchObject({ kind: 'Banco', name: 'Banco ARS', currency: 'ARS' });
    expect(created).toHaveLength(1);
    expect(db.$queryRaw).toHaveBeenCalled();
  });

  it('custodia de un locador: la existente, reactivada si estaba inactiva, o una nueva con su nombre', async () => {
    const active = build({ accounts: [custodia] });
    expect(await active.service.ensureCustodyAccount(active.db, 't1', OWNER, 'USD')).toBe(custodia);
    const inactive = build({ accounts: [{ ...custodia, isActive: false }] });
    expect(await inactive.service.ensureCustodyAccount(inactive.db, 't1', OWNER, 'USD')).toMatchObject({ isActive: true });
    const fresh = build();
    expect(await fresh.service.ensureCustodyAccount(fresh.db, 't1', OWNER, 'EUR')).toMatchObject({
      kind: 'Custodia',
      ownerPersonId: OWNER,
      name: 'Custodia Ana Locadora EUR',
    });
  });

  it('sin cuentas no consulta saldos', async () => {
    const { service, db } = build();
    expect((await service.balances(db, [])).size).toBe(0);
    expect(db.cashMovement.groupBy).not.toHaveBeenCalled();
  });
});
