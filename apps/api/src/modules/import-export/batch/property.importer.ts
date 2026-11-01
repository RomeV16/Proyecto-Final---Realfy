import { ImportEntity, ImportPropertySchema } from '@realfy/shared';
import type { ImportPropertyRow } from '@realfy/shared';
import { changedKeys, dec, Db, EntityImporter, ImportContext, ImportRowError, resolveRef, RowOutcome } from './import-types';

/** Título legible a partir de la dirección cuando la fila no trae uno. */
export function propertyTitle(row: ImportPropertyRow): string | undefined {
  if (row.title) return row.title;
  const street = [row.street, row.number].filter(Boolean).join(' ');
  const unit = [row.floor && `Piso ${row.floor}`, row.unit && `Depto ${row.unit}`].filter(Boolean).join(' ');
  const title = [street, unit].filter(Boolean).join(', ');
  return title || undefined;
}

export function propertyFields(row: ImportPropertyRow) {
  return {
    title: propertyTitle(row),
    type: row.type,
    street: row.street,
    number: row.number,
    floor: row.floor,
    apartment: row.unit,
    city: row.city,
    province: row.province,
    zipCode: row.zipCode,
    cadastralId: row.cadastralId,
  };
}

/** Titularidades de la fila contra las guardadas: si el conjunto difiere se reemplaza entero. */
async function syncOwners(
  db: Db,
  ctx: ImportContext,
  propertyId: string,
  owners: NonNullable<ImportPropertyRow['owners']>,
  existing: any[],
): Promise<boolean> {
  const desired = new Map<string, string | null>();
  for (const [i, o] of owners.entries()) {
    const personId = await resolveRef(db, 'person', ctx, o.personExternalRef, `owners[${i}].personExternalRef`);
    if (desired.has(personId)) {
      throw new ImportRowError('VALIDATION_ERROR', `Owner "${o.personExternalRef}" is repeated`, `owners[${i}]`);
    }
    desired.set(personId, dec(o.sharePct, 4));
  }

  const same =
    existing.length === desired.size &&
    existing.every((e) => desired.has(e.personId) && desired.get(e.personId) === dec(e.sharePct, 4));
  if (same) return false;

  await db.propertyOwnership.deleteMany({ where: { propertyId } });
  for (const [personId, share] of desired) {
    await db.propertyOwnership.create({
      data: { tenantId: ctx.tenantId, propertyId, personId, sharePct: share },
    });
  }
  return true;
}

async function upsertProperty(db: Db, ctx: ImportContext, row: ImportPropertyRow): Promise<RowOutcome> {
  const parentId = row.parentExternalRef
    ? await resolveRef(db, 'property', ctx, row.parentExternalRef, 'parentExternalRef')
    : undefined;
  const fields = { ...propertyFields(row), parentPropertyId: parentId };

  const existing = await db.property.findFirst({
    where: { tenantId: ctx.tenantId, externalRef: row.externalRef },
    include: { ownerships: true },
  });

  if (!existing) {
    const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const created = await db.property.create({
      data: { ...data, title: fields.title ?? row.externalRef, tenantId: ctx.tenantId, externalRef: row.externalRef },
    });
    if (row.owners) await syncOwners(db, ctx, created.id, row.owners, []);
    return { action: 'Creado', entityId: created.id };
  }

  let changed = false;
  const diff = changedKeys(existing, fields);
  if (diff.length > 0) {
    await db.property.update({
      where: { id: existing.id },
      data: Object.fromEntries(diff.map((k) => [k, (fields as Record<string, unknown>)[k]])),
    });
    changed = true;
  }
  if (row.owners && (await syncOwners(db, ctx, existing.id, row.owners, existing.ownerships))) changed = true;

  return { action: changed ? 'Actualizado' : 'SinCambios', entityId: existing.id };
}

export const propertyImporter: EntityImporter<typeof ImportPropertySchema> = {
  entity: ImportEntity.Propiedad,
  schema: ImportPropertySchema,
  upsert: upsertProperty,
};
