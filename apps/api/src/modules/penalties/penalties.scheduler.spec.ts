import { PenaltiesScheduler } from './penalties.scheduler';
import { PenaltiesService } from './penalties.service';
import Decimal from 'decimal.js';

/**
 * Unit tests for PenaltiesScheduler.applyPenalties()
 *
 * Uses in-memory mocks — no real DB or NestJS context required.
 */

function buildScheduler({
  tenants = [] as { id: string; name: string }[],
  penaltyConfig = {
    mode: 'daily_fixed' as const,
    value: '10',
    graceDays: 0,
    maxMultiplier: '2.0',
  },
  liquidaciones = [] as { id: string; tenantId: string; total: { toString(): string }; dueDate: Date }[],
  existingPenalty = null as null | object,
  priorSum = '0',
}: {
  tenants?: { id: string; name: string }[];
  penaltyConfig?: { mode: 'daily_fixed' | 'daily_percent' | 'compound_percent'; value: string; graceDays: number; maxMultiplier: string };
  liquidaciones?: { id: string; tenantId: string; total: { toString(): string }; dueDate: Date }[];
  existingPenalty?: null | object;
  priorSum?: string;
} = {}) {
  const createdPenalties: object[] = [];

  const prisma = {
    baseClient: {
      tenant: {
        findMany: jest.fn().mockResolvedValue(tenants),
      },
      liquidacion: {
        findMany: jest.fn().mockResolvedValue(liquidaciones),
      },
      penalty: {
        findFirst: jest.fn().mockResolvedValue(existingPenalty),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: priorSum ? new Decimal(priorSum) : null } }),
        create: jest.fn().mockImplementation(async ({ data }: { data: object }) => {
          createdPenalties.push(data);
          return data;
        }),
      },
    },
  } as any;

  const tenantsService = {
    getPenaltyConfig: jest.fn().mockResolvedValue(penaltyConfig),
  } as any;

  const penaltiesService = new PenaltiesService();

  const scheduler = new PenaltiesScheduler(prisma, penaltiesService, tenantsService);

  return { scheduler, createdPenalties, prisma };
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
    expect(prisma.baseClient.penalty.create).not.toHaveBeenCalled();
    expect(createdPenalties).toHaveLength(0);
  });

  it('inserts only once when called twice with no existing penalty (run-now twice scenario)', async () => {
    let callCount = 0;
    const createdPenalties: object[] = [];

    const prisma = {
      baseClient: {
        tenant: {
          findMany: jest.fn().mockResolvedValue([{ id: 'tenant-1', name: 'Test' }]),
        },
        liquidacion: {
          findMany: jest.fn().mockResolvedValue([liquidacion]),
        },
        penalty: {
          // First call: no existing. After create, subsequent calls find the row.
          findFirst: jest.fn().mockImplementation(async () => {
            return callCount > 0 ? { id: 'p1', liquidacionId: 'liq-1' } : null;
          }),
          aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
          create: jest.fn().mockImplementation(async ({ data }: { data: object }) => {
            callCount++;
            createdPenalties.push(data);
            return data;
          }),
        },
      },
    } as any;

    const tenantsService = {
      getPenaltyConfig: jest.fn().mockResolvedValue({
        mode: 'daily_fixed',
        value: '10',
        graceDays: 0,
        maxMultiplier: '2.0',
      }),
    } as any;

    const scheduler = new PenaltiesScheduler(prisma, new PenaltiesService(), tenantsService);

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
