import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveJwtSecret } from '../../src/common/auth/jwt-secret';

const config = (env: Record<string, string | undefined>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

describe('clave de firma de los tokens', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('usa JWT_SECRET cuando está configurado', () => {
    expect(resolveJwtSecret(config({ JWT_SECRET: 'clave-real', NODE_ENV: 'production' }))).toBe(
      'clave-real',
    );
  });

  it('no arranca en producción sin JWT_SECRET', () => {
    expect(() => resolveJwtSecret(config({ NODE_ENV: 'production' }))).toThrow(/JWT_SECRET/);
  });

  it('trata una clave en blanco como ausente', () => {
    expect(() => resolveJwtSecret(config({ JWT_SECRET: '   ', NODE_ENV: 'production' }))).toThrow(
      /JWT_SECRET/,
    );
  });

  it('fuera de producción usa la clave de desarrollo y lo avisa', () => {
    const secret = resolveJwtSecret(config({ NODE_ENV: 'development' }));
    expect(secret).toBe('dev-jwt-secret-change-me');
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });
});
