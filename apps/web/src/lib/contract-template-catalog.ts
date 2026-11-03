import {
  TEMPLATE_BLOCKS,
  TEMPLATE_LIST_NAMES,
  TEMPLATE_LISTS,
  TEMPLATE_LIST_SUMMARIES,
  TEMPLATE_LOOP_FIELDS,
  TEMPLATE_PERSON_FIELDS,
  TEMPLATE_PERSON_PREFIXES,
  TEMPLATE_VARIABLE_GROUPS,
  type TemplateListName,
} from '@realfy/shared';

type Prefix = (typeof TEMPLATE_PERSON_PREFIXES)[number];

/** Clave del texto de una variable suelta: `contrato.monto` -> `contrato_monto` (el punto separa niveles en los textos). */
export function variableMessageKey(name: string): string {
  return name.replaceAll('.', '_');
}

/** Campos de una persona según el prefijo: los locadores suman su capacidad y porcentaje de cobro. */
export function personFieldsFor(prefix: Prefix): readonly string[] {
  return prefix === 'locador' || prefix === 'propietario'
    ? [...TEMPLATE_PERSON_FIELDS, 'capacidad', 'porcentaje']
    : TEMPLATE_PERSON_FIELDS;
}

/** Texto que se inserta para recorrer una lista. */
export function listBlock(list: TemplateListName): string {
  const field = TEMPLATE_LISTS[list].includes('nombreCompleto') ? 'nombreCompleto' : TEMPLATE_LISTS[list][0];
  return `{{#cada ${list}}}\n{{item.${field}}}\n{{/cada}}\n`;
}

/**
 * Todas las claves de texto (bajo `contractTemplates.catalog`) que el catálogo de la
 * pantalla necesita. La prueba de paridad las busca en es y en en: una variable
 * nueva en shared sin descripción hace fallar la prueba.
 */
export function catalogMessageKeys(): string[] {
  const keys: string[] = [];
  for (const group of TEMPLATE_VARIABLE_GROUPS) {
    keys.push(`groups.${group.id}`);
    for (const name of group.variables) keys.push(`vars.${variableMessageKey(name)}`);
  }
  for (const prefix of TEMPLATE_PERSON_PREFIXES) {
    keys.push(`prefixes.${prefix}`);
    for (const field of personFieldsFor(prefix)) keys.push(`fields.${field}`);
  }
  for (const list of TEMPLATE_LIST_NAMES) {
    keys.push(`lists.${list}`);
    for (const field of TEMPLATE_LISTS[list]) keys.push(`fields.${field}`);
  }
  for (const field of TEMPLATE_LOOP_FIELDS) keys.push(`loop.${field}`);
  for (const summary of TEMPLATE_LIST_SUMMARIES) keys.push(`summaries.${summary}`);
  for (const block of TEMPLATE_BLOCKS) keys.push(`blocks.${block.id}.title`, `blocks.${block.id}.description`);
  return Array.from(new Set(keys)).sort((a, b) => a.localeCompare(b));
}
