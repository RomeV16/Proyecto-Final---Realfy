import {
  ContractPeriodKind,
  ContractStatus,
  ContractType,
  ImportContractSchema,
  ImportEntity,
  CommissionType,
  PaymentFlow,
  PersonRole,
  PropertyOperationType,
} from '@realfy/shared';
import type { ImportContractRow } from '@realfy/shared';
import { ensureRole } from '../../persons/person-roles.service';
import { occupyRentalOperation, releaseRentalOperation } from '../../contracts/property-occupancy';
import {
  IMPORTED_NOTE,
  adjustmentPercentage,
  assertContractRow,
  importedSchedule,
  misplacedImportedAdjustments,
  planScheduleSync,
} from './contract-import-rules';
import {
  changedKeys,
  dayIso,
  dec,
  Db,
  EntityImporter,
  ImportContext,
  ImportRowError,
  resolveRef,
  RowOutcome,
} from './import-types';

type History = ReturnType<typeof assertContractRow>;

interface ResolvedLessor {
  personId: string;
  capacity: string;
  payoutPct: string;
  payeePersonId: string | null;
  bankAccountId: string | null;
  needsReview: boolean;
}

const sameValue = (_k: string, a: unknown, b: unknown): boolean => {
  if (a instanceof Date || b instanceof Date) return dayIso(a as Date) === dayIso(b as Date);
  if (typeof b === 'number') return dec(a, 4) === dec(b, 4);
  return a === b;
};

async function resolveLessors(db: Db, ctx: ImportContext, row: ImportContractRow): Promise<ResolvedLessor[]> {
  const out: ResolvedLessor[] = [];
  for (const [i, l] of (row.lessors ?? []).entries()) {
    const field = `lessors[${i}]`;
    const personId = await resolveRef(db, 'person', ctx, l.personExternalRef, `${field}.personExternalRef`);
    const payeePersonId = l.payeeExternalRef
      ? await resolveRef(db, 'person', ctx, l.payeeExternalRef, `${field}.payeeExternalRef`)
      : null;
    let bankAccountId: string | null = null;
    if (l.bankAccountCbu) {
      const account = await db.personBankAccount.findFirst({
        where: { tenantId: ctx.tenantId, personId, cbu: l.bankAccountCbu },
        select: { id: true },
      });
      if (!account) {
        throw new ImportRowError('REFERENCE_NOT_FOUND', `The lessor has no bank account with CBU ${l.bankAccountCbu}`, `${field}.bankAccountCbu`);
      }
      bankAccountId = account.id;
    }
    out.push({
      personId,
      capacity: l.capacity,
      payoutPct: l.payoutPct.toFixed(4),
      payeePersonId,
      bankAccountId,
      needsReview: l.needsReview ?? false,
    });
  }
  return out;
}

async function resolveParties(db: Db, ctx: ImportContext, row: ImportContractRow) {
  const parties: Array<{ role: PersonRole; personId: string }> = [];
  for (const [role, refs, name] of [
    [PersonRole.Inquilino, row.tenants, 'tenants'],
    [PersonRole.Garante, row.guarantors, 'guarantors'],
  ] as const) {
    for (const [i, ref] of (refs ?? []).entries()) {
      parties.push({ role, personId: await resolveRef(db, 'person', ctx, ref, `${name}[${i}]`) });
    }
  }
  return parties;
}

const partyKey = (p: { role: string; personId: string }) => `${p.role}|${p.personId}`;
const lessorKey = (l: ResolvedLessor) =>
  [l.personId, l.capacity, dec(l.payoutPct, 4), l.payeePersonId, l.bankAccountId, l.needsReview].join('|');

async function assertNoOverlap(
  db: Db,
  ctx: ImportContext,
  row: ImportContractRow,
  propertyId: string,
  selfId: string | null,
) {
  if (row.status !== ContractStatus.Activo || row.contractType !== ContractType.Alquiler) return;
  const start = new Date(row.startDate);
  const end = new Date(row.actualEndDate ?? row.endDate);
  const others = await db.contract.findMany({
    where: {
      tenantId: ctx.tenantId,
      propertyId,
      status: ContractStatus.Activo,
      contractType: ContractType.Alquiler,
      ...(selfId ? { id: { not: selfId } } : {}),
    },
    select: { externalRef: true, startDate: true, endDate: true, actualEndDate: true },
  });
  const clash = others.find((o: any) => {
    const oEnd = o.actualEndDate ?? o.endDate;
    return o.startDate.getTime() <= end.getTime() && start.getTime() <= oEnd.getTime();
  });
  if (clash) {
    throw new ImportRowError(
      'OVERLAPPING_ACTIVE_CONTRACT',
      `The property already has an active contract in those dates${clash.externalRef ? ` (${clash.externalRef})` : ''}`,
      'propertyExternalRef',
    );
  }
}

/** Reemplaza el conjunto de partes o de locadores del contrato si difiere; devuelve si cambió. */
async function syncParties(db: Db, ctx: ImportContext, contractId: string, row: ImportContractRow, parties: Array<{ role: PersonRole; personId: string }>, existing: any[]) {
  const roles = new Set<string>();
  if (row.tenants) roles.add(PersonRole.Inquilino);
  if (row.guarantors) roles.add(PersonRole.Garante);
  if (roles.size === 0) return false;

  const current = existing.filter((p) => roles.has(p.role));
  const desired = new Set(parties.map(partyKey));
  if (current.length === desired.size && current.every((p) => desired.has(partyKey(p)))) return false;

  await db.contractPerson.deleteMany({ where: { contractId, role: { in: [...roles] } } });
  for (const p of parties) {
    await db.contractPerson.create({ data: { tenantId: ctx.tenantId, contractId, ...p } });
    await ensureRole(db, p.personId, p.role);
  }
  return true;
}

async function syncLessors(db: Db, ctx: ImportContext, contractId: string, start: Date, lessors: ResolvedLessor[], existing: any[]) {
  const current = existing.map((l) => lessorKey({ ...l, payoutPct: String(l.payoutPct), needsReview: l.needsReview })).sort((a, b) => a.localeCompare(b));
  const desired = lessors.map(lessorKey).sort((a, b) => a.localeCompare(b));
  if (current.length === desired.length && current.every((k, i) => k === desired[i])) return false;

  await db.contractLessor.deleteMany({ where: { contractId } });
  for (const l of lessors) {
    await db.contractLessor.create({
      data: { tenantId: ctx.tenantId, contractId, ...l, validFrom: start, validTo: null },
    });
    await ensureRole(db, l.personId, PersonRole.Propietario);
  }
  return true;
}

/** Versión de reglas vigente desde el inicio del contrato. El rezago de un contrato ya cargado no se pisa con el por defecto. */
async function syncTerms(db: Db, ctx: ImportContext, contractId: string, row: ImportContractRow, existing: any | null) {
  const t = row.terms;
  const data = {
    adjustmentType: t.adjustmentType,
    adjustmentPeriod: t.adjustmentPeriod,
    adjustmentBase: t.adjustmentBase,
    indexLagMonths: t.indexLagMonths ?? existing?.indexLagMonths ?? ctx.defaults.ipcLagMonths,
    fixedInitialMonths: t.fixedInitialMonths,
    customPct: t.customPct ?? null,
    dueDay: t.dueDay ?? existing?.dueDay ?? ctx.defaults.dueDay,
    paymentFlow: row.selfManaged ? PaymentFlow.TodoLocador : t.paymentFlow,
  };
  const validFrom = new Date(row.startDate);
  if (!existing) {
    await db.contractTermsVersion.create({ data: { tenantId: ctx.tenantId, contractId, validFrom, ...data } });
    return true;
  }
  const diff = changedKeys(existing, data, sameValue);
  if (diff.length === 0) return false;
  await db.contractTermsVersion.update({ where: { id: existing.id }, data });
  return true;
}

async function syncPeriod(db: Db, ctx: ImportContext, contractId: string, row: ImportContractRow, history: History, existing: any | null) {
  const data = {
    startDate: new Date(row.startDate),
    endDate: new Date(row.endDate),
    initialRent: row.initialRent ?? history[0]?.previousAmount ?? row.rentAmount,
  };
  if (!existing) {
    await db.contractPeriod.create({
      data: { tenantId: ctx.tenantId, contractId, seq: 1, kind: ContractPeriodKind.Original, ...data },
    });
    return true;
  }
  if (changedKeys(existing, data, sameValue).length === 0) return false;
  await db.contractPeriod.update({ where: { id: existing.id }, data });
  return true;
}

async function syncCommission(db: Db, ctx: ImportContext, contractId: string, row: ImportContractRow, existing: any | null) {
  if (!row.commission && !row.selfManaged) return false;
  const c = row.commission;
  // Autoadministrado: sólo la comisión inicial, sin porcentaje mensual.
  const data = row.selfManaged
    ? { type: CommissionType.FixedAmount, percentage: null, fixedAmount: c?.fixedAmount ?? null, adminFee: null }
    : { type: c!.type, percentage: c!.percentage ?? null, fixedAmount: c!.fixedAmount ?? null, adminFee: c!.adminFee ?? null };
  const full = { ...data, currency: row.currency };
  if (!existing) {
    await db.contractCommission.create({ data: { tenantId: ctx.tenantId, contractId, ...full } });
    return true;
  }
  if (changedKeys(existing, full, sameValue).length === 0) return false;
  await db.contractCommission.update({ where: { contractId }, data: full });
  return true;
}

async function syncAdjustments(db: Db, ctx: ImportContext, contractId: string, row: ImportContractRow, history: History, current: any[]) {
  let changed = false;
  // Un ajuste cargado antes con otro número de período que el de su fecha se rehace en el que le toca.
  const misplaced = new Set(misplacedImportedAdjustments(current, history));
  if (misplaced.size > 0) {
    await db.contractAdjustment.deleteMany({ where: { id: { in: [...misplaced] } } });
    changed = true;
  }
  const existing = current.filter((e) => !misplaced.has(e.id));
  for (const h of history) {
    const data = {
      adjustmentDate: new Date(h.appliedAt),
      previousAmount: h.previousAmount,
      newAmount: h.newAmount,
      percentage: adjustmentPercentage(h),
      currency: row.currency,
      indexType: row.terms.adjustmentType,
      indexValues: h.factor !== undefined ? { factor: h.factor } : null,
      appliedAt: new Date(h.appliedAt),
    };
    const found = existing.find((e) => e.periodNumber === h.periodNumber && !e.isProvisional);
    if (!found) {
      await db.contractAdjustment.create({
        data: { tenantId: ctx.tenantId, contractId, periodNumber: h.periodNumber, calculatedAt: data.appliedAt, notes: IMPORTED_NOTE, ...data },
      });
      changed = true;
      continue;
    }
    const { indexValues: _iv, ...comparable } = data;
    const factorSame = JSON.stringify(found.indexValues ?? null) === JSON.stringify(data.indexValues);
    if (changedKeys(found, comparable, sameValue).length > 0 || !factorSame) {
      await db.contractAdjustment.update({ where: { id: found.id }, data });
      changed = true;
    }
  }
  return changed;
}

/**
 * Deja el cronograma como lo indica el lote: crea los períodos que faltan,
 * corrige fecha y estado de los pendientes y salteados (un período con ajuste
 * pasa a aplicado, uno atrasado a pendiente, uno de otro período de ajuste a su
 * fecha nueva) y quita los pendientes que sobran. Los aplicados con ajuste no se tocan.
 */
async function syncSchedule(db: Db, ctx: ImportContext, contractId: string, row: ImportContractRow) {
  const adjustments = await db.contractAdjustment.findMany({ where: { contractId }, select: { periodNumber: true } });
  const applied = new Set<number>(adjustments.map((a: { periodNumber: number }) => a.periodNumber));
  const desired = importedSchedule(
    new Date(row.startDate),
    new Date(row.actualEndDate ?? row.endDate),
    row.terms.adjustmentPeriod,
    applied,
    new Date(),
  );
  const existing = await db.adjustmentSchedule.findMany({
    where: { contractId },
    select: { id: true, periodNumber: true, nextAdjustmentDate: true, status: true },
  });
  const plan = planScheduleSync(existing, desired, applied);

  if (plan.remove.length > 0) await db.adjustmentSchedule.deleteMany({ where: { id: { in: plan.remove } } });
  for (const u of plan.update) {
    await db.adjustmentSchedule.update({ where: { id: u.id }, data: { nextAdjustmentDate: u.date, status: u.status } });
  }
  for (const e of plan.create) {
    await db.adjustmentSchedule.create({
      data: { tenantId: ctx.tenantId, contractId, nextAdjustmentDate: e.date, periodNumber: e.periodNumber, status: e.status },
    });
  }
  return plan.create.length + plan.update.length + plan.remove.length > 0;
}

async function upsertContract(db: Db, ctx: ImportContext, row: ImportContractRow): Promise<RowOutcome> {
  const history = assertContractRow(row);
  const propertyId = await resolveRef(db, 'property', ctx, row.propertyExternalRef, 'propertyExternalRef');
  const parties = await resolveParties(db, ctx, row);
  const lessors = await resolveLessors(db, ctx, row);

  const existing = await db.contract.findFirst({
    where: { tenantId: ctx.tenantId, externalRef: row.externalRef },
    include: { persons: true, lessors: true, commission: true, adjustments: true },
  });
  await assertNoOverlap(db, ctx, row, propertyId, existing?.id ?? null);

  const fields = {
    propertyId,
    contractType: row.contractType,
    status: row.status,
    startDate: new Date(row.startDate),
    endDate: new Date(row.endDate),
    actualEndDate: row.actualEndDate ? new Date(row.actualEndDate) : undefined,
    rentAmount: row.rentAmount,
    rentCurrency: row.currency,
    depositAmount: row.depositAmount,
    notes: row.notes,
    adjustmentType: row.terms.adjustmentType,
    adjustmentPeriod: row.terms.adjustmentPeriod,
    customAdjustmentPct: row.terms.customPct,
  };

  let contractId: string;
  let created = false;
  let changed = false;
  if (!existing) {
    const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const contract = await db.contract.create({
      data: { ...data, tenantId: ctx.tenantId, externalRef: row.externalRef },
    });
    contractId = contract.id;
    created = true;
  } else {
    contractId = existing.id;
    const diff = changedKeys(existing, fields, sameValue);
    if (diff.length > 0) {
      await db.contract.update({
        where: { id: contractId },
        data: Object.fromEntries(diff.map((k) => [k, (fields as Record<string, unknown>)[k]])),
      });
      changed = true;
    }
  }

  const start = new Date(row.startDate);
  const terms = existing
    ? await db.contractTermsVersion.findFirst({ where: { contractId, validFrom: start } })
    : null;
  const period = existing ? await db.contractPeriod.findFirst({ where: { contractId, seq: 1 } }) : null;
  const steps = [
    await syncTerms(db, ctx, contractId, row, terms),
    await syncPeriod(db, ctx, contractId, row, history, period),
    await syncParties(db, ctx, contractId, row, parties, existing?.persons ?? []),
    row.lessors ? await syncLessors(db, ctx, contractId, start, lessors, existing?.lessors ?? []) : false,
    await syncCommission(db, ctx, contractId, row, existing?.commission ?? null),
    await syncAdjustments(db, ctx, contractId, row, history, existing?.adjustments ?? []),
    row.status === ContractStatus.Activo ? await syncSchedule(db, ctx, contractId, row) : false,
  ];
  if (created || steps.some(Boolean)) changed = true;

  // El estado de la propiedad sólo se mueve cuando cambia el del contrato; no se envía ningún aviso.
  const wasActive = existing?.status === ContractStatus.Activo && existing.propertyId === propertyId;
  if (row.status === ContractStatus.Activo && !wasActive && row.contractType === ContractType.Alquiler) {
    const result = await occupyRentalOperation(db, ctx.tenantId, propertyId);
    if (result.outcome === 'unreachable') {
      throw new ImportRowError(
        'PROPERTY_STATE_CONFLICT',
        `The ${PropertyOperationType.Alquiler} operation of the property is ${result.from} and cannot become rented`,
        'propertyExternalRef',
      );
    }
  } else if (existing?.status === ContractStatus.Activo && row.status !== ContractStatus.Activo) {
    await releaseRentalOperation(db, { id: contractId, propertyId: existing.propertyId, contractType: existing.contractType });
  }

  return { action: created ? 'Creado' : changed ? 'Actualizado' : 'SinCambios', entityId: contractId };
}

export const contractImporter: EntityImporter<typeof ImportContractSchema> = {
  entity: ImportEntity.Contrato,
  schema: ImportContractSchema,
  upsert: upsertContract,
};
