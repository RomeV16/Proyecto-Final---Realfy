import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEV_SECRET = 'dev-jwt-secret-change-me';

/**
 * Clave con la que se firman y verifican los tokens de acceso.
 *
 * Fuera de producción se admite una clave fija para poder levantar la API sin
 * configurar nada. En producción esa clave es pública (está en el repositorio),
 * así que cualquiera podría firmar un token válido: si falta `JWT_SECRET` la API
 * no arranca.
 */
export function resolveJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET')?.trim();
  if (secret) return secret;

  if (config.get<string>('NODE_ENV') === 'production') {
    throw new Error('JWT_SECRET no está configurado; la API no arranca en producción sin él');
  }

  new Logger('JwtSecret').warn('JWT_SECRET no está configurado; se usa la clave de desarrollo');
  return DEV_SECRET;
}
