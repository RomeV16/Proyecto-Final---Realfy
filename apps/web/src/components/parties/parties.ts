import {
  FULL_SHARE_UNITS,
  ReplaceContractLessorsSchema,
  findInvalidShareDates,
  pctToUnits,
  splitEqualPct,
  unitsToPct,
  type InvalidShareDate,
} from '@realfy/shared';

/* Tipos de lo que devuelve la API de partes (locadores, poderes, cuentas, titulares). */

export interface PartyPerson {
  id: string;
  firstName: string;
  lastName: string;
  cuit?: string | null;
  dni?: string | null;
}

export interface BankAccount {
  id: string;
  currency: string;
  bankName?: string | null;
  cbu?: string | null;
  alias?: string | null;
  holder?: string | null;
  isDefault: boolean;
}

export interface ContractLessor {
  id: string;
  personId: string;
  capacity: string;
  payoutPct: string | number;
  payeePersonId?: string | null;
  bankAccountId?: string | null;
  validFrom: string;
  validTo?: string | null;
  needsReview?: boolean;
  person: PartyPerson;
  payee?: PartyPerson | null;
  bankAccount?: BankAccount | null;
}

export interface PowerOfAttorney {
  id: string;
  principalId: string;
  agentId: string;
  scopes: string[];
  signatureMode: string;
  groupKey?: string | null;
  contractId?: string | null;
  propertyId?: string | null;
  validFrom: string;
  validTo?: string | null;
  documentUrl?: string | null;
  principal?: PartyPerson;
  agent?: PartyPerson;
  contract?: { id: string; propertyId?: string } | null;
  property?: { id: string; title: string } | null;
}

export interface PropertyOwnership {
  id: string;
  personId: string;
  sharePct?: string | number | null;
  title?: string | null;
  since?: string | null;
  until?: string | null;
  person: PartyPerson;
}

export const personName = (p: Pick<PartyPerson, 'firstName' | 'lastName'>) => `${p.firstName} ${p.lastName}`;

/** Fecha de solo día (`YYYY-MM-DD`) de un valor ISO. */
export const dayOf = (value?: string | null): string => (value ? value.slice(0, 10) : '');

/** Vigente en `at`: desde (incluido) hasta (excluido). */
export function isCurrent(row: { validFrom: string; validTo?: string | null }, at: Date = new Date()): boolean {
  const t = at.getTime();
  return new Date(row.validFrom).getTime() <= t && (!row.validTo || new Date(row.validTo).getTime() > t);
}

/** Poder que habilita a su apoderado a cobrar por el locador en este contrato. */
export function powerCollectsFor(
  power: PowerOfAttorney,
  lessorId: string,
  contract: { id: string; propertyId?: string | null },
  at: Date = new Date(),
): boolean {
  return (
    power.principalId === lessorId &&
    power.scopes.includes('Cobrar') &&
    isCurrent(power, at) &&
    (!power.contractId || power.contractId === contract.id) &&
    (!power.propertyId || power.propertyId === contract.propertyId)
  );
}

/* ──────────── Reparto de locadores ──────────── */

export interface LessorDraft {
  /** Clave local para las listas de React. */
  key: string;
  /** Presente en las filas que ya existen: el reemplazo las actualiza en lugar de crearlas. */
  id?: string;
  person: PartyPerson | null;
  capacity: string;
  payoutPct: string;
  payeePersonId: string;
  bankAccountId: string;
  validFrom: string;
  validTo: string;
}

let draftCounter = 0;
const newDraftKey = () => `lessor-${++draftCounter}`;

export function emptyDraft(overrides: Partial<LessorDraft> = {}): LessorDraft {
  return {
    key: newDraftKey(),
    person: null,
    capacity: 'Propietario',
    payoutPct: '',
    payeePersonId: '',
    bankAccountId: '',
    validFrom: '',
    validTo: '',
    ...overrides,
  };
}

export function draftFromLessor(l: ContractLessor): LessorDraft {
  return {
    key: newDraftKey(),
    id: l.id,
    person: l.person,
    capacity: l.capacity,
    payoutPct: Number(l.payoutPct).toFixed(4),
    payeePersonId: l.payeePersonId ?? '',
    bankAccountId: l.bankAccountId ?? '',
    validFrom: dayOf(l.validFrom),
    validTo: dayOf(l.validTo),
  };
}

/** Acepta coma o punto decimal y devuelve el número como texto, o `null` si no lo es. */
export function normalizePct(raw: string): string | null {
  const text = raw.trim().replace(',', '.');
  return /^\d{1,3}(\.\d{1,4})?$/.test(text) ? text : null;
}

export function formatUnitsPct(units: number): string {
  return unitsToPct(units).replace('.', ',');
}

/** Fin de la ventana del contrato cuando no tiene fecha de fin. */
const OPEN_ENDED = new Date('9999-12-31T00:00:00.000Z');

export interface ContractWindow {
  startDate: string;
  endDate?: string | null;
}

export interface ShareCheck {
  /** Suma de los locadores vigentes en la fecha de referencia, en diezmilésimas. */
  units: number;
  /** Diferencia con 100 %, en diezmilésimas (positiva si falta, negativa si sobra). */
  missing: number;
  invalidDates: InvalidShareDate[];
  /** Hay filas sin persona o con porcentaje inválido: no se puede calcular la suma. */
  incomplete: boolean;
  ok: boolean;
}

/** Fecha en la que se mira la suma que se muestra: hoy, dentro de la vigencia del contrato. */
function referenceDate(window: ContractWindow, today: Date): Date {
  const start = new Date(window.startDate);
  const end = window.endDate ? new Date(window.endDate) : OPEN_ENDED;
  const ref = today.getTime() < start.getTime() ? start : today;
  return ref.getTime() >= end.getTime() ? new Date(end.getTime() - 86_400_000) : ref;
}

export function checkShares(drafts: LessorDraft[], window: ContractWindow, today: Date = new Date()): ShareCheck {
  const rows = [];
  let incomplete = drafts.length === 0;
  for (const d of drafts) {
    const pct = normalizePct(d.payoutPct);
    if (pct === null || !d.person) {
      incomplete = true;
      continue;
    }
    rows.push({
      payoutPct: pct,
      validFrom: new Date(d.validFrom || window.startDate),
      validTo: d.validTo ? new Date(d.validTo) : null,
    });
  }
  const start = new Date(window.startDate);
  const end = window.endDate ? new Date(window.endDate) : OPEN_ENDED;
  const ref = referenceDate(window, today);
  const units = rows
    .filter((r) => r.validFrom.getTime() <= ref.getTime() && (!r.validTo || r.validTo.getTime() > ref.getTime()))
    .reduce((acc, r) => acc + pctToUnits(r.payoutPct), 0);
  const invalidDates = findInvalidShareDates(rows, start, end);
  return {
    units,
    missing: FULL_SHARE_UNITS - units,
    invalidDates,
    incomplete,
    ok: !incomplete && invalidDates.length === 0,
  };
}

/** Cuerpo del `PUT /contracts/:id/lessors`. */
export function lessorsPayload(drafts: LessorDraft[]) {
  return {
    lessors: drafts.map((d) => ({
      ...(d.id ? { id: d.id } : {}),
      personId: d.person!.id,
      capacity: d.capacity,
      payoutPct: normalizePct(d.payoutPct) ?? d.payoutPct,
      payeePersonId: d.payeePersonId || null,
      bankAccountId: d.bankAccountId || null,
      ...(d.validFrom ? { validFrom: d.validFrom } : {}),
      validTo: d.validTo || null,
    })),
  };
}

/** Campos de cada fila que el esquema compartido marcó como inválidos, por posición. */
export function lessorRowErrors(drafts: LessorDraft[]): Record<number, Record<string, true>> {
  const found: Record<number, Record<string, true>> = {};
  drafts.forEach((d, index) => {
    if (!d.person) found[index] = { personId: true };
  });
  if (Object.keys(found).length > 0) return found;
  const result = ReplaceContractLessorsSchema.safeParse(lessorsPayload(drafts));
  if (result.success) return found;
  for (const issue of result.error.issues) {
    const [root, index, field] = issue.path;
    if (root === 'lessors' && typeof index === 'number' && typeof field === 'string') {
      (found[index] ??= {})[field] = true;
    }
  }
  return found;
}

/** Reparte 100 % en partes iguales entre `count` locadores. */
export const equalShares = (count: number): string[] => (count > 0 ? splitEqualPct(count) : []);
