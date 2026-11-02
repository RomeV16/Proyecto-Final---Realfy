/**
 * Base en memoria para las pruebas de la cuenta corriente: alcanza con los
 * filtros que usan los servicios (igualdad, null, rangos, `in`, `not: null`).
 * No es una réplica de Prisma; solo lo necesario para probar la lógica.
 */
type Row = Record<string, any>;

const value = (v: unknown) => (v instanceof Date ? v.getTime() : v);

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c));
    if (key === 'AND') return (cond as Row[]).every((c) => matches(row, c));
    const actual = row[key];
    if (cond === null) return actual === null || actual === undefined;
    if (cond instanceof Date || typeof cond !== 'object') return value(actual) === value(cond);
    const c = cond as Row;
    if ('in' in c) return (c.in as unknown[]).map(value).includes(value(actual));
    if ('not' in c) return c.not === null ? actual !== null && actual !== undefined : value(actual) !== value(c.not);
    const a = value(actual) as any;
    if ('lte' in c && !(a <= value(c.lte)!)) return false;
    if ('lt' in c && !(a < value(c.lt)!)) return false;
    if ('gte' in c && !(a >= value(c.gte)!)) return false;
    if ('gt' in c && !(a > value(c.gt)!)) return false;
    return true;
  });
}

function sortBy(rows: Row[], orderBy: any): Row[] {
  const orders: Row[] = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return [...rows].sort((a, b) => {
    for (const o of orders) {
      const [key, dir] = Object.entries(o)[0];
      if (typeof dir !== 'string') continue;
      const x = value(a[key]) as any;
      const y = value(b[key]) as any;
      if (x === y) continue;
      const cmp = x < y ? -1 : 1;
      return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

function table(rows: Row[], prefix: string, unique?: (r: Row) => string) {
  rows.forEach((r, i) => {
    r.id ??= nextId(prefix);
    r.createdAt ??= new Date(Date.UTC(2026, 0, 1, 0, 0, i));
  });
  return {
    rows,
    findMany: jest.fn(async (args: any = {}) => {
      const found = sortBy(rows.filter((r) => matches(r, args.where)), args.orderBy).map((r) => ({ ...r }));
      return args.take ? found.slice(args.skip ?? 0, (args.skip ?? 0) + args.take) : found;
    }),
    findFirst: jest.fn(async (args: any = {}) => {
      const row = sortBy(rows.filter((r) => matches(r, args.where)), args.orderBy)[0];
      return row ? { ...row } : null;
    }),
    count: jest.fn(async (args: any = {}) => rows.filter((r) => matches(r, args.where)).length),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: nextId(prefix), createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
    createMany: jest.fn(async ({ data }: any) => {
      let count = 0;
      for (const d of data) {
        if (unique && rows.some((r) => unique(r) === unique(d))) continue;
        rows.push({ id: nextId(prefix), createdAt: new Date(Date.now() + count), statementId: null, ...d });
        count++;
      }
      return { count };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error(`${prefix} ${where.id} not found`);
      Object.assign(row, data);
      return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const found = rows.filter((r) => matches(r, where));
      for (const r of found) Object.assign(r, data);
      return { count: found.length };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const keep = rows.filter((r) => !matches(r, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    }),
    aggregate: jest.fn(async ({ where }: any) => {
      const found = rows.filter((r) => matches(r, where));
      const sum = found.reduce((acc, r) => acc + Math.round(Number(r.amount) * 100), 0) / 100;
      return { _sum: { amount: found.length ? sum.toFixed(2) : null } };
    }),
    groupBy: jest.fn(async ({ by, where }: any) => {
      const groups = new Map<string, Row>();
      for (const r of rows.filter((x) => matches(x, where))) {
        const key = by.map((k: string) => r[k]).join('|');
        const g = groups.get(key) ?? { ...Object.fromEntries(by.map((k: string) => [k, r[k]])), _sum: { amount: 0 }, _max: { date: null } };
        g._sum.amount = Math.round((Number(g._sum.amount) + Number(r.amount)) * 100) / 100;
        if (!g._max.date || r.date > g._max.date) g._max.date = r.date;
        groups.set(key, g);
      }
      return [...groups.values()].map((g) => ({ ...g, _sum: { amount: Number(g._sum.amount).toFixed(2) } }));
    }),
  };
}

const ledgerKey = (r: Row) => [r.tenantId, r.sourceType, r.sourceId, r.personId, r.type].join('|');

export interface FakeData {
  entries?: Row[];
  statements?: Row[];
  charges?: Row[];
  contracts?: Row[];
  lessors?: Row[];
  ownerships?: Row[];
  properties?: Row[];
  persons?: Row[];
  accounts?: Row[];
  allocations?: Row[];
}

/** Base en memoria con las tablas de la cuenta corriente y lo que leen sus servicios. */
export function fakeDb(data: FakeData = {}) {
  const db: any = {
    ownerLedgerEntry: table(data.entries ?? [], 'entry', ledgerKey),
    ownerStatement: table(data.statements ?? [], 'statement'),
    pendingCharge: table(data.charges ?? [], 'charge'),
    contract: table(data.contracts ?? [], 'contract'),
    contractLessor: table(data.lessors ?? [], 'lessor'),
    propertyOwnership: table(data.ownerships ?? [], 'ownership'),
    property: table(data.properties ?? [], 'property'),
    person: table(data.persons ?? [], 'person'),
    financialAccount: table(data.accounts ?? [], 'account'),
    serviceBillAllocation: table(data.allocations ?? [], 'allocation'),
    tenant: { findFirst: jest.fn(async () => ({ name: 'Inmobiliaria Demo', cuit: '30-00000000-1' })) },
    $queryRaw: jest.fn(async () => [{ id: 'locked' }]),
  };
  // Los includes que piden los servicios se resuelven con las otras tablas.
  const withProperty = (r: Row) => ({ ...r, property: db.property.rows.find((p: Row) => p.id === r.propertyId) ?? null });
  const entryFindMany = db.ownerLedgerEntry.findMany;
  db.ownerLedgerEntry.findMany = jest.fn(async (args: any = {}) => (await entryFindMany(args)).map(withProperty));
  const withPerson = (r: Row | null) =>
    r ? { ...r, person: db.person.rows.find((p: Row) => p.id === r.personId) ?? null, _count: { entries: 0 } } : r;
  const stFindFirst = db.ownerStatement.findFirst;
  db.ownerStatement.findFirst = jest.fn(async (args: any = {}) => withPerson(await stFindFirst(args)));
  const stFindMany = db.ownerStatement.findMany;
  db.ownerStatement.findMany = jest.fn(async (args: any = {}) => (await stFindMany(args)).map(withPerson));
  const stUpdate = db.ownerStatement.update;
  db.ownerStatement.update = jest.fn(async (args: any) => withPerson(await stUpdate(args)));
  const chFindMany = db.pendingCharge.findMany;
  db.pendingCharge.findMany = jest.fn(async (args: any = {}) =>
    (await chFindMany(args)).map((c: Row) => ({ ...c, contract: db.contract.rows.find((k: Row) => k.id === c.contractId) ?? null })),
  );
  const allocFindMany = db.serviceBillAllocation.findMany;
  db.serviceBillAllocation.findMany = jest.fn(async (args: any = {}) =>
    (await allocFindMany(args)).map((a: Row) => ({ ...a, contract: db.contract.rows.find((k: Row) => k.id === a.contractId) })),
  );
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  return db;
}

export const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
