import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditAction } from '@realfy/shared';
import { TenantContextService } from '../tenant/tenant-context.service';

/**
 * Campos que nunca deben quedar en el registro de auditoría.
 */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  'currentPassword',
  'newPassword',
  'secret',
]);

/** Tapa los campos sensibles, también dentro de objetos y listas anidadas. */
export function sanitizeChanges<T>(data: T): T {
  if (Array.isArray(data)) return data.map(sanitizeChanges) as unknown as T;
  if (!data || typeof data !== 'object' || data instanceof Date) return data;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    sanitized[key] = REDACTED_FIELDS.has(key) ? '[REDACTED]' : sanitizeChanges(value);
  }
  return sanitized as T;
}

/** Lo mínimo que `record` necesita de un cliente o de una transacción de Prisma. */
export interface AuditTx {
  auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): PromiseLike<unknown> };
}

export interface AuditRecordInput {
  action: AuditAction | `${AuditAction}`;
  entity: string;
  entityId?: string | null;
  /** Estado previo de lo que cambió. */
  before?: unknown;
  /** Estado posterior. */
  after?: unknown;
  /** Quién lo hizo; por defecto el usuario del contexto, o ninguno en un proceso programado. */
  userId?: string | null;
  /** Datos sueltos (origen, motivo, operación) que se guardan junto al resto, en el nivel superior. */
  metadata?: Record<string, unknown>;
  /** Por defecto, la inmobiliaria del contexto. */
  tenantId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Único lugar donde se escribe una fila de auditoría. Lo usa el interceptor
 * para los pedidos HTTP y lo usan los puntos explícitos que no pasan por un
 * pedido: procesos programados, ajustes y condonaciones. Recibe el cliente o
 * la transacción en la que corre, para que la fila entre o no con el cambio
 * que describe.
 */
@Injectable()
export class AuditService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async record(tx: AuditTx, input: AuditRecordInput): Promise<void> {
    const tenantId = input.tenantId ?? this.tenantContext.getTenantId();
    if (!tenantId) {
      throw new Error(
        `Audit record for ${input.entity} has no tenant: pass tenantId or run inside a tenant context`,
      );
    }

    const changes: Record<string, unknown> = { ...(input.metadata ?? {}) };
    if (input.before !== undefined) changes.before = input.before;
    if (input.after !== undefined) changes.after = input.after;
    const hasChanges = Object.keys(changes).length > 0;

    await tx.auditLog.create({
      data: {
        tenantId,
        userId: input.userId === undefined ? (this.tenantContext.getUserId() ?? null) : input.userId,
        action: input.action as AuditAction,
        entity: input.entity,
        entityId: input.entityId ? String(input.entityId) : null,
        changes: hasChanges ? (sanitizeChanges(changes) as Prisma.InputJsonValue) : undefined,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }
}
