/**
 * Identificador bajo el que el scraper guarda los índices publicados por el
 * BCRA y el INDEC. Son datos públicos, iguales para todas las inmobiliarias:
 * cada una los ve junto con sus propias cargas manuales, y la carga manual
 * tiene prioridad para el mismo tipo y período (DEF-01).
 */
export const SYSTEM_TENANT_ID = '__system__';

/** Modelos con filas de sistema que cada inmobiliaria lee junto con las propias. */
export const SYSTEM_SHARED_MODELS: ReadonlySet<string> = new Set(['IndexData']);
