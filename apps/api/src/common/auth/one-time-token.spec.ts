import {
  buildWebLink,
  expiryFromNow,
  generateOneTimeToken,
  hashToken,
  INVITATION_TTL_MS,
  isExpired,
  ONE_TIME_TOKEN_BYTES,
  PASSWORD_RESET_TTL_MS,
  resolveWebBaseUrl,
} from './one-time-token';

describe('one-time-token', () => {
  it('genera al menos 32 bytes aleatorios y no repite', () => {
    const a = generateOneTimeToken();
    const b = generateOneTimeToken();
    expect(Buffer.from(a.token, 'base64url').length).toBeGreaterThanOrEqual(
      ONE_TIME_TOKEN_BYTES,
    );
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('guarda el hash, nunca el token en claro', () => {
    const { token, tokenHash } = generateOneTimeToken();
    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).not.toContain(token);
    expect(hashToken(token)).toBe(tokenHash);
    expect(hashToken(token + 'x')).not.toBe(tokenHash);
  });

  it('calcula el vencimiento y lo detecta', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const inv = expiryFromNow(INVITATION_TTL_MS, now);
    const reset = expiryFromNow(PASSWORD_RESET_TTL_MS, now);
    expect(inv.toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(reset.toISOString()).toBe('2026-01-01T01:00:00.000Z');
    expect(isExpired(reset, new Date('2026-01-01T00:59:59Z'))).toBe(false);
    expect(isExpired(reset, new Date('2026-01-01T01:00:00Z'))).toBe(true);
  });

  it('arma el enlace con la URL base', () => {
    expect(buildWebLink('https://app.example.com/', '/auth/x', 'a+b')).toBe(
      'https://app.example.com/auth/x?token=a%2Bb',
    );
    expect(buildWebLink(undefined, '/auth/x', 't')).toBe(
      'http://localhost:3000/auth/x?token=t',
    );
  });

  it('resuelve la URL base desde WEB_BASE_URL o CORS_ORIGINS', () => {
    expect(
      resolveWebBaseUrl({ WEB_BASE_URL: 'https://w', CORS_ORIGINS: 'https://c' }),
    ).toBe('https://w');
    expect(resolveWebBaseUrl({ CORS_ORIGINS: 'https://c1, https://c2' })).toBe(
      'https://c1',
    );
    expect(resolveWebBaseUrl({})).toBeUndefined();
  });
});
