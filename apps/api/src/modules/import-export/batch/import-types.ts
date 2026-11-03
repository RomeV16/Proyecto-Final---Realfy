import type { ZodTypeAny, z } from 'zod';
import type { ImportEntity, ImportErrorCode, ImportRowErrorDetail, OperationalDefaults } from '@realfy/shared';

/** Cliente de Prisma o transacción. */
export type Db = any;

/** Error de una fila: lleva el código estable que ve quien llama al importador. */
export class ImportRowError extends Error {
  readonly details: ImportRowErrorDetail[];

  constructor(code: ImportErrorCode, message: string, field?: string) {
    super(message);
    this.details = [{ code, message, ...(field ? { field } : {}) }];
  }

  static fromDetails(details: ImportRowErrorDetail[]): ImportRowError {
    const first = details[0];
    const err = new ImportRowError(first.code, first.message, first.field);
    (err as { details: ImportRowErrorDetail[] }).details = details;
    return err;
  }
}

export interface ImportContext {
  tenantId: string;
  defaults: OperationalDefaults;
  /** Recalcula las partes de las boletas de un servicio desde una fecha (tras cambiar sus reglas). */
  reallocateService?: (db: Db, serviceId: string, from: Date) => Promise<unknown>;
}

export type UpsertAction = 'Creado' | 'Actualizado' | 'SinCambios';

export interface RowOutcome {
  action: UpsertAction;
  entityId: string;
}

/** Una entrada del registro de importadores: esquema de la fila y su upsert por referencia externa. */
export interface EntityImporter<S extends ZodTypeAny = ZodTypeAny> {
  entity: ImportEntity;
  schema: S;
  /** Clave de la fila dentro del lote, para detectar repetidas. Por defecto, su `externalRef`. */
  keyOf?(row: z.output<S>): string;
  /** Referencia que se registra de una fila sin validar. Por defecto, su `externalRef`. */
  refOf?(raw: unknown): string | null;
  upsert(db: Db, ctx: ImportContext, row: z.output<S>): Promise<RowOutcome>;
}

/** Decimal o número como texto con `places` decimales, para comparar sin ruido de coma flotante. */
export function dec(value: unknown, places = 2): string | null {
  if (value === null || value === undefined) return null;
  return Number(value).toFixed(places);
}

export function dayIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Date(value).toISOString();
}

/** Resuelve una referencia externa dentro de la inmobiliaria; si no existe es un error de la fila. */
export async function resolveRef(
  db: Db,
  model: 'person' | 'property' | 'service' | 'contract',
  ctx: ImportContext,
  externalRef: string,
  field: string,
): Promise<string> {
  const found = await db[model].findFirst({
    where: { tenantId: ctx.tenantId, externalRef },
    select: { id: true },
  });
  if (!found) {
    throw new ImportRowError(
      'REFERENCE_NOT_FOUND',
      `${model[0].toUpperCase()}${model.slice(1)} with externalRef "${externalRef}" not found`,
      field,
    );
  }
  return found.id;
}

/** Claves de `desired` (ignorando `undefined`) cuyo valor difiere del guardado según `same`. */
export function changedKeys<T extends Record<string, unknown>>(
  existing: Record<string, unknown>,
  desired: T,
  same: (key: string, a: unknown, b: unknown) => boolean = (_k, a, b) => a === b,
): string[] {
  return Object.keys(desired).filter(
    (k) => desired[k] !== undefined && !same(k, existing[k] ?? null, desired[k]),
  );
}

/** `externalRef` de una fila sin validar, o null si no trae uno legible. */
export function rawExternalRef(raw: unknown): string | null {
  const v = (raw as { externalRef?: unknown } | null)?.externalRef;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
