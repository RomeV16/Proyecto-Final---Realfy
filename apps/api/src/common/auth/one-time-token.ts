import { createHash, randomBytes } from 'crypto';

/** Bytes aleatorios de cada token (256 bits). */
export const ONE_TIME_TOKEN_BYTES = 32;

/** Las invitaciones viven 7 días; los enlaces de recupero, 1 hora. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface OneTimeToken {
  /** Valor en claro: se entrega una sola vez y no se guarda. */
  token: string;
  /** SHA-256 en hex: lo único que persiste. */
  tokenHash: string;
}

/** SHA-256 en hex del token. Con 256 bits de entropía no hace falta sal ni bcrypt. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Genera un token aleatorio en base64url junto con su hash. */
export function generateOneTimeToken(): OneTimeToken {
  const token = randomBytes(ONE_TIME_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function expiryFromNow(ttlMs: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlMs);
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Arma el enlace público que se comparte con la persona. El middleware de la
 * web agrega el prefijo de idioma.
 */
export function buildWebLink(
  baseUrl: string | undefined,
  path: string,
  token: string,
): string {
  const base = (baseUrl || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

/** `WEB_BASE_URL` y, si falta, el primer origen de `CORS_ORIGINS`. */
export function resolveWebBaseUrl(env: {
  WEB_BASE_URL?: string;
  CORS_ORIGINS?: string;
}): string | undefined {
  return env.WEB_BASE_URL || env.CORS_ORIGINS?.split(',')[0]?.trim() || undefined;
}
