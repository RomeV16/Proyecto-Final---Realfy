import { describe, expect, it } from 'vitest';
import es from '@/i18n/messages/es.json';
import en from '@/i18n/messages/en.json';

/** Textos de todo el árbol de mensajes. */
function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node === null || typeof node !== 'object') return [];
  return Object.values(node as Record<string, unknown>).flatMap(texts);
}

/**
 * El producto no se integra con portales externos de publicación: la ficha se
 * copia y se publica a mano. Ningún texto de la interfaz debe prometer lo contrario.
 */
describe('textos sin integración inexistente con portales', () => {
  const claims = /zonaprop|mercado\s?libre|argenprop|publicar directamente/i;

  for (const [locale, messages] of [['es', es], ['en', en]] as const) {
    it(`${locale}: ningún mensaje promete publicar en portales externos`, () => {
      expect(texts(messages).filter((text) => claims.test(text))).toEqual([]);
    });
  }
});
