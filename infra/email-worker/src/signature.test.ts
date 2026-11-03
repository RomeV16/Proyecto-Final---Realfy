import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// La verificación real de la API: la firma del Worker tiene que pasar por esta misma función.
import { verifyMetaSignature } from '../../../apps/api/src/modules/messaging/webhook-signatures';
import { SIGNATURE_HEADER, signBody } from './signature';

describe('signBody', () => {
  it('CP-1413: usa el encabezado que lee la API', () => {
    expect(SIGNATURE_HEADER.toLowerCase()).toBe('x-realfy-signature');
  });

  it('CP-1413: da el vector fijo (HMAC-SHA256, sha256=<hex>)', async () => {
    // Vector de RFC 4231 (caso de prueba 2): clave "Jefe".
    expect(await signBody('Jefe', 'what do ya want for nothing?')).toBe(
      'sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('CP-1413: coincide con createHmac y con la verificación de la API, también con acentos', async () => {
    const body = JSON.stringify({ messageId: '<a@b>', text: 'Hola, ¿cómo andás? ñandú 😀' });
    const header = await signBody('secreto-de-prueba', body);
    expect(header).toBe(`sha256=${createHmac('sha256', 'secreto-de-prueba').update(body).digest('hex')}`);
    expect(verifyMetaSignature(Buffer.from(body, 'utf8'), header, 'secreto-de-prueba')).toBe(true);
  });

  it('CP-1414: la API rechaza un cuerpo alterado o otro secreto', async () => {
    const header = await signBody('secreto-de-prueba', '{"a":1}');
    expect(verifyMetaSignature(Buffer.from('{"a":2}'), header, 'secreto-de-prueba')).toBe(false);
    expect(verifyMetaSignature(Buffer.from('{"a":1}'), header, 'otro-secreto')).toBe(false);
  });
});
