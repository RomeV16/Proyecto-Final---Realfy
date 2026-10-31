import { ConflictException } from '@nestjs/common';

/**
 * Convierte la violación del índice único (tenantId, externalRef) de Prisma
 * (P2002) en el 409 `EXTERNAL_REF_TAKEN`; cualquier otro error se propaga.
 */
export function rethrowExternalRefConflict(err: unknown, entity: string): never {
  const e = err as { code?: string; meta?: { target?: unknown } };
  const target = e?.meta?.target;
  const targets = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  if (e?.code === 'P2002' && targets.some((t) => t.includes('externalRef'))) {
    throw new ConflictException({
      error: 'EXTERNAL_REF_TAKEN',
      message: `Another ${entity} already uses that external reference`,
    });
  }
  throw err;
}
