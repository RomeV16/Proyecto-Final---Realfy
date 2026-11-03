/** Piezas compartidas por las pruebas de ventas: base simulada con las tablas que tocan los servicios. */

export const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

export const IDS = {
  prop: '11111111-1111-4111-8111-111111111111',
  buyer: '22222222-2222-4222-8222-222222222222',
  seller: '33333333-3333-4333-8333-333333333333',
  user: '44444444-4444-4444-8444-444444444444',
  account: '55555555-5555-4555-8555-555555555555',
} as const;

const model = (extra: Record<string, jest.Mock> = {}) => ({
  findFirst: jest.fn().mockResolvedValue(null),
  findMany: jest.fn().mockResolvedValue([]),
  count: jest.fn().mockResolvedValue(0),
  create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'new', ...data })),
  createMany: jest.fn().mockResolvedValue({ count: 0 }),
  update: jest.fn().mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data })),
  updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  groupBy: jest.fn().mockResolvedValue([]),
  ...extra,
});

/** Base simulada: la transacción corre sobre el mismo objeto y `$queryRaw` (bloqueos) encuentra la fila. */
export function makeDb() {
  const db: any = {
    salesOperation: model(),
    salesParty: model(),
    salesDeposit: model(),
    salesDocCheck: model(),
    property: model(),
    person: model(),
    user: model(),
    fee: model(),
    cashMovement: model(),
    keySet: model(),
    keyMovement: model(),
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked' }]),
  };
  db.$transaction = (fn: any) => fn(db);
  return db;
}

export const makeTenantContext = () => ({ getTenantId: () => 't1', getUserId: () => 'u1' });

export const operation = (over: Record<string, unknown> = {}) => ({
  id: 'op1',
  status: 'Publicada',
  propertyId: IDS.prop,
  price: '120000.00',
  agreedPrice: null,
  currency: 'USD',
  escrituraDate: null,
  parties: [],
  deposits: [],
  docs: [],
  ...over,
});

export const deposit = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  salesOpId: 'op1',
  kind: 'Reserva',
  amount: '5000.00',
  currency: 'USD',
  holder: 'Inmobiliaria',
  payerPersonId: IDS.buyer,
  status: 'Pendiente',
  expiresAt: utc(2026, 12, 1),
  receivedAt: null,
  resolvedAt: null,
  receivedMovementId: null,
  ...over,
});
