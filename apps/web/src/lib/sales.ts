import { KeyHolder, SalesDepositHolder, SalesDepositKind, SalesOperationStatus } from '@realfy/shared';

/* ──────────── Lo que devuelve la API ──────────── */

export interface PersonRef {
  id: string;
  firstName: string;
  lastName: string;
}

export interface SalesParty {
  id: string;
  role: string;
  personId: string;
  sharePct: string;
  person: PersonRef;
}

export interface SalesDeposit {
  id: string;
  kind: string;
  amount: string;
  currency: string;
  holder: string;
  status: string;
  expiresAt: string | null;
  receivedAt: string | null;
  resolvedAt: string | null;
  resolvedAmount: string | null;
  resolutionNote: string | null;
  notes: string | null;
  expired: boolean;
  unresolvedMoney: boolean;
  payerPerson: PersonRef | null;
  holderPerson: PersonRef | null;
}

export interface SalesDocCheck {
  id: string;
  code: string;
  required: boolean;
  done: boolean;
  notes: string | null;
}

export interface SalesFee {
  id: string;
  status: string;
  payerRole: string;
  total: string;
  currency: string;
  pct: string | null;
}

export interface SalesOperation {
  id: string;
  status: string;
  propertyId: string;
  exclusive: boolean;
  price: string | null;
  agreedPrice: string | null;
  currency: string;
  boletoDate: string | null;
  escrituraDate: string | null;
  cancelReason: string | null;
  notes: string | null;
  property: { id: string; title: string; type: string; street: string | null; number: string | null; city: string | null };
  parties: SalesParty[];
  deposits: SalesDeposit[];
  docs: SalesDocCheck[];
  fees: SalesFee[];
  docProgress: { done: number; total: number; requiredDone: number; requiredTotal: number };
  nextExpiry: string | null;
  validTransitions: string[];
}

export interface PendingDeposit extends SalesDeposit {
  salesOperation: { id: string; status: string; property: { id: string; title: string } };
}

export interface PendingDepositsResponse {
  items: PendingDeposit[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  held: Array<{ currency: string; holder: string; amount: string }>;
}

export interface FeeProposal {
  pct: string;
  baseAmount: string | null;
  currency: string;
  saleAsset: string;
  firstDueDate: string;
  payers: Array<{ role: string; personId: string }>;
}

export interface KeyMovement {
  id: string;
  holder: string;
  holderName: string | null;
  holderPerson: PersonRef | null;
  holderUser: PersonRef | null;
  reason: string | null;
  outAt: string;
  expectedReturnAt: string | null;
  returnedAt: string | null;
  notes: string | null;
}

export interface KeySet {
  id: string;
  label: string;
  copies: number;
  holder: string;
  holderName: string | null;
  holderPerson: PersonRef | null;
  holderUser: PersonRef | null;
  location: string | null;
  isActive: boolean;
  overdue: boolean;
  daysOverdue: number;
  openMovement: KeyMovement | null;
  movements: KeyMovement[];
}

export interface KeyOut extends KeyMovement {
  overdue: boolean;
  daysOverdue: number;
  keySet: { id: string; label: string; copies: number; propertyId: string; property: { id: string; title: string; street: string | null; number: string | null } };
}

/* ──────────── Opciones ──────────── */

export const SALES_STATUSES = Object.values(SalesOperationStatus);
export const DEPOSIT_KINDS = Object.values(SalesDepositKind);
export const DEPOSIT_HOLDERS = Object.values(SalesDepositHolder);
export const KEY_HOLDERS = Object.values(KeyHolder);
export const KEY_HOLDERS_OUT = KEY_HOLDERS.filter((h) => h !== KeyHolder.Oficina);
export const CURRENCIES = ['USD', 'ARS', 'EUR'] as const;

/* ──────────── Auxiliares ──────────── */

export const personName = (p: { firstName: string; lastName: string } | null | undefined): string =>
  p ? `${p.firstName} ${p.lastName}`.trim() : '';

/** Nombre de quien tiene las llaves: la persona, el usuario o el nombre libre que se anotó. */
export function holderLabel(x: { holderPerson: PersonRef | null; holderUser: PersonRef | null; holderName: string | null }): string {
  return personName(x.holderPerson) || personName(x.holderUser) || x.holderName || '';
}

/** Propiedad en una línea: título y, si hay, la calle. */
export function placeOf(p: { title: string; street?: string | null; number?: string | null }): string {
  const street = [p.street, p.number].filter(Boolean).join(' ');
  return street ? `${p.title} · ${street}` : p.title;
}

/** Quienes figuran de un lado de la operación, con su parte si no es el 100 %. */
export function partiesOf(op: Pick<SalesOperation, 'parties'>, role: string): string {
  const side = op.parties.filter((p) => p.role === role);
  return side.map((p) => (side.length > 1 ? `${personName(p.person)} (${Number(p.sharePct)} %)` : personName(p.person))).join(', ');
}

/** Cuenta atrás de una fecha de vencimiento: días que faltan (negativo si ya pasó). */
export function daysUntil(date: string | null | undefined, today: Date = new Date()): number | null {
  if (!date) return null;
  const day = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const target = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Math.round((target - day) / 86_400_000);
}

/** Aviso de vencimiento de una reserva: vencida, vence hoy o pronto (3 días), o nada. */
export function expiryState(d: Pick<SalesDeposit, 'kind' | 'status' | 'expiresAt' | 'expired'>, today?: Date): 'expired' | 'today' | 'soon' | 'ok' | 'none' {
  if (d.kind !== 'Reserva' || !d.expiresAt) return 'none';
  if (d.status === 'Vencida' || d.expired) return 'expired';
  if (d.status !== 'Pendiente' && d.status !== 'Recibida') return 'none';
  const left = daysUntil(d.expiresAt, today);
  if (left === null) return 'none';
  if (left < 0) return 'expired';
  if (left === 0) return 'today';
  return left <= 3 ? 'soon' : 'ok';
}

/** Etapas a las que se puede ir desde la actual, en el orden en que se ofrecen. */
const TRANSITION_ORDER: readonly string[] = ['Reservada', 'SenaRecibida', 'Boleto', 'Escriturada', 'Publicada', 'Captacion', 'Cancelada'];

export function orderedTransitions(valid: readonly string[]): string[] {
  return TRANSITION_ORDER.filter((s) => valid.includes(s));
}
