import { PenaltiesScheduler } from './penalties.scheduler';
import { PenaltiesService } from './penalties.service';
import Decimal from 'decimal.js';
import { makeTenantCron } from '../../../test/helpers/tenant-cron';

/**
 * Unit tests for PenaltiesScheduler.applyPenalties()
 *
 * Uses in-memory mocks — no real DB or NestJS context required.
 */

type LiquidacionRow = {
  id: string;
  tenantId: string;
  total: { toString(): string };
  dueDate: Date;
  payments?: { amount: { toString(): string } }[];
};

function buildScheduler({
  tenants = [] as { id: string; name: string }[],
  penaltyConfig = {
    mode: 'daily_fixed' as const,
    value: '10',
    graceDays: 0,
    maxMultiplier: '2.0',
  },
  liquidaciones = [] as LiquidacionRow[],
  existingPenalty = null as null | object,
  priorSum = '0',
}: {
  tenants?: { id: string; name: string }[];
  penaltyConfig?: { mode: 'daily_fixed' | 'daily_percent' | 'compound_percent'; value: string; graceDays: number; maxMultiplier: string };
  liquidaciones?: LiquidacionRow[];
  existingPenalty?: null | object;
  priorSum?: string;
} = {}) {
  const createdPenalties: object[] = [];

  const client: any = {
      liquidacion: {
        findMany: jest.fn().mockResolvedValue(liquidaciones.map((l) => ({ payments: [], ...l }))),
      },
      penalty: {
        findFirst: jest.fn().mockResolvedValue(existingPenalty),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: priorSum ? new Decimal(priorSum) : null } }),
        create: jest.fn().mockImplementation(async ({ data }: { data: object }) => {
          createdPenalties.push(data);
          return { id: 'pen-1', ...data };
        }),
      },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  const prisma = { client } as any;

  const tenantsService = {
    getPenaltyConfig: jest.fn().mockResolvedValue(penaltyConfig),
  } as any;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const { tenantCron } = makeTenantCron(tenants);

  const scheduler = new PenaltiesScheduler(prisma, new PenaltiesService(), tenantsService, tenantCron, audit);

  return { scheduler, createdPenalties, prisma, audit };
}

describe('PenaltiesScheduler.applyPenalties()', () => {
  const pastDueDate = new Date();
  pastDueDate.setDate(pastDueDate.getDate() - 10);

  const liquidacion = {
    id: 'liq-1',
    tenantId: 'tenant-1',
    total: new Decimal('1000'),
    dueDate: pastDueDate,
  };

  it('inserts a Penalty row for an overdue liquidacion', async () => {
    const { scheduler, createdPenalties } = buildScheduler({
      tenants: [{ id: 'tenant-1', name: 'Test Inmobiliaria' }],
      liquidaciones: [liquidacion],
      existingPenalty: null,
    });

    const result = await scheduler.applyPenalties();

    expect(result.penaltiesInserted).toBe(1);
    expect(createdPenalties).toHaveLength(1);
    expect((createdPenalties[0] as any).liquidacionId).toBe('liq-1');
    expect((createdPenalties[0] as any).amount).toBeGreaterThan(0);
  });

  it('queries without tenantId (the tenant client filters) and audits the insert as a cron action', async () => {
    const { scheduler, prisma, audit } = buildScheduler({
      tenants: [{ id: 'tenant-1', name: 'Test Inmobiliaria' }],
      liquidaciones: [liquidacion],
    });

    await scheduler.applyPenalties();

    expect(prisma.client.liquidacion.findMany.mock.calls[0][0].where).not.toHaveProperty('tenantId');
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'CREATE',
        entity: 'Penalty',
        entityId: 'pen-1',
        userId: null,
        metadata: { source: 'cron', job: 'penalties-daily' },
      }),
    );
  });

  it('is idempotent — skips if Penalty already exists for today', async () => {
    const { scheduler, createdPenalties, prisma } = buildScheduler({
      tenants: [{ id: 'tenant-1', name: 'Test Inmobiliaria' }],
      liquidaciones: [liquidacion],
      existingPenalty: { id: 'existing-penalty', liquidacionId: 'liq-1' },
    });

    const result1 = await scheduler.applyPenalties();
    const result2 = await scheduler.applyPenalties();

    // Both runs should find the existing penalty and skip
    expect(result1.penaltiesInserted).toBe(0);
    expect(result2.penaltiesInserted).toBe(0);
    expect(prisma.client.penalty.create).not.toHaveBeenCalled();
    expect(createdPenalties).toHaveLength(0);
  });

  it('inserts only once when called twice with no existing penalty (run-now twice scenario)', async () => {
    let callCount = 0;
    const { scheduler, createdPenalties, prisma } = buildScheduler({
      tenants: [{ id: 'tenant-1', name: 'Test' }],
      liquidaciones: [liquidacion],
    });
    // First call: no existing. After create, subsequent calls find the row.
    prisma.client.penalty.findFirst.mockImplementation(async () =>
      callCount > 0 ? { id: 'p1', liquidacionId: 'liq-1' } : null,
    );
    prisma.client.penalty.create.mockImplementation(async ({ data }: { data: object }) => {
      callCount++;
      createdPenalties.push(data);
      return { id: 'p1', ...data };
    });

    const r1 = await scheduler.applyPenalties();
    const r2 = await scheduler.applyPenalties();

    expect(r1.penaltiesInserted).toBe(1);
    expect(r2.penaltiesInserted).toBe(0);
    expect(createdPenalties).toHaveLength(1);
  });

  it('skips liquidaciones that are not yet overdue', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);

    const { scheduler, createdPenalties } = buildScheduler({
      tenants: [{ id: 'tenant-1', name: 'Test' }],
      liquidaciones: [{
        id: 'liq-future',
        tenantId: 'tenant-1',
        total: new Decimal('1000'),
        dueDate: futureDate,
      }],
      existingPenalty: null,
    });

    const result = await scheduler.applyPenalties();

    // The liquidacion won't appear because the DB query filters dueDate < today.
    // Since we mock findMany to return whatever we pass, amount will be 0 (future date).
    // 0-amount penalties are not inserted.
    expect(result.penaltiesInserted).toBe(0);
    expect(createdPenalties).toHaveLength(0);
  });

  it('returns correct summary with zero tenants', async () => {
    const { scheduler } = buildScheduler({ tenants: [] });
    const result = await scheduler.applyPenalties();
    expect(result.tenantsProcessed).toBe(0);
    expect(result.penaltiesInserted).toBe(0);
  });
});

/**
 * CP-138 (DEF-18): el punitorio corre sobre el saldo pendiente y el "hoy" es
 * el día de Buenos Aires. Antes se calculaba sobre el total de la liquidación
 * y con la fecha local del servidor.
 */
describe('PenaltiesScheduler.applyPenalties(): base de cálculo y día', () => {
  const percentConfig = {
    mode: 'daily_percent' as const,
    value: '0.01',
    graceDays: 0,
    maxMultiplier: '3.0',
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('una liquidación pagada en parte devenga solo sobre lo impago', async () => {
    jest.useFakeTimers({ now: new Date('2025-03-15T15:00:00.000Z') });
    const { scheduler, createdPenalties } = buildScheduler({
      tenants: [{ id: 'tenant-1', name: 'Test' }],
      penaltyConfig: percentConfig,
      liquidaciones: [
        {
          id: 'liq-parcial',
          tenantId: 'tenant-1',
          total: new Decimal('1000'),
          dueDate: new Date('2025-03-05T00:00:00.000Z'),
          payments: [{ amount: new Decimal('600') }],
        },
      ],
    });

    await scheduler.applyPenalties();

    expect(createdPenalties).toHaveLength(1);
    // 10 días de mora sobre un saldo de 400: 400 * 1% * 10 = 40 (no 100)
    expect((createdPenalties[0] as any).amount).toBe(40);
    expect((createdPenalties[0] as any).compoundBase).toBe(400);
  });

  it('una liquidación pagada por completo no devenga nada', async () => {
    jest.useFakeTimers({ now: new Date('2025-03-15T15:00:00.000Z') });
    const { scheduler, createdPenalties } = buildScheduler({
      tenants: [{ id: 'tenant-1', name: 'Test' }],
      penaltyConfig: percentConfig,
      liquidaciones: [
        {
          id: 'liq-pagada',
          tenantId: 'tenant-1',
          total: new Decimal('1000'),
          dueDate: new Date('2025-03-05T00:00:00.000Z'),
          payments: [{ amount: new Decimal('600') }, { amount: new Decimal('400') }],
        },
      ],
    });

    const result = await scheduler.applyPenalties();

    expect(result.penaltiesInserted).toBe(0);
    expect(createdPenalties).toHaveLength(0);
  });

  it('a las 22:30 de Buenos Aires todavía es el día anterior en UTC', async () => {
    // 2025-03-11T01:30Z son las 22:30 del 10 de marzo en Buenos Aires
    jest.useFakeTimers({ now: new Date('2025-03-11T01:30:00.000Z') });
    const { scheduler, createdPenalties } = buildScheduler({
      tenants: [{ id: 'tenant-1', name: 'Test' }],
      penaltyConfig: percentConfig,
      liquidaciones: [
        {
          id: 'liq-noche',
          tenantId: 'tenant-1',
          total: new Decimal('1000'),
          dueDate: new Date('2025-03-05T00:00:00.000Z'),
        },
      ],
    });

    await scheduler.applyPenalties();

    expect(createdPenalties).toHaveLength(1);
    expect((createdPenalties[0] as any).appliedOn.toISOString()).toBe('2025-03-10T00:00:00.000Z');
    expect((createdPenalties[0] as any).daysOverdue).toBe(5);
  });
});
