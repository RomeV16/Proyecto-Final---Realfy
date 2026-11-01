import { ImportEntity, ImportPersonSchema, PersonRole, PersonType, personName } from '@realfy/shared';
import type { ImportPersonRow } from '@realfy/shared';
import { ensureRole } from '../../persons/person-roles.service';
import { changedKeys, Db, EntityImporter, ImportContext, RowOutcome } from './import-types';

/** Campos de la persona que informa la fila; los ausentes no se tocan al actualizar. */
export function personFields(row: ImportPersonRow) {
  const legal = row.personType === PersonType.Juridica;
  return {
    personType: row.personType,
    firstName: legal ? row.businessName! : row.firstName!,
    // El apellido es obligatorio en la base: una razón social lo deja vacío.
    lastName: legal ? '' : row.lastName,
    email: row.email,
    phone: row.phone,
    phone2: row.phone2,
    cuit: row.cuit,
    dni: row.dni,
    address: row.address,
    maritalStatus: row.maritalStatus,
    nationality: row.nationality,
    payoutMethod: row.payoutMethod,
    fiscalCondition: row.fiscalCondition,
    notes: row.notes,
  };
}

/** Clave de una cuenta dentro de la persona: el CBU, o el alias si no lo hay. */
export function accountKey(a: { cbu?: string | null; alias?: string | null }): string {
  return a.cbu ? `cbu:${a.cbu}` : `alias:${a.alias ?? ''}`;
}

/**
 * Cuentas de la fila contra las guardadas: crea las nuevas, corrige las que
 * cambiaron y deja las demás como están (el lote no borra cuentas). Devuelve si
 * hubo algún cambio.
 */
async function syncBankAccounts(
  db: Db,
  ctx: ImportContext,
  person: { id: string; firstName: string; lastName: string },
  rows: NonNullable<ImportPersonRow['bankAccounts']>,
  existing: any[],
): Promise<boolean> {
  let changed = false;
  const accounts = [...existing];

  for (const a of rows) {
    const match = accounts.find((x) => accountKey(x) === accountKey(a));
    const holder = a.holder ?? personName(person);
    if (!match) {
      const isDefault = a.isDefault ?? !accounts.some((x) => x.currency === a.currency);
      const created = await db.personBankAccount.create({
        data: {
          tenantId: ctx.tenantId,
          personId: person.id,
          currency: a.currency,
          bankName: a.bank ?? null,
          cbu: a.cbu ?? null,
          alias: a.alias ?? null,
          holder,
          isDefault,
        },
      });
      if (isDefault) await unsetOtherDefaults(db, person.id, created);
      accounts.push(created);
      changed = true;
      continue;
    }

    const desired = {
      currency: a.currency,
      bankName: a.bank,
      alias: a.alias,
      holder: a.holder,
      isDefault: a.isDefault,
    };
    const diff = changedKeys(match, desired);
    if (diff.length === 0) continue;
    const data = Object.fromEntries(diff.map((k) => [k, (desired as Record<string, unknown>)[k]]));
    await db.personBankAccount.update({ where: { id: match.id }, data });
    Object.assign(match, data);
    if (data.isDefault === true) await unsetOtherDefaults(db, person.id, match);
    changed = true;
  }
  return changed;
}

async function unsetOtherDefaults(db: Db, personId: string, kept: { id: string; currency: string }) {
  await db.personBankAccount.updateMany({
    where: { personId, currency: kept.currency, isDefault: true, id: { not: kept.id } },
    data: { isDefault: false },
  });
}

async function upsertPerson(db: Db, ctx: ImportContext, row: ImportPersonRow): Promise<RowOutcome> {
  const fields = personFields(row);
  const existing = await db.person.findFirst({
    where: { tenantId: ctx.tenantId, externalRef: row.externalRef },
    include: { roles: true, bankAccounts: true },
  });

  if (!existing) {
    const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const created = await db.person.create({
      data: { lastName: '', ...data, tenantId: ctx.tenantId, externalRef: row.externalRef },
    });
    await syncBankAccounts(db, ctx, created, row.bankAccounts ?? [], []);
    for (const role of new Set(row.roles ?? [])) await ensureRole(db, created.id, role as PersonRole);
    return { action: 'Creado', entityId: created.id };
  }

  let changed = false;
  const diff = changedKeys(existing, fields);
  if (diff.length > 0) {
    await db.person.update({
      where: { id: existing.id },
      data: Object.fromEntries(diff.map((k) => [k, (fields as Record<string, unknown>)[k]])),
    });
    changed = true;
  }

  const have = new Set(existing.roles.map((r: { role: string }) => r.role));
  for (const role of new Set(row.roles ?? [])) {
    if (have.has(role)) continue;
    await ensureRole(db, existing.id, role as PersonRole);
    changed = true;
  }

  if (row.bankAccounts) {
    const holderOf = diff.length > 0 ? { ...existing, ...fields } : existing;
    if (await syncBankAccounts(db, ctx, holderOf, row.bankAccounts, existing.bankAccounts)) changed = true;
  }

  return { action: changed ? 'Actualizado' : 'SinCambios', entityId: existing.id };
}

export const personImporter: EntityImporter<typeof ImportPersonSchema> = {
  entity: ImportEntity.Persona,
  schema: ImportPersonSchema,
  upsert: upsertPerson,
};

