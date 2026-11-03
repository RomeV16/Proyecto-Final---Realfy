import { createHmac, timingSafeEqual } from 'node:crypto';

/** Comparación en tiempo constante de dos textos (firmas, tokens). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Firma de Meta: `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 del cuerpo
 * crudo con el secreto de la app.
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads
 */
export function verifyMetaSignature(rawBody: Buffer | undefined, header: string | undefined, appSecret: string | undefined): boolean {
  if (!rawBody || !header || !appSecret) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(header.trim().toLowerCase(), expected);
}

/** Tolerancia del reloj para las firmas de Resend (svix). */
export const SVIX_TOLERANCE_SECONDS = 5 * 60;

/**
 * Firma de Resend (svix): HMAC-SHA256 de `${svix-id}.${svix-timestamp}.${cuerpo}`
 * con el secreto `whsec_<base64>`, en base64; el encabezado `svix-signature`
 * trae una o más firmas `v1,<base64>` separadas por espacios. Un timestamp a
 * más de cinco minutos se rechaza (reenvío de un pedido viejo).
 * https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
 */
export function verifySvixSignature(
  rawBody: Buffer | undefined,
  headers: { id?: string; timestamp?: string; signature?: string },
  secret: string | undefined,
  now: Date = new Date(),
): boolean {
  if (!rawBody || !headers.id || !headers.timestamp || !headers.signature || !secret) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > SVIX_TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64');
  const expected = createHmac('sha256', key)
    .update(`${headers.id}.${headers.timestamp}.`)
    .update(rawBody)
    .digest('base64');
  return headers.signature
    .split(' ')
    .map((part) => part.split(','))
    .some(([version, sig]) => version === 'v1' && sig !== undefined && safeEqual(sig, expected));
}
