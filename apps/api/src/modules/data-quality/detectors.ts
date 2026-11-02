import type { DataQualityFinding } from '@realfy/shared';
import {
  dniFromCuit,
  normalizeCbu,
  normalizeCuit,
  normalizeDni,
  normalizeEmail,
  normalizeName,
  normalizePhone,
} from './normalize';

/** Lo que cada detector necesita, ya leído y con números y fechas comunes. */
export interface PersonRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  cuit: string | null;
  dni: string | null;
  personType: string;
  payoutMethod: string | null;
  roles: string[];
}

export interface BankAccountRow {
  personId: string;
  cbu: string | null;
  alias: string | null;
}

export interface LessorRow {
  contractId: string;
  personId: string;
  payoutPct: number;
  validFrom: Date;
  validTo: Date | null;
}

export interface OwnershipRow {
  propertyId: string;
  personId: string;
  sharePct: number | null;
  since: Date | null;
  until: Date | null;
}

export interface PropertyRow {
  id: string;
  title: string;
}

export interface ContractRow {
  id: string;
  status: string;
  propertyId: string;
  propertyTitle: string;
  endDate: Date;
  actualEndDate: Date | null;
  closedAt: Date | null;
  rentAmount: number;
  adjustmentType: string;
  customAdjustmentPct: number | null;
  tenantCount: number;
  renewalCount: number;
  hasClosureSummary: boolean;
}

/** Tolerancia de redondeo al sumar porcentajes (3 × 33,3333 = 99,9999). */
export const PCT_TOLERANCE = 0.01;

const personLabel = (p: PersonRow) => `${p.lastName}, ${p.firstName}`.trim();
const pct = (n: number) => Math.round(n * 10000) / 10000;
const sumPct = (rows: { pct: number }[]) => pct(rows.reduce((s, r) => s + r.pct, 0));
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Vigente hoy: empezó y no terminó (el fin es exclusivo). */
export function inForce(from: Date | null, to: Date | null, now: Date): boolean {
  return (!from || from <= now) && (!to || to > now);
}

// ─── Duplicados ─────────────────────────────────────────

/** Agrupa por clave y deja los grupos con dos o más personas distintas. */
function groupByKey(entries: { personId: string; key: string | null }[]): Map<string, string[]> {
  const groups = new Map<string, Set<string>>();
  for (const { personId, key } of entries) {
    if (!key) continue;
    const set = groups.get(key) ?? new Set<string>();
    set.add(personId);
    groups.set(key, set);
  }
  const out = new Map<string, string[]>();
  for (const [key, set] of groups) if (set.size > 1) out.set(key, [...set].sort());
  return out;
}

function duplicateFindings(
  check: DataQualityFinding['check'],
  field: string,
  groups: Map<string, string[]>,
  people: Map<string, PersonRow>,
  severity: DataQualityFinding['severity'],
): DataQualityFinding[] {
  return [...groups.entries()]
    .map(([key, ids]) => {
      const members = ids.map((id) => ({ id, label: personLabel(people.get(id)!) }));
      return {
        id: `${check}:${key}`,
        check,
        severity,
        entityType: 'Person' as const,
        entityId: ids[0],
        label: members.map((m) => m.label).join(' / '),
        fields: [field],
        link: `/persons/${ids[0]}`,
        members,
        details: { value: key, count: ids.length },
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function detectDuplicateCuit(persons: PersonRow[]): DataQualityFinding[] {
  const map = new Map(persons.map((p) => [p.id, p]));
  const groups = groupByKey(persons.map((p) => ({ personId: p.id, key: normalizeCuit(p.cuit) })));
  return duplicateFindings('duplicate-cuit', 'cuit', groups, map, 'error');
}

/** El DNI cargado, o el que lleva el CUIL de una persona física sin DNI. */
export function detectDuplicateDni(persons: PersonRow[]): DataQualityFinding[] {
  const map = new Map(persons.map((p) => [p.id, p]));
  const groups = groupByKey(
    persons.map((p) => ({
      personId: p.id,
      key: normalizeDni(p.dni) ?? (p.personType === 'Fisica' ? dniFromCuit(p.cuit) : null),
    })),
  );
  return duplicateFindings('duplicate-dni', 'dni', groups, map, 'error');
}

export function detectDuplicateCbu(accounts: BankAccountRow[], persons: PersonRow[]): DataQualityFinding[] {
  const map = new Map(persons.map((p) => [p.id, p]));
  const known = accounts.filter((a) => map.has(a.personId));
  const groups = groupByKey(known.map((a) => ({ personId: a.personId, key: normalizeCbu(a.cbu) })));
  return duplicateFindings('duplicate-cbu', 'bankAccounts', groups, map, 'error');
}

/** Un teléfono compartido puede ser de la familia o de la oficina: es aviso, no error. */
export function detectDuplicatePhone(persons: PersonRow[]): DataQualityFinding[] {
  const map = new Map(persons.map((p) => [p.id, p]));
  const entries = persons.flatMap((p) => [
    { personId: p.id, key: normalizePhone(p.phone) },
    { personId: p.id, key: normalizePhone(p.phone2) },
  ]);
  return duplicateFindings('duplicate-phone', 'phone', groupByKey(entries), map, 'warning');
}

export function detectDuplicateEmail(persons: PersonRow[]): DataQualityFinding[] {
  const map = new Map(persons.map((p) => [p.id, p]));
  const groups = groupByKey(persons.map((p) => ({ personId: p.id, key: normalizeEmail(p.email) })));
  return duplicateFindings('duplicate-email', 'email', groups, map, 'warning');
}

/** Dos personas con documentos o CUIT distintos no son la misma aunque se llamen igual. */
function sameIdentity(a: PersonRow, b: PersonRow): boolean {
  const cuitA = normalizeCuit(a.cuit);
  const cuitB = normalizeCuit(b.cuit);
  if (cuitA && cuitB && cuitA !== cuitB) return false;
  const dniA = normalizeDni(a.dni) ?? dniFromCuit(a.cuit);
  const dniB = normalizeDni(b.dni) ?? dniFromCuit(b.cuit);
  return !(dniA && dniB && dniA !== dniB);
}

/**
 * Mismo nombre normalizado. Se descartan los pares con CUIT o DNI distintos
 * (homónimos): sólo quedan las personas que podrían ser la misma.
 */
export function detectDuplicateName(persons: PersonRow[]): DataQualityFinding[] {
  const map = new Map(persons.map((p) => [p.id, p]));
  const byName = new Map<string, PersonRow[]>();
  for (const p of persons) {
    const key = normalizeName(p.firstName, p.lastName);
    if (key) byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  const groups = new Map<string, string[]>();
  for (const [key, list] of byName) {
    if (list.length < 2) continue;
    const involved = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (sameIdentity(list[i], list[j])) {
          involved.add(list[i].id);
          involved.add(list[j].id);
        }
      }
    }
    if (involved.size > 1) groups.set(key, [...involved].sort());
  }
  return duplicateFindings('duplicate-name', 'name', groups, map, 'warning');
}

// ─── Locadores y titularidades ──────────────────────────

/** Contratos activos cuyos locadores vigentes no suman 100 %. */
export function detectLessorsSum(
  contracts: ContractRow[],
  lessors: LessorRow[],
  now: Date,
): DataQualityFinding[] {
  const byContract = new Map<string, LessorRow[]>();
  for (const l of lessors) {
    if (!inForce(l.validFrom, l.validTo, now)) continue;
    byContract.set(l.contractId, [...(byContract.get(l.contractId) ?? []), l]);
  }
  return contracts
    .filter((c) => c.status === 'Activo')
    .flatMap((c) => {
      const rows = byContract.get(c.id) ?? [];
      const sum = sumPct(rows.map((r) => ({ pct: r.payoutPct })));
      if (Math.abs(sum - 100) <= PCT_TOLERANCE) return [];
      return [
        {
          id: `lessors-sum:${c.id}`,
          check: 'lessors-sum' as const,
          severity: 'error' as const,
          entityType: 'Contract' as const,
          entityId: c.id,
          label: c.propertyTitle,
          fields: ['lessors'],
          link: `/contracts/${c.id}`,
          details: { sum, lessors: rows.length },
        },
      ];
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Propiedades con titulares vigentes cuyas partes no suman 100 %. Un único
 * titular sin parte cargada se da por dueño del total; con varios, una parte
 * vacía cuenta como incompleta.
 */
export function detectOwnershipSum(
  properties: PropertyRow[],
  ownerships: OwnershipRow[],
  now: Date,
): DataQualityFinding[] {
  const byProperty = new Map<string, OwnershipRow[]>();
  for (const o of ownerships) {
    if (!inForce(o.since, o.until, now)) continue;
    byProperty.set(o.propertyId, [...(byProperty.get(o.propertyId) ?? []), o]);
  }
  return properties
    .flatMap((p) => {
      const rows = byProperty.get(p.id) ?? [];
      if (rows.length === 0) return [];
      const missing = rows.filter((r) => r.sharePct === null).length;
      if (rows.length === 1 && missing === 1) return [];
      const sum = sumPct(rows.map((r) => ({ pct: r.sharePct ?? 0 })));
      if (missing === 0 && Math.abs(sum - 100) <= PCT_TOLERANCE) return [];
      return [
        {
          id: `ownership-sum:${p.id}`,
          check: 'ownership-sum' as const,
          severity: 'warning' as const,
          entityType: 'Property' as const,
          entityId: p.id,
          label: p.title,
          fields: ['ownerships'],
          link: `/properties/${p.id}`,
          details: { sum, owners: rows.length, withoutShare: missing },
        },
      ];
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Propiedades activas sin ningún titular vigente. */
export function detectPropertyWithoutOwner(
  properties: PropertyRow[],
  ownerships: OwnershipRow[],
  now: Date,
): DataQualityFinding[] {
  const withOwner = new Set(ownerships.filter((o) => inForce(o.since, o.until, now)).map((o) => o.propertyId));
  return properties
    .filter((p) => !withOwner.has(p.id))
    .map((p) => ({
      id: `property-no-owner:${p.id}`,
      check: 'property-no-owner' as const,
      severity: 'warning' as const,
      entityType: 'Property' as const,
      entityId: p.id,
      label: p.title,
      fields: ['ownerships'],
      link: `/properties/${p.id}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Personas que cobran como locador o titular: los locadores vigentes y los titulares vigentes. */
export function payeeIds(lessors: LessorRow[], ownerships: OwnershipRow[], now: Date): Set<string> {
  return new Set([
    ...lessors.filter((l) => inForce(l.validFrom, l.validTo, now)).map((l) => l.personId),
    ...ownerships.filter((o) => inForce(o.since, o.until, now)).map((o) => o.personId),
  ]);
}

/** Propietarios que cobran por transferencia y no tienen una cuenta con CBU o alias. */
export function detectOwnerWithoutBankAccount(
  persons: PersonRow[],
  accounts: BankAccountRow[],
  owners: Set<string>,
): DataQualityFinding[] {
  const withAccount = new Set(accounts.filter((a) => a.cbu?.trim() || a.alias?.trim()).map((a) => a.personId));
  return persons
    .filter((p) => owners.has(p.id) && p.payoutMethod === 'Transferencia' && !withAccount.has(p.id))
    .map((p) => ({
      id: `owner-no-bank-account:${p.id}`,
      check: 'owner-no-bank-account' as const,
      severity: 'error' as const,
      entityType: 'Person' as const,
      entityId: p.id,
      label: personLabel(p),
      fields: ['bankAccounts', 'payoutMethod'],
      link: `/persons/${p.id}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Locadores y titulares sin CUIT ni DNI. */
export function detectLessorWithoutTaxId(persons: PersonRow[], owners: Set<string>): DataQualityFinding[] {
  return persons
    .filter((p) => owners.has(p.id) && !normalizeCuit(p.cuit) && !normalizeDni(p.dni))
    .map((p) => ({
      id: `lessor-no-tax-id:${p.id}`,
      check: 'lessor-no-tax-id' as const,
      severity: 'error' as const,
      entityType: 'Person' as const,
      entityId: p.id,
      label: personLabel(p),
      fields: ['cuit', 'dni'],
      link: `/persons/${p.id}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ─── Contratos ──────────────────────────────────────────

/**
 * Contratos vencidos cuyo fin efectivo (`actualEndDate` o `endDate`) ya pasó y
 * sin decisión: ni renovación, ni cierre con resumen, ni fecha de cierre. Una
 * rescisión cambia el estado a Rescindido y una prórroga corre el fin efectivo,
 * así que ninguna de las dos llega acá.
 */
export function detectExpiredUndecided(contracts: ContractRow[], now: Date): DataQualityFinding[] {
  return contracts
    .filter((c) => c.status === 'Vencido')
    .filter((c) => (c.actualEndDate ?? c.endDate) < now)
    .filter((c) => c.renewalCount === 0 && !c.hasClosureSummary && !c.closedAt)
    .map((c) => ({
      id: `contract-expired-undecided:${c.id}`,
      check: 'contract-expired-undecided' as const,
      severity: 'warning' as const,
      entityType: 'Contract' as const,
      entityId: c.id,
      label: c.propertyTitle,
      fields: ['status', 'endDate'],
      link: `/contracts/${c.id}`,
      details: { effectiveEnd: isoDate(c.actualEndDate ?? c.endDate) },
    }))
    .sort((a, b) => String(a.details?.effectiveEnd).localeCompare(String(b.details?.effectiveEnd)));
}

/**
 * Contratos activos sin lo esencial: inquilino, alquiler y regla de ajuste
 * (porcentaje en los tipos que lo piden). El contrato no guarda día de
 * vencimiento: lo definen las reglas de cargos, así que no se controla acá.
 */
export function detectContractEssentials(contracts: ContractRow[]): DataQualityFinding[] {
  return contracts
    .filter((c) => c.status === 'Activo')
    .flatMap((c) => {
      const fields: string[] = [];
      if (c.tenantCount === 0) fields.push('tenant');
      if (!(c.rentAmount > 0)) fields.push('rentAmount');
      const needsPct = c.adjustmentType === 'FixedPercent' || c.adjustmentType === 'Custom';
      if (needsPct && !(c.customAdjustmentPct && c.customAdjustmentPct > 0)) fields.push('adjustment');
      if (fields.length === 0) return [];
      return [
        {
          id: `contract-essentials:${c.id}`,
          check: 'contract-essentials' as const,
          severity: 'error' as const,
          entityType: 'Contract' as const,
          entityId: c.id,
          label: c.propertyTitle,
          fields,
          link: `/contracts/${c.id}`,
        },
      ];
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
