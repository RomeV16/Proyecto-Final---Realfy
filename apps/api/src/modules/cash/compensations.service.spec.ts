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
      create: jest.fn(async ({ data }: any) => ({ id: 'comp-1', ...data })),
      findMany: jest.fn(async () => []),
    },
    financialAccount: { findFirst: jest.fn(async () => opts.custody ?? null) },
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
