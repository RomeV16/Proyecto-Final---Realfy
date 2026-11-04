import { describe, expect, it } from 'vitest';
import { TEMPLATE_LIST_NAMES } from '@realfy/shared';
import es from '@/i18n/messages/es.json';
import en from '@/i18n/messages/en.json';
import { catalogMessageKeys, listBlock, personFieldsFor, variableMessageKey } from './contract-template-catalog';

function lookup(messages: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], messages);
}

describe('catálogo de variables de plantillas (textos)', () => {
  const keys = catalogMessageKeys();

  it('cada entrada del catálogo de shared tiene su descripción en es', () => {
    const missing = keys.filter((k) => typeof lookup(es.contractTemplates.catalog, k) !== 'string');
    expect(missing).toEqual([]);
  });

  it('y en en, y en en no quedan en castellano las mismas frases', () => {
    const missing = keys.filter((k) => typeof lookup(en.contractTemplates.catalog, k) !== 'string');
    expect(missing).toEqual([]);
    expect(lookup(en.contractTemplates.catalog, 'vars.contrato_monto')).not.toBe(lookup(es.contractTemplates.catalog, 'vars.contrato_monto'));
  });

  it('las claves no se repiten ni quedan textos de más', () => {
    expect(new Set(keys).size).toBe(keys.length);
    const count = (node: unknown): number =>
      typeof node === 'string' ? 1 : Object.values(node as object).reduce<number>((n, v) => n + count(v), 0);
    const fixed = ['title', 'intro', 'insert', 'variablesTitle', 'personsTitle', 'personsHint', 'listsTitle', 'listsHint', 'insertBlock', 'loopTitle', 'blocksTitle', 'formatTitle', 'formatBold', 'formatHeading'];
    expect(count(es.contractTemplates.catalog)).toBe(keys.length + fixed.length);
  });

  it('variableMessageKey cambia los puntos por guiones bajos', () => {
    expect(variableMessageKey('contrato.montoEnLetras')).toBe('contrato_montoEnLetras');
  });

  it('los locadores suman capacidad y porcentaje a los datos de una persona', () => {
    expect(personFieldsFor('locador')).toContain('porcentaje');
    expect(personFieldsFor('propietario')).toContain('capacidad');
    expect(personFieldsFor('inquilino')).not.toContain('porcentaje');
  });

  it('el bloque de cada lista usa un campo que la lista tiene', () => {
    for (const list of TEMPLATE_LIST_NAMES) {
      expect(listBlock(list)).toMatch(new RegExp(`^\\{\\{#cada ${list}\\}\\}\\n\\{\\{item\\.\\w+\\}\\}\\n\\{\\{/cada\\}\\}\\n$`));
    }
  });
});
