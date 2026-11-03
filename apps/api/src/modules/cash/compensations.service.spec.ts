import { OperationalDefaultsSchema } from '@realfy/shared';
import Decimal from 'decimal.js';
import { CompensationsService } from './compensations.service';

const PAY = '00000000-0000-4000-8000-000000000001';
const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b1';
const X = '00000000-0000-4000-8000-0000000000c1';
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

function build(opts: { payment?: any; lessorships?: number; custody?: any; balance?: string; scope?: string } = {}) {
  const payment =
    opts.payment === undefined
      ? {
          id: PAY,
          amount: '100000',
          currency: 'ARS',
          receivedBy: 'Locador',
          settlement: { positions: [{ personId: A, share: '46500.00' }, { personId: B, share: '46500.00' }] },
          compensations: [],
          liquidacion: {
            contractId: 'c1',
            period: D('2026-01-01'),
            contract: {
              id: 'c1',
              propertyId: 'p1',
              lessors: [
                { personId: A, payoutPct: '50', validFrom: D('2026-01-01'), validTo: null },
                { personId: B, payoutPct: '50', validFrom: D('2026-01-01'), validTo: null },
              ],
            },
          },
        }
      : opts.payment;
  const tx: any = {
    payment: { findFirst: jest.fn(async () => payment) },
    person: { findFirst: jest.fn(async ({ where }: any) => (where.id === X || where.id === A ? { id: where.id, _count: { lessorships: opts.lessorships ?? 1 } } : null)) },
    compensation: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'comp-1',
        ...data,
        fromLessor: { id: data.fromLessorId, firstName: 'Ana', lastName: 'Uno' },
        toLessor: { id: data.toLessorId, firstName: 'Beto', lastName: 'Dos' },
      })),
      findMany: jest.fn(async () => []),
    },
    financialAccount: { findFirst: jest.fn(async () => opts.custody ?? null) },
    ownerLedgerEntry: { createMany: jest.fn(async ({ data }: any) => ({ count: data.length })) },
  };
  tx.$transaction = jest.fn((fn: any) => fn(tx));
  const cash = {
    lockAccount: jest.fn(),
    balances: jest.fn(async (_db: any, ids: string[]) => new Map(ids.map((id) => [id, new Decimal(opts.balance ?? '0')]))),
    resolveAgencyAccount: jest.fn(async () => ({ id: 'caja-ars' })),
    recordMovement: jest.fn(async (_tx: any, input: any) => input),
  };
  const defaults = OperationalDefaultsSchema.parse({ cash: { compensationScope: opts.scope ?? 'CualquierLocador' } });
  const service = new CompensationsService(
    { client: tx } as any,
    { getTenantId: () => 't1', getUserId: () => 'u1' } as any,
    { record: jest.fn() } as any,
    { get: jest.fn(async () => defaults) } as any,
    cash as any,
  );
  return { service, tx, cash, payment };
}

describe('CompensationsService', () => {
  it('sin importe, compensa la parte del locador en el cobro menos lo ya compensado', async () => {
    const { service, payment } = build();
    payment.compensations = [{ toLessorId: A, amount: '1500' }];
    const res = await service.create({ paymentId: PAY, fromLessorId: X, toLessorId: A });
    expect(res).toMatchObject({ amount: '45000.00', fromLessorId: X, toLessorId: A, currency: 'ARS', movements: [] });
  });

  it('DEF-71 — sin importe, compensa lo que el locador figuraba cobrando en mano: su parte más lo que debía (CP-661)', async () => {
    const { service, payment, tx } = build();
    // Cobro de 100000 que figura recibido por los locadores: cada uno, su parte (46500) y la comisión que debe (3500).
    payment.settlement = {
      positions: [
        { personId: A, share: '46500.00', received: '50000.00', balance: '-3500.00' },
        { personId: B, share: '46500.00', received: '50000.00', balance: '-3500.00' },
      ],
    };
    const res = await service.create({ paymentId: PAY, fromLessorId: X, toLessorId: A });
    expect(res.amount).toBe('50000.00');
    const { data } = tx.ownerLedgerEntry.createMany.mock.calls[0][0];
    expect(data.map((e: any) => [e.personId, e.amount])).toEqual([
      [X, '-50000.00'],
      [A, '50000.00'],
    ]);
  });

  it('cuenta corriente: resta a quien cobró y suma a quien le correspondía, con la compensación como origen (CP-454)', async () => {
    const { service, tx } = build();
    await service.create({ paymentId: PAY, fromLessorId: X, toLessorId: A, amount: '1000' });
    const { data, skipDuplicates } = tx.ownerLedgerEntry.createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data.map((e: any) => [e.personId, e.type, e.amount, e.sourceType, e.sourceId, e.propertyId])).toEqual([
      [X, 'Compensacion', '-1000.00', 'Compensation', 'comp-1', 'p1'],
      [A, 'Compensacion', '1000.00', 'Compensation', 'comp-1', 'p1'],
    ]);
    expect(data[0].description).toContain('Beto Dos');
    expect(data[1].description).toContain('Ana Uno');
  });

  it('DEF-72 — los asientos llevan la fecha del cobro, no la del día en que se carga la compensación (CP-662)', async () => {
    const { service, payment, tx } = build();
    payment.paidAt = new Date('2026-01-08T15:00:00.000Z');
    await service.create({ paymentId: PAY, fromLessorId: X, toLessorId: A, amount: '1000' });
    const { data } = tx.ownerLedgerEntry.createMany.mock.calls[0][0];
    expect(data.map((e: any) => [e.personId, e.date, e.period])).toEqual([
      [X, D('2026-01-08'), D('2026-01-01')],
      [A, D('2026-01-08'), D('2026-01-01')],
    ]);
  });

  it('una fecha indicada rige los asientos y la entrega de custodia', async () => {
    const { service, payment, tx } = build({ custody: { id: 'custody-x' }, balance: '50000' });
    payment.paidAt = new Date('2026-01-08T15:00:00.000Z');
    const res = await service.create({ paymentId: PAY, fromLessorId: X, toLessorId: A, amount: '1000', fromCustody: true, date: '2026-02-03' });
    expect(res.movements.map((m: any) => m.date)).toEqual([D('2026-02-03'), D('2026-02-03')]);
    expect(tx.ownerLedgerEntry.createMany.mock.calls[0][0].data.map((e: any) => e.period)).toEqual([D('2026-02-01'), D('2026-02-01')]);
  });

  it('con la custodia de quien cubre: sale de su custodia y entra en la caja', async () => {
    const custody = { id: 'custody-x' };
    const { service, cash } = build({ custody, balance: '50000' });
    const res = await service.create({ paymentId: PAY, fromLessorId: X, toLessorId: A, fromCustody: true });
    expect(res.movements.map((m: any) => [m.accountId, m.direction, m.category, String(m.amount)])).toEqual([
      ['custody-x', 'Out', 'Compensacion', '46500'],
      ['caja-ars', 'In', 'Compensacion', '46500'],
    ]);
    expect(cash.lockAccount).toHaveBeenCalledWith(expect.anything(), 't1', 'custody-x');
  });

  it('la custodia tiene que existir y alcanzar', async () => {
    await expect(build().service.create({ paymentId: PAY, fromLessorId: X, toLessorId: A, fromCustody: true })).rejects.toMatchObject({
      response: { error: 'CUSTODY_EMPTY' },
    });
    await expect(
      build({ custody: { id: 'c' }, balance: '10' }).service.create({ paymentId: PAY, fromLessorId: X, toLessorId: A, fromCustody: true }),
    ).rejects.toMatchObject({ response: { error: 'CUSTODY_INSUFFICIENT' } });
  });

  it('rechaza cobro inexistente, quien no es locador, sin parte en el reparto y fuera del alcance', async () => {
    await expect(build({ payment: null }).service.create({ paymentId: PAY, fromLessorId: X, toLessorId: A })).rejects.toMatchObject({
      response: { error: 'PAYMENT_NOT_FOUND' },
    });
    await expect(build().service.create({ paymentId: PAY, fromLessorId: B, toLessorId: A })).rejects.toMatchObject({
      response: { error: 'PERSON_NOT_FOUND' },
    });
    await expect(build({ lessorships: 0 }).service.create({ paymentId: PAY, fromLessorId: X, toLessorId: A })).rejects.toMatchObject({
      response: { error: 'COMPENSATION_OUT_OF_SCOPE' },
    });
    const noShare = build();
    noShare.payment.settlement = { error: { code: 'X' } };
    await expect(noShare.service.create({ paymentId: PAY, fromLessorId: X, toLessorId: A })).rejects.toMatchObject({
      response: { error: 'VALIDATION_ERROR' },
    });
    await expect(
      build({ scope: 'MismoContrato' }).service.create({ paymentId: PAY, fromLessorId: X, toLessorId: A, amount: '10' }),
    ).rejects.toMatchObject({ response: { error: 'COMPENSATION_OUT_OF_SCOPE' } });
  });

  it('lista por cobro o por persona', async () => {
    const { service, tx } = build();
    await service.list({ paymentId: PAY });
    await service.list({ personId: A });
    expect(tx.compensation.findMany.mock.calls[0][0].where).toEqual({ paymentId: PAY });
    expect(tx.compensation.findMany.mock.calls[1][0].where).toEqual({ OR: [{ fromLessorId: A }, { toLessorId: A }] });
  });
});
