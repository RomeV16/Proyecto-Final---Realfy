import type { PrismaService } from '../../common/prisma/prisma.service';
import { findStaff } from '../../common/auth/find-staff';
import { MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import type { NotificationsService } from '../notifications/notifications.service';

export interface ManagementNotice {
  type: string;
  title: string;
  message: string;
  entityType: string;
  /** También es la clave que evita repetir el aviso dentro de las 24 horas. */
  entityId: string;
}

/** Aviso en la bandeja de notificaciones de Admin y Gerente de una inmobiliaria. */
export async function notifyManagement(
  prisma: PrismaService,
  notifications: NotificationsService,
  tenantId: string,
  notice: ManagementNotice,
): Promise<void> {
  const users = await findStaff(prisma, tenantId, MANAGEMENT_ROLES, { id: true });
  for (const user of users) {
    await notifications.createNotification({ tenantId, userId: user.id, ...notice });
  }
}
