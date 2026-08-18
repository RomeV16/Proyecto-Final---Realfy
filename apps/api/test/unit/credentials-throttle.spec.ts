import 'reflect-metadata';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { PortalAuthController } from '../../src/modules/portal-auth/portal-auth.controller';

/**
 * El límite de intentos en los endpoints con credenciales no se puede afirmar
 * por HTTP en las pruebas de extremo a extremo: ahí el throttler está apagado a
 * propósito, porque cada caso abre su propia sesión contra el mismo localhost.
 * Se afirma entonces sobre la metadata que deja @Throttle, que es lo que el
 * guard lee en producción.
 */
const THROTTLER_LIMIT = 'THROTTLER:LIMITdefault';
const THROTTLER_TTL = 'THROTTLER:TTLdefault';

function throttleOf(controller: any, method: string) {
  const handler = controller.prototype[method];
  return {
    limit: Reflect.getMetadata(THROTTLER_LIMIT, handler),
    ttl: Reflect.getMetadata(THROTTLER_TTL, handler),
  };
}

describe('Límite de intentos en los endpoints con credenciales', () => {
  it.each([
    ['ingreso del staff', AuthController, 'login'],
    ['registro', AuthController, 'register'],
    ['ingreso del portal', PortalAuthController, 'login'],
  ])('%s: 5 intentos por minuto', (_label, controller, method) => {
    expect(throttleOf(controller, method)).toEqual({ limit: 5, ttl: 60000 });
  });

  it('el refresh de token no lleva el límite estricto', () => {
    // Renovar la sesión no prueba contraseñas: cae en el límite general.
    expect(throttleOf(AuthController, 'refresh').limit).toBeUndefined();
  });
});
