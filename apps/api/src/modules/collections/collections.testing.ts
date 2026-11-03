import { CollectionActionStatus, CollectionStage, Money, resolveOperationalDefaults } from '@realfy/shared';
import { CollectionDebtService } from './collection-debt.service';
import { CollectionStateService, type CaseRow } from './collection-state.service';
import { CollectionsProcessService } from './collections-process.service';
import { CollectionsService } from './collections.service';

/** Base en memoria con lo justo de Prisma que usan los servicios de cobranza, más los servicios armados sobre ella. */

export const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export interface FakeLiquidacion {
  id: string;
  contractId?: string;
  period: Date;
  dueDate: Date;
  status?: string;
  total: string;
  currency?: string;
  payments?: { amount: string; paidAt: Date }[];
}

export interface FakePerson {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

interface FakeOptions {
  liquidaciones?: FakeLiquidacion[];
  cases?: Partial<CaseRow>[];
  actions?: Record<string, any>[];
  tenants?: FakePerson[];
  users?: { id: string; firstName: string; lastName: string; isActive?: boolean }[];
  defaults?: unknown;
  /** Punitorio que devuelve `payoffOf` por id de liquidación. */
  penalties?: Record<string, string>;
  channelFor?: (person: FakePerson) => 'Email' | 'WhatsApp' | null;
  today?: Date;
}

const matches = (cond: any, value: any): boolean => {
  if (cond === undefined) return true;
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('in' in cond) return cond.in.includes(value);
    if ('not' in cond) return value !== cond.not;
    if ('lt' in cond) return value < cond.lt;
    if ('lte' in cond) return value <= cond.lte;
  }
  return cond === value;
};

const whereMatches = (row: any, where: any = {}): boolean =>
  Object.entries(where).every(([k, v]) => matches(v, row[k]));

export function makeFakeCollections(opts: FakeOptions = {}) {
  const liquidaciones = (opts.liquidaciones ?? []).map((l) => ({
    tenantId: 'tenant-1',
    contractId: 'contract-1',
    status: 'Enviada',
    currency: 'ARS',
    payments: [] as { amount: string; paidAt: Date }[],
    lineItems: [],
    ...l,
  }));
  let seq = 0;
  const cases: any[] = (opts.cases ?? []).map((c, i) => ({
    id: `case-${i + 1}`,
    tenantId: 'tenant-1',
    contractId: 'contract-1',
    stage: CollectionStage.Recordatorio,
    currency: 'ARS',
    overdueSince: day('2026-03-10'),
    lastBalance: null,
    nextActionKind: null,
    nextActionAt: null,
    pausedUntil: null,
    letterPreparedOn: null,
    letterSentOn: null,
    assigneeId: null,
    closeReason: null,
    openedOn: day('2026-03-15'),
    closedAt: null,
    createdAt: day('2026-03-15'),
    ...c,
  }));
  const actions: any[] = (opts.actions ?? []).map((a, i) => ({
    id: `act-${i + 1}`,
    tenantId: 'tenant-1',
    caseId: 'case-1',
    status: CollectionActionStatus.Realizada,
    level: null,
    channel: null,
    outboxMessageId: null,
    amount: null,
    onDate: null,
    note: null,
    data: null,
    key: null,
    createdByUserId: null,
    at: day('2026-03-15'),
    ...a,
  }));
  const tenants = opts.tenants ?? [{ id: 'person-1', firstName: 'Ana', lastName: 'Prueba', email: 'ana@inmobiliariademo.com.ar', phone: '1155550000', address: 'Calle Falsa 123' }];
  const users = opts.users ?? [];
  const messages: any[] = [];
  const audits: any[] = [];
  const notices: any[] = [];

  const db: any = {
    liquidacion: {
      findMany: jest.fn(async ({ where = {} }: any) =>
        liquidaciones
          .filter((l) => whereMatches({ ...l }, { ...where, dueDate: undefined }))
          .filter((l) => matches(where.dueDate, l.dueDate))
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id.localeCompare(b.id))
          .map((l) => ({ ...l, total: l.total })),
      ),
    },
    collectionCase: {
      findMany: jest.fn(async ({ where = {}, skip = 0, take }: any = {}) =>
        cases
          .filter((c) => whereMatches(c, { ...where, overdueSince: undefined }) && matches(where.overdueSince, c.overdueSince))
          .sort((a, b) => a.overdueSince.getTime() - b.overdueSince.getTime() || a.id.localeCompare(b.id))
          .slice(skip, take === undefined ? undefined : skip + take),
      ),
      count: jest.fn(async ({ where = {} }: any = {}) =>
        cases.filter((c) => whereMatches(c, { ...where, overdueSince: undefined }) && matches(where.overdueSince, c.overdueSince)).length,
      ),
      findFirst: jest.fn(async ({ where = {} }: any) => cases.find((c) => whereMatches(c, where)) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `case-${cases.length + 1}`, createdAt: day('2026-03-15'), stage: CollectionStage.Recordatorio, nextActionKind: null, nextActionAt: null, pausedUntil: null, letterPreparedOn: null, letterSentOn: null, assigneeId: null, closeReason: null, closedAt: null, ...data };
        cases.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = cases.find((c) => c.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    collectionAction: {
      findMany: jest.fn(async ({ where = {} }: any) =>
        actions.filter((a) => whereMatches(a, where)).sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id)),
      ),
      findFirst: jest.fn(async ({ where = {} }: any) => actions.find((a) => whereMatches(a, where)) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `act-${actions.length + 1}`, status: CollectionActionStatus.Realizada, level: null, channel: null, outboxMessageId: null, amount: null, onDate: null, note: null, data: null, key: null, createdByUserId: null, at: new Date(Date.UTC(2026, 2, 15, 13) + actions.length * 1000), ...data };
        actions.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = actions.find((a) => a.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    contract: {
      findFirst: jest.fn(async ({ where }: any) => ({
        id: where.id,
        property: { title: null, street: 'Calle Demo', number: '742', floor: null, apartment: null },
        persons: tenants.map((person) => ({ role: 'Inquilino', person })),
      })),
    },
    tenant: { findFirst: jest.fn(async () => ({ name: 'Inmobiliaria Demo' })) },
    user: {
      findFirst: jest.fn(async ({ where }: any) => users.find((u) => u.id === where.id && (where.isActive === undefined || (u.isActive ?? true) === where.isActive)) ?? null),
      findMany: jest.fn(async ({ where }: any) => users.filter((u) => where.id.in.includes(u.id))),
    },
    messageOutbox: {
      findMany: jest.fn(async ({ where }: any) => messages.filter((m) => where.id.in.includes(m.id))),
    },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => fn(db)),
  };

  const prisma: any = { client: db, baseClient: { tenant: { findFirst: db.tenant.findFirst } } };
  const penalties: any = {
    loadContext: jest.fn(async () => ({ rule: {}, source: 'tenant', bnaRates: [] })),
    payoffOf: jest.fn(async (_db: unknown, liq: { id: string }) => ({ due: new Money(opts.penalties?.[liq.id] ?? '0') })),
  };
  const outbox: any = {
    pickChannel: jest.fn(async (_db: unknown, person: FakePerson) =>
      opts.channelFor ? opts.channelFor(person) : person.phone ? 'WhatsApp' : person.email ? 'Email' : null,
    ),
    enqueue: jest.fn(async (_db: unknown, input: any) => {
      const row = { id: `msg-${++seq}`, status: 'Pending', statusReason: 'MESSAGING_OFF', created: true, input };
      messages.push(row);
      return row;
    }),
  };
  const audit: any = { record: jest.fn(async (_tx: unknown, input: unknown) => void audits.push(input)) };
  const defaultsService: any = {
    get: jest.fn(async () => {
      return resolveOperationalDefaults(opts.defaults ?? { collections: { enabled: true } });
    }),
  };
  const tenantContext: any = { getTenantId: () => 'tenant-1', getUserId: () => 'user-1' };
  const tenantCron: any = {
    forEachActiveTenant: jest.fn(async (_job: string, fn: (id: string, t: unknown) => Promise<void>) => {
      await fn('tenant-1', { id: 'tenant-1', name: 'Inmobiliaria Demo' });
      return { ok: 1, failed: 0 };
    }),
  };
  const notifications: any = {
    createNotification: jest.fn(async (params: unknown) => void notices.push(params)),
  };
  // `notifyManagement` busca al personal con `findStaff`: se resuelve con un cliente que devuelve dos usuarios.
  prisma.baseClient.user = { findMany: jest.fn(async () => [{ id: 'mgr-1' }, { id: 'mgr-2' }]) };

  const debt = new CollectionDebtService(penalties);
  const state = new CollectionStateService(debt, audit);
  const process = new CollectionsProcessService(prisma, tenantCron, defaultsService, debt, state, outbox, audit, notifications);
  const service = new CollectionsService(prisma, tenantContext, defaultsService, debt, state, audit);

  return { db, prisma, cases, actions, messages, audits, notices, penalties, outbox, audit, defaultsService, tenantContext, tenantCron, notifications, debt, state, process, service };
}
