import { describe, expect, it } from 'vitest';
import es from '@/i18n/messages/es.json';
import en from '@/i18n/messages/en.json';

/** Aplana un árbol de mensajes a rutas separadas por punto. */
function flatten(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return [prefix];
  }
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    flatten(value, prefix ? `${prefix}.${key}` : key),
  );
}

function valueAt(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((n, p) => (n as Record<string, unknown>)[p], tree);
}

describe('CP-72: paridad de claves i18n', () => {
  const esKeys = new Set(flatten(es));
  const enKeys = new Set(flatten(en));

  it('toda clave de es.json existe en en.json', () => {
    const missing = [...esKeys].filter((k) => !enKeys.has(k)).sort();
    expect(missing, `Faltan en en.json:\n${missing.join('\n')}`).toEqual([]);
  });

  it('toda clave de en.json existe en es.json', () => {
    const missing = [...enKeys].filter((k) => !esKeys.has(k)).sort();
    expect(missing, `Faltan en es.json:\n${missing.join('\n')}`).toEqual([]);
  });

  it('no hay valores vacíos en ninguno de los dos idiomas', () => {
    const empties = [
      ...[...esKeys].filter((k) => valueAt(es, k) === '').map((k) => `es: ${k}`),
      ...[...enKeys].filter((k) => valueAt(en, k) === '').map((k) => `en: ${k}`),
    ];
    expect(empties, `Valores vacíos:\n${empties.join('\n')}`).toEqual([]);
  });
});
