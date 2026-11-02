import { OperationalDefaultsSchema } from '@realfy/shared';
import Decimal from 'decimal.js';
import { OwnerLedgerService } from './owner-ledger.service';
import { day, fakeDb } from './owner-accounts.testing';

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b1';
const ACC = '00000000-0000-4000-8000-0000000000c1';
const C = '00000000-0000-4000-8000-0000000000d1';

const entry = (over: Record<string, unknown>) => ({
  tenantId: 't1',
  personId: A,
  currency: 'ARS',
  period: day('2026-10-01'),
  statementId: null,
  sourceType: 'Payment',
  sourceId: 'pay-1',
  description: 'x',
  propertyId: 'p1',
  contractId: 'c1',
  ...over,
});

function setup(opts: { closeDay?: number | null } = {}) {
  const db = fakeDb({
    persons: [
      { id: A, firstName: 'Ana', lastName: 'Locadora' },
      { id: B, firstName: 'Beto', lastName: 'Dueño' },
      { id: C, firstName: 'Carla', lastName: 'Nueva' },
    ],
    properties: [{ id: 'p1', title: 'Belgrano 100' }],
    lessors: [
      { contractId: 'c1', personId: A },
      { contractId: 'c9', personId: C },
    ],
    accounts: [{ id: 'cust-a', kind: 'Custodia', ownerPersonId: A, currency: 'USD' }],
    entries: [
      entry({ type: 'SaldoInicial', amount: '-1500.00', date: day('2026-09-30'), period: day('2026-09-01'), sourceType: 'OpeningBalance', sourceId: 'ARS', propertyId: null }),
      entry({ type: 'Alquiler', amount: '100000.00', date: day('2026-10-08') }),
      entry({ type: 'Comision', amount: '-7000.00', date: day('2026-10-08') }),
      entry({ type: 'Transferencia', amount: '-50000.00', date: day('2026-10-20'), sourceType: 'CashMovement', sourceId: 'm0', propertyId: null }),
      entry({ type: 'Alquiler', amount: '800.00', currency: 'USD', date: day('2026-10-08'), sourceId: 'pay-usd' }),
      entry({ personId: B, type: 'CobroDirecto', amount: '-300.00', date: day('2026-10-09'), sourceId: 'pay-b' }),
    ],
  });
  const defaults = OperationalDefaultsSchema.parse({ ownerAccounts: { statementCloseDay: opts.closeDay ?? null } });
  const audit = { record: jest.fn() };
  const cash = {
    balances: jest.fn(async (_db: any, ids: string[]) => new Map(ids.map((id) => [id, new Decimal(id === 'cust-a' ? '300' : '0')]))),
    findAccount: jest.fn(async (_db: any, id: string) => {
      if (id !== ACC) throw Object.assign(new Error('nf'), { response: { error: 'ACCOUNT_NOT_FOUND' } });
      return { id: ACC, kind: 'Banco', currency: 'ARS', isActive: true, name: 'Banco ARS' };
    }),
    assertOperational: jest.fn(),
    lockAccount: jest.fn(),
    recordMovement: jest.fn(async (_tx: any, input: any) => ({ id: 'mov-1', ...input })),
  };
  const service = new OwnerLedgerService(
    { client: db } as any,
    { getTenantId: () => 't1', getUserId: () => 'u1' } as any,
    audit as any,
    { get: jest.fn(async () => defaults) } as any,
    cash as any,
  );
  return { db, service, audit, cash };
}

describe('OwnerLedgerService — cuenta corriente (CP-459)', () => {
  it('movimientos de una moneda con el saldo después de cada uno', async () => {
    const { service } = setup();
    const res = await service.ledger(A, {});
    expect(res).toMatchObject({ currency: 'ARS', currencies: ['ARS', 'USD'], opening: '0.00', closing: '41500.00', custody: '0.00', total: 4 });
    expect(res.items.map((i: any) => [i.type, i.amount, i.balance, i.property])).toEqual([
      ['SaldoInicial', '-1500.00', '-1500.00', null],
      ['Alquiler', '100000.00', '98500.00', 'Belgrano 100'],
      ['Comision', '-7000.00', '91500.00', 'Belgrano 100'],
      ['Transferencia', '-50000.00', '41500.00', null],
    ]);
  });

  it('desde una fecha: el saldo anterior abre la lista; paginado', async () => {
    const { service } = setup();
    const res = await service.ledger(A, { from: '2026-10-10', to: '2026-10-31', limit: '1' });
    expect(res).toMatchObject({ opening: '91500.00', closing: '41500.00', total: 1, totalPages: 1 });
    const usd = await service.ledger(A, { currency: 'USD' });
    expect(usd).toMatchObject({ closing: '800.00', custody: '300.00' });
  });

  it('los asientos de una misma operación salen en orden de concepto, no según su id', async () => {
    const { service, db } = setup();
    const at = new Date('2026-10-10T12:00:00.000Z');
    const same = { date: day('2026-10-09'), createdAt: at, sourceId: 'pay-b2', personId: B };
    // Ids al revés del orden de concepto: el orden no puede depender del id.
    db.ownerLedgerEntry.rows.push(
      entry({ ...same, id: 'a-direct', type: 'CobroDirecto', amount: '-10.00' }),
      entry({ ...same, id: 'z-rent', type: 'Alquiler', amount: '10.00' }),
      entry({ ...same, id: 'm-fee', type: 'Comision', amount: '-1.00' }),
    );
    const res = await service.ledger(B, {});
    expect(res.items.map((i: any) => i.type)).toEqual(['CobroDirecto', 'Alquiler', 'Comision', 'CobroDirecto']);
  });

  it('locador inexistente: 404', async () => {
    await expect(setup().service.ledger('00000000-0000-4000-8000-000000000999', {})).rejects.toMatchObject({
      response: { error: 'PERSON_NOT_FOUND' },
    });
  });

  it('saldos por locador y moneda, con custodia y lo que falta pagar', async () => {
    const { service } = setup();
    const { items } = await service.balances({});
    expect(items.map((i: any) => [i.name, i.currency, i.balance, i.custody, i.payoutDue])).toEqual([
      ['Ana Locadora', 'ARS', '41500.00', '0.00', '41500.00'],
      ['Ana Locadora', 'USD', '800.00', '300.00', '500.00'],
      ['Beto Dueño', 'ARS', '-300.00', '0.00', '0.00'],
      // Locadora sin movimientos: aparece en cero para cargarle el saldo inicial.
      ['Carla Nueva', 'ARS', '0.00', '0.00', '0.00'],
    ]);
    expect((await service.balances({ currency: 'EUR' })).items).toEqual([]);
    expect((await service.balances({ currency: 'USD' })).items.map((i: any) => i.name)).toEqual(['Ana Locadora']);
  });
});

describe('OwnerLedgerService — saldo inicial (CP-460)', () => {
  it('lo crea y lo corrige con el motivo en la auditoría', async () => {
    const { service, db, audit } = setup({ closeDay: 10 });
    const created = await service.setOpeningBalance(B, { currency: 'USD', amount: '-250.5', date: '2026-10-15', reason: 'último acumulador' });
    expect(created).toMatchObject({ personId: B, type: 'SaldoInicial', amount: '-250.50', currency: 'USD' });
    // Con cierre el día 10, lo del 15 va al estado de noviembre.
    const row = db.ownerLedgerEntry.rows.find((e: any) => e.personId === B && e.type === 'SaldoInicial');
    expect(row).toMatchObject({ sourceType: 'OpeningBalance', sourceId: 'USD', period: day('2026-11-01') });
    expect(audit.record).toHaveBeenLastCalledWith(
      db,
      expect.objectContaining({ action: 'CREATE', metadata: expect.objectContaining({ reason: 'último acumulador' }) }),
    );

    const fixed = await service.setOpeningBalance(B, { currency: 'USD', amount: '100', reason: 'corrección' });
    expect(fixed.amount).toBe('100.00');
    expect(audit.record).toHaveBeenLastCalledWith(db, expect.objectContaining({ action: 'UPDATE', before: expect.objectContaining({ amount: '-250.50' }) }));
  });

  it('cero no deja asiento; uno ya emitido no se corrige; pide motivo', async () => {
    const { service, db } = setup();
    const zero = await service.setOpeningBalance(B, { currency: 'EUR', amount: '0', reason: 'sin saldo' });
    expect(zero.amount).toBe('0.00');
    expect(db.ownerLedgerEntry.rows.some((e: any) => e.currency === 'EUR')).toBe(false);
    db.ownerLedgerEntry.rows[0].statementId = 'st-1';
    await expect(service.setOpeningBalance(A, { currency: 'ARS', amount: '10', reason: 'corrección' })).rejects.toMatchObject({
      response: { error: 'OPENING_BALANCE_LOCKED' },
    });
    await expect(service.setOpeningBalance(A, { currency: 'ARS', amount: '10', reason: '' })).rejects.toMatchObject({
      response: { error: 'VALIDATION_ERROR' },
    });
  });
});

describe('OwnerLedgerService — pago al locador (CP-461)', () => {
  it('egreso PagoLocador en la cuenta y asiento que baja el saldo, en una transacción', async () => {
    const { service, db, cash, audit } = setup();
    const res = await service.payout(A, { accountId: ACC, method: 'Transferencia', amount: '41500', date: '2026-10-31', note: 'CBU 123' });
    expect(cash.recordMovement).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ direction: 'Out', category: 'PagoLocador', counterpartyId: A, currency: 'ARS', amount: '41500', sourceType: 'OwnerPayout' }),
    );
    expect(res.entry).toMatchObject({ type: 'Transferencia', amount: '-41500.00', sourceType: 'CashMovement', sourceId: 'mov-1' });
    expect(res.entry.description).toBe('Transferencia desde Banco ARS — CBU 123');
    expect(res.balance).toBe('0.00');
    expect(cash.lockAccount).toHaveBeenCalledWith(db, 't1', ACC);
    expect(audit.record).toHaveBeenCalledWith(db, expect.objectContaining({ metadata: { operation: 'owner-payout', method: 'Transferencia' } }));

    const cashOut = await service.payout(B, { accountId: ACC, method: 'EntregaEfectivo', amount: '100', date: '2026-10-31' });
    expect(cashOut.entry.description).toBe('Entrega de efectivo desde Banco ARS');
    expect(cashOut.balance).toBe('-400.00');
  });

  it('valida método e importe', async () => {
    const { service } = setup();
    await expect(service.payout(A, { accountId: ACC, method: 'Cargo', amount: '1', date: '2026-10-31' })).rejects.toMatchObject({
      response: { error: 'VALIDATION_ERROR' },
    });
  });
});
