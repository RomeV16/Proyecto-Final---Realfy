/** Encabezado que la API verifica en los dos ingresos de mail. No hay encabezado de tiempo: la API no lo exige. */
export const SIGNATURE_HEADER = 'X-Realfy-Signature';

const encoder = new TextEncoder();

/**
 * Firma del cuerpo tal como la verifica la API (`verifyMetaSignature`): `sha256=<hex en minúsculas>`,
 * HMAC-SHA256 del cuerpo crudo (UTF-8) con el secreto compartido.
 */
export async function signBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256=${hex}`;
}
