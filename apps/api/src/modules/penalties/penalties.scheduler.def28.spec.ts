import Decimal from 'decimal.js';
import { PenaltiesScheduler } from './penalties.scheduler';
import { PenaltiesService } from './penalties.service';
import { makeTenantCron } from '../../common/scheduler/tenant-cron.testing';

/**
 * DEF-28 (CP-360): cada corrida diaria sumaba el punitorio acumulado entero en
 * lugar de lo que faltaba, y las filas condonadas volvían a devengarse.
 * Base en memoria con estado: las filas que crea una corrida las ve la siguiente.
 */
type Row = { id: string; liquidacionId: string; amount: number; appliedOn: Date; status: 'active' | 'waived' };

function build(initial: Row[] = []) {
  const rows: Row[] = [...initial];
  const client: any = {
    liquidacion: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'liq-1',
          tenantId: 'tenant-1',
          total: new Decimal('1000'),
          dueDate: new Date('2025-03-05T00:00:00.000Z'),
          payments: [],
        },
      ]),
    },
    penalty: {
      findFirst: jest.fn(async ({ where }: any) =>
        rows.find((r) => r.liquidacionId === where.liquidacionId && r.appliedOn.getTime() === where.appliedOn.getTime()) ?? null,
      ),
      aggregate: jest.fn(async ({ where }: any) => {
        const mine = rows.filter((r) => r.liquidacionId === where.liquidacionId && (!where.status || r.status === where.status));
        return { _sum: { amount: mine.length ? new Decimal(mine.reduce((a, r) => a + r.amount, 0)) : null } };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `pen-${rows.length + 1}`, status: 'active' as const, ...data };
        rows.push(row);
        return row;
      }),
    },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  const tenantsService = {
    getPenaltyConfig: jest.fn().mockResolvedValue({ mode: 'daily_fixed', value: '10', graceDays: 0, maxMultiplier: '5.0' }),
  } as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const { tenantCron } = makeTenantCron([{ id: 'tenant-1', name: 'Test' }]);
  const scheduler = new PenaltiesScheduler({ client } as any, new PenaltiesService(), tenantsService, tenantCron, audit);
  return { scheduler, rows };
}

describe('PenaltiesScheduler.applyPenalties(): devengo incremental (DEF-28)', () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date('2025-03-15T15:00:00.000Z') }));
  afterEach(() => jest.useRealTimers());

  it('al día siguiente agrega solo el día que falta', async () => {
    const { scheduler, rows } = build();
    await scheduler.applyPenalties();
    jest.setSystemTime(new Date('2025-03-16T15:00:00.000Z'));
    await scheduler.applyPenalties();
    // 10 días a 10 = 100, y al día siguiente 10 más (no 110)
    expect(rows.map((r) => r.amount)).toEqual([100, 10]);
  });

  it('una fila condonada no se vuelve a devengar', async () => {
    const { scheduler, rows } = build([
      { id: 'pen-0', liquidacionId: 'liq-1', amount: 100, appliedOn: new Date('2025-03-14T00:00:00.000Z'), status: 'waived' },
    ]);
    await scheduler.applyPenalties();
    // devengado a hoy: 100; ya registrado (condonado): 100; no falta nada
    expect(rows).toHaveLength(1);
  });
});
