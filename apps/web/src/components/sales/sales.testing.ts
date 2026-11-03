import type { SalesDeposit, SalesDocCheck, SalesOperation, SalesParty } from '@/lib/sales';

/** Datos de prueba de ventas (sintéticos). */
export const OP_ID = '11111111-1111-4111-8111-111111111111';
export const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
export const BUYER_ID = '33333333-3333-4333-8333-333333333333';
export const SELLER_ID = '44444444-4444-4444-8444-444444444444';

export const party = (role: string, id: string, firstName: string, sharePct = '100'): SalesParty => ({
  id: `party-${id}`,
  role,
  personId: id,
  sharePct,
  person: { id, firstName, lastName: 'Sintético' },
});

export const deposit = (over: Partial<SalesDeposit> = {}): SalesDeposit => ({
  id: 'dep-1',
  kind: 'Reserva',
  amount: '2000.00',
  currency: 'USD',
  holder: 'Inmobiliaria',
  status: 'Pendiente',
  expiresAt: '2099-12-31T00:00:00.000Z',
  receivedAt: null,
  resolvedAt: null,
  resolvedAmount: null,
  resolutionNote: null,
  notes: null,
  expired: false,
  unresolvedMoney: false,
  payerPerson: { id: BUYER_ID, firstName: 'Beto', lastName: 'Sintético' },
  holderPerson: null,
  ...over,
});

export const doc = (code: string, over: Partial<SalesDocCheck> = {}): SalesDocCheck => ({
  id: `doc-${code}`,
  code,
  required: true,
  done: false,
  notes: null,
  ...over,
});

export const operation = (over: Partial<SalesOperation> = {}): SalesOperation => ({
  id: OP_ID,
  status: 'Publicada',
  propertyId: PROPERTY_ID,
  exclusive: false,
  price: '120000.00',
  agreedPrice: null,
  currency: 'USD',
  boletoDate: null,
  escrituraDate: null,
  cancelReason: null,
  notes: null,
  property: { id: PROPERTY_ID, title: 'Depto Sintético', type: 'Departamento', street: 'Calle Ficticia', number: '100', city: 'Córdoba' },
  parties: [party('Vendedor', SELLER_ID, 'Vera'), party('Comprador', BUYER_ID, 'Beto')],
  deposits: [],
  docs: [doc('informe_dominio', { done: true }), doc('informe_inhibicion'), doc('libre_deuda_expensas', { required: false })],
  fees: [],
  docProgress: { done: 1, total: 3, requiredDone: 1, requiredTotal: 2 },
  nextExpiry: null,
  validTransitions: ['Captacion', 'Reservada', 'Cancelada'],
  ...over,
});

export const page = <T>(items: T[]) => ({ items, total: items.length, page: 1, limit: 50, totalPages: 1 });
