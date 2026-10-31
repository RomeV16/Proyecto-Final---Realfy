import type { ReadResource } from '@realfy/shared';

/** Campos de la respuesta que protege cada recurso enmascarable. */
export const MASKED_FIELDS: Partial<Record<ReadResource, readonly string[]>> = {
  'persons.document': ['dni', 'cuit'],
  'persons.bankAccounts': ['cbu', 'bankAlias', 'bankName', 'bankAccounts'],
  'contracts.commission': ['commission'],
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Devuelve una copia de la respuesta con los campos dados en null, a cualquier
 * profundidad. Fechas, decimales y demás instancias no se recorren.
 */
export function maskFields<T>(value: T, fields: ReadonlySet<string>): T {
  if (Array.isArray(value)) {
    return value.map((item) => maskFields(item, fields)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = fields.has(key) ? null : maskFields(v, fields);
    }
    return out as T;
  }
  return value;
}

export function fieldsToMask(resources: readonly ReadResource[]): Set<string> {
  const set = new Set<string>();
  for (const r of resources) for (const f of MASKED_FIELDS[r] ?? []) set.add(f);
  return set;
}
