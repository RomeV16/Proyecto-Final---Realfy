import type { Prisma } from '@prisma/client';
import type { UserRole } from '@realfy/shared';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Usuarios activos de una inmobiliaria con alguno de los roles dados.
 * Los procesos programados lo usan para elegir destinatarios en lugar de
 * escribir el filtro de roles en cada lugar.
 */
export function findStaff<S extends Prisma.UserSelect>(
  prisma: Pick<PrismaService, 'baseClient'>,
  tenantId: string,
  roles: readonly UserRole[],
  select: S,
): Promise<Array<Prisma.UserGetPayload<{ select: S }>>> {
  return prisma.baseClient.user.findMany({
    where: { tenantId, isActive: true, role: { in: [...roles] } },
    select,
  }) as Promise<Array<Prisma.UserGetPayload<{ select: S }>>>;
}
