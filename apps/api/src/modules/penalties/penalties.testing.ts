import { PenaltiesService } from './penalties.service';

/** Liquidación en memoria para las pruebas de punitorios. */
export interface FakeLiquidacion {
  id: string;
  tenantId?: string;
  contractId?: string;
  total: string;
  dueDate: Date;
  status?: string;
  period?: Date;
  currency?: string;
  payments?: { amount: string; paidAt: Date }[];
  lineItems?: { type: string; amount: string; sourceType?: string | null; sourceId?: string | null }[];
}

export interface FakePenalty {
  id: string;
  tenantId: string;
  liquidacionId: string;
  amount: string;
  appliedOn: Date;
  daysOverdue: number;
  compoundBase?: string | null;
  status: 'active' | 'waived';
  settledLiquidacionId: string | null;
  waivedAt?: Date | null;
  waivedBy?: string | null;
  waiveReason?: string | null;
}

interface FakeOptions {
  liquidaciones?: FakeLiquidacion[];
  penalties?: Partial<FakePenalty>[];
  /** Regla propia del contrato (`ContractTermsVersion.penaltyConfig`). */
  termsPenaltyConfig?: unknown;
  tenantConfig?: unknown;
  /** Tasas BNA que devuelve el índice: `{ period, value }`. */
  bnaRows?: { period: Date; value: string }[];
  contractExists?: boolean;
}

const matchesId = (cond: unknown, value: unknown): boolean => {
  if (cond === undefined) return true;
  if (cond === null) return value === null || value === undefined;
  if (typeof cond === 'object') {
    const c = cond as { in?: unknown[]; not?: unknown; lt?: Date; lte?: Date };
    if (c.in) return c.in.includes(value);
    if (c.lt) return (value as Date).getTime() < c.lt.getTime();
    if (c.lte) return (value as Date).getTime() <= c.lte.getTime();
    if ('not' in c) return value !== c.not;
  }
  return cond === value;
};

/**
 * Base en memoria con lo justo de Prisma que usa `PenaltiesService`, más el
 * servicio armado sobre ella. Las pruebas miran `penalties` y `audit`.
 */
export function makeFakePenaltyDb(opts: FakeOptions = {}) {
  const liquidaciones = (opts.liquidaciones ?? []).map((l) => ({
    tenantId: 'tenant-1',
    contractId: 'contract-1',
    status: 'Vencida',
    period: new Date('2026-01-01T00:00:00.000Z'),
    currency: 'ARS',
    payments: [],
    lineItems: [],
    ...l,
  }));
  const penalties: FakePenalty[] = (opts.penalties ?? []).map((p, i) => ({
    id: `pen-${i + 1}`,
    tenantId: 'tenant-1',
    liquidacionId: 'liq-1',
    amount: '0.00',
    appliedOn: new Date('2026-01-20T00:00:00.000Z'),
    daysOverdue: 1,
    status: 'active',
    settledLiquidacionId: null,
    ...p,
  }));
  let seq = penalties.length;

  const penaltyMatches = (p: FakePenalty, where: any = {}): boolean => {
    if (where.id !== undefined && !matchesId(where.id, p.id)) return false;
    if (!matchesId(where.liquidacionId, p.liquidacionId)) return false;
    if (where.status !== undefined && where.status !== p.status) return false;
    if (where.settledLiquidacionId !== undefined && !matchesId(where.settledLiquidacionId, p.settledLiquidacionId)) {
      return false;
    }
    if (where.appliedOn && !matchesId(where.appliedOn, p.appliedOn)) return false;
    if (where.liquidacion?.contractId) {
      const liq = liquidaciones.find((l) => l.id === p.liquidacionId);
      if (liq?.contractId !== where.liquidacion.contractId) return false;
    }
    return true;
  };

  const client: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked' }]),
    liquidacion: {
      findMany: jest.fn(async ({ where = {} }: any) =>
        liquidaciones.filter(
          (l) =>
            matchesId(where.contractId, l.contractId) &&
            matchesId(where.status, l.status) &&
            matchesId(where.dueDate, l.dueDate) &&
            matchesId(where.period, l.period),
        ),
      ),
      findFirst: jest.fn(async ({ where }: any) => liquidaciones.find((l) => l.id === where.id) ?? null),
    },
    contract: {
      findFirst: jest.fn(async ({ where }: any) => (opts.contractExists === false ? null : { id: where.id })),
    },
    penalty: {
      aggregate: jest.fn(async ({ where }: any) => {
        const rows = penalties.filter((p) => penaltyMatches(p, where));
        const sum = rows.reduce((a, r) => a + Number(r.amount), 0);
        return { _sum: { amount: rows.length ? sum : null } };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `pen-${++seq}`, status: 'active', settledLiquidacionId: null, ...data } as FakePenalty;
        penalties.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: any) => penalties.filter((p) => penaltyMatches(p, where))),
      findFirst: jest.fn(async ({ where }: any) => penalties.find((p) => penaltyMatches(p, where)) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = penalties.filter((p) => penaltyMatches(p, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      }),
    },
    auditLog: { create: jest.fn().mockResolvedValue(undefined) },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));

  const baseClient = {
    contractTermsVersion: {
      findFirst: jest.fn(async () =>
        opts.termsPenaltyConfig === undefined ? null : { penaltyConfig: opts.termsPenaltyConfig },
      ),
    },
  };
  const tenants = {
    getPenaltyConfig: jest.fn().mockResolvedValue(
      opts.tenantConfig ?? { mode: 'daily_fixed', value: '10', graceDays: 0, maxMultiplier: '2.0' },
    ),
  };
  const indexData = { getForPeriod: jest.fn().mockResolvedValue(opts.bnaRows ?? []) };
  const audit = { record: jest.fn(async (tx: any, input: any) => tx.auditLog.create({ data: input })) };
  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue('tenant-1'),
    getUserId: jest.fn().mockReturnValue('user-1'),
  };

  const service = new PenaltiesService(
    { client, baseClient } as any,
    tenants as any,
    indexData as any,
    audit as any,
    tenantContext as any,
  );
  return { service, client, penalties, liquidaciones, tenants, indexData, audit, tenantContext };
}
