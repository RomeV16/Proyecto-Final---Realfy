import { SetMetadata } from '@nestjs/common';

export const AUDIT_OPERATION_KEY = 'auditOperation';

/**
 * Nombra la operación en la bitácora cuando el método HTTP no alcanza para
 * distinguirla (por ejemplo, un POST que da de baja a un usuario).
 */
export const AuditOperation = (operation: string) =>
  SetMetadata(AUDIT_OPERATION_KEY, operation);
