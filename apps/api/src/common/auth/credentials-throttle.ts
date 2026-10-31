/**
 * Límite propio para los endpoints con credenciales o tokens de un solo uso:
 * 5 intentos por minuto. El límite general del ThrottlerModule es mucho más
 * alto porque el tráfico del frontend llega por el proxy con una IP compartida.
 */
export const CREDENTIALS_THROTTLE = { default: { ttl: 60000, limit: 5 } };
