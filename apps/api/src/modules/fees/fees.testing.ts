import { DEFAULT_OPERATIONAL_DEFAULTS } from '@realfy/shared';
import type { OperationalDefaults } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { FeesService } from './fees.service';
import { FeePaymentsService } from './fee-payments.service';
import { FeeProposalService } from './fee-proposal.service';

/**
 * Base en memoria para las pruebas de honorarios: guarda honorarios, cuotas,
 * coorretaje y comisiones y entiende los filtros que usan los servicios
 * (igualdad, `in`, `not`, `null`). Lo demás (contratos, personas, cuentas) se
 * configura con datos sintéticos.
 */

export const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const CONTRACT_ID = '11111111-1111-4111-8111-111111111111';
export const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
export const TENANT_PERSON = '33333333-3333-4333-8333-333333333333';
export const LESSOR_PERSON = '44444444-4444-4444-8444-444444444444';
export const USER_ID = '55555555-5555-4555-8555-555555555555';
export const PERIOD_ID = '66666666-6666-4666-8666-666666666666';
export const ACCOUNT_ID = '77777777-7777-4777-8777-777777777777';

function matches(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]: [string, any]) => {
    if (key === 'OR') return (cond as any[]).some((w) => matches(row, w));
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
    if (typeof cond === 'object') {
      if ('in' in cond) return cond.in.includes(value);
      if ('not' in cond) return cond.not === null ? value !== null && value !== undefined : value !== cond.not;
      if ('gte' in cond || 'lt' in cond) {
        const t = new Date(value).getTime();
        return (!cond.gte || t >= cond.gte.getTime()) && (!cond.lt || t < cond.lt.getTime());
      }
      return true;
    }
    return value === cond;
  });
}

function table(name: string, rows: any[]) {
  let seq = 0;
  return {
    rows,
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where))),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(2026, 0, 1, 0, 0, seq), paidAt: null, ...data };
      rows.push(row);
      return row;
    }),
    createMany: jest.fn(async ({ data }: any) => {
      for (const item of data) rows.push({ id: `${name}-${++seq}`, createdAt: new Date(2026, 0, 1, 0, 0, seq), status: 'Pendiente', paidAt: null, ...item });
      return { count: data.length };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hits = rows.filter((r) => matches(r, where));
      hits.forEach((r) => Object.assign(r, data));
      return { count: hits.length };
    }),
    delete: jest.fn(async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      return rows.splice(i, 1)[0];
    }),
  };
}

export interface FeeWorld {
  contract?: any;
  periods?: any[];
  adjustments?: any[];
  lessors?: any[];
  persons?: string[];
  users?: string[];
  defaults?: Partial<OperationalDefaults> & { fees?: Partial<OperationalDefaults['fees']> };
  valuation?: any;
  property?: any;
  owners?: any[];
}

export function syntheticContract(over: Record<string, unknown> = {}) {
  return {
    id: CONTRACT_ID,
    propertyId: PROPERTY_ID,
    startDate: d('2026-03-01'),
    endDate: d('2028-02-29'),
    rentAmount: '500000',
    rentCurrency: 'ARS',
    adjustmentType: 'IPC',
    adjustmentPeriod: 'Trimestral',
    customAdjustmentPct: null,
    persons: [{ role: 'Inquilino', personId: TENANT_PERSON, person: { id: TENANT_PERSON, firstName: 'Ines', lastName: 'Inquilina' } }],
    termsVersions: [],
    ...over,
  };
}

export function buildFees(world: FeeWorld = {}) {
  const fees = table('fee', []);
  const installments = table('inst', []);
  const shares = table('share', []);
  const staff = table('com', []);
  const contract = world.contract === undefined ? syntheticContract() : world.contract;
  const periods = world.periods ?? [
    { id: PERIOD_ID, contractId: CONTRACT_ID, seq: 1, kind: 'Original', startDate: d('2026-03-01'), endDate: d('2028-02-29'), initialRent: '500000' },
  ];
  const lessors = world.lessors ?? [
    { id: 'cl-1', contractId: CONTRACT_ID, personId: LESSOR_PERSON, payoutPct: '100', person: { id: LESSOR_PERSON, firstName: 'Luis', lastName: 'Locador' } },
  ];
  const persons = new Set(world.persons ?? [TENANT_PERSON, LESSOR_PERSON]);
  const users = new Set(world.users ?? [USER_ID]);
  const ledger: any[] = [];
  const receipts: any[] = [];

  const client: any = {
    fee: fees,
    feeInstallment: installments,
    feeShare: shares,
    staffCommission: staff,
    contract: {
      findFirst: jest.fn(async ({ where }: any) => (contract && where.id === contract.id ? { ...contract, periods } : null)),
    },
    contractPeriod: {
      findFirst: jest.fn(async ({ where }: any) =>
        periods.find((p) => (where.id ? p.id === where.id : p.contractId === where.contractId)) ?? null,
      ),
    },
    contractAdjustment: { findMany: jest.fn(async () => world.adjustments ?? []) },
    contractLessor: {
      findMany: jest.fn(async () => lessors),
      findFirst: jest.fn(async ({ where }: any) => lessors.find((l) => l.contractId === where.contractId && l.personId === where.personId) ?? null),
    },
    property: { findFirst: jest.fn(async ({ where }: any) => (where.id === PROPERTY_ID ? (world.property ?? { id: PROPERTY_ID, type: 'Casa' }) : null)) },
    propertyValuation: { findFirst: jest.fn(async ({ where }: any) => (world.valuation && where.id === world.valuation.id ? world.valuation : null)) },
    propertyOwnership: { findMany: jest.fn(async () => world.owners ?? []) },
    person: { count: jest.fn(async ({ where }: any) => where.id.in.filter((id: string) => persons.has(id)).length) },
    user: { count: jest.fn(async ({ where }: any) => where.id.in.filter((id: string) => users.has(id)).length) },
    ownerLedgerEntry: { createMany: jest.fn(async ({ data }: any) => (ledger.push(...data), { count: data.length })) },
    receipt: { create: jest.fn(async ({ data }: any) => (receipts.push({ id: `rec-${receipts.length + 1}`, ...data }), receipts.at(-1))) },
    $queryRaw: jest.fn(async () => [{ next: receipts.length + 2 }]),
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  // Las lecturas con `include` devuelven la fila con sus hijos.
  const withChildren = (row: any) =>
    row && {
      ...row,
      payer: { id: row.payerPersonId, firstName: 'Paga', lastName: 'Sintetico' },
      installmentRows: installments.rows.filter((i) => i.feeId === row.id).sort((a, b) => a.n - b.n),
      shares: shares.rows.filter((s) => s.feeId === row.id),
      staffCommissions: staff.rows.filter((s) => s.feeId === row.id),
    };
  const rawFindFirst = fees.findFirst.getMockImplementation()!;
  const rawFindMany = fees.findMany.getMockImplementation()!;
  fees.findFirst.mockImplementation(async (args: any) => withChildren(await rawFindFirst(args)));
  fees.findMany.mockImplementation(async (args: any) => (await rawFindMany(args)).map(withChildren));
  const rawInstallments = installments.findMany.getMockImplementation()!;
  installments.findMany.mockImplementation(async (args: any) =>
    (await rawInstallments(args)).map((i: any) => ({ ...i, fee: withChildren(fees.rows.find((f) => f.id === i.feeId)) })),
  );

  const merged = {
    ...DEFAULT_OPERATIONAL_DEFAULTS,
    ...world.defaults,
    fees: { ...DEFAULT_OPERATIONAL_DEFAULTS.fees, ...(world.defaults?.fees ?? {}) },
  };
  const defaults = { get: jest.fn().mockResolvedValue(merged) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1'), getUserId: jest.fn().mockReturnValue(USER_ID) };
  const cash = {
    resolveAgencyAccount: jest.fn(async (_tx: any, _t: string, ctx: any) => ({ id: ctx.accountId ?? ACCOUNT_ID, currency: ctx.currency, kind: 'Caja' })),
    findAccount: jest.fn(async (_tx: any, id: string) => ({ id, kind: 'Caja', currency: 'ARS', isActive: true })),
    assertOperational: jest.fn(),
    recordMovement: jest.fn(async (_tx: any, input: any) => ({ id: 'mov-1', ...input })),
  };
  const prisma = { client } as unknown as PrismaService;
  const ctx = tenantContext as unknown as TenantContextService;
  const service = new FeesService(prisma, ctx, audit as any, defaults as any);
  const proposal = new FeeProposalService(prisma, ctx, defaults as any);
  const payments = new FeePaymentsService(prisma, ctx, audit as any, defaults as any, cash as any, service);
  return { service, proposal, payments, client, audit, defaults, cash, ledger, receipts };
}

/** Alta de alquiler al inquilino: 5 % de 12.000.000 en 3 cuotas desde el 1/3/2026. */
export const altaInput = (over: Record<string, unknown> = {}) => ({
  kind: 'AltaAlquiler',
  contractId: CONTRACT_ID,
  basis: 'TotalContrato',
  baseAmount: '12000000',
  pct: '5',
  currency: 'ARS',
  payers: [{ role: 'Inquilino', personId: TENANT_PERSON }],
  installments: 3,
  firstDueDate: '2026-03-01',
  ...over,
});
