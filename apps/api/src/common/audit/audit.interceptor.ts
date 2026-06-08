import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AuditAction } from '@realfy/shared';

/**
 * Maps HTTP methods to audit actions.
 */
const METHOD_TO_ACTION: Record<string, AuditAction> = {
  POST: AuditAction.CREATE,
  PUT: AuditAction.UPDATE,
  PATCH: AuditAction.UPDATE,
  DELETE: AuditAction.DELETE,
};

/**
 * Fields that must never appear in audit log changes.
 */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  'secret',
]);

/**
 * Redacts sensitive fields from an object before storing in audit log.
 */
function sanitizeChanges(data: any): any {
  if (!data || typeof data !== 'object') return data;

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (REDACTED_FIELDS.has(key)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Derives entity name from the request URL.
 * e.g. /api/tenants/123 → "Tenant", /api/users → "User"
 */
function deriveEntity(url: string): string {
  // Remove /api prefix and query string
  const path = url.replace(/^\/api\//, '').split('?')[0];
  const segment = path.split('/')[0];

  if (!segment) return 'Unknown';

  // Convert plural to singular, capitalize
  const singular = segment.endsWith('s') ? segment.slice(0, -1) : segment;
  return singular.charAt(0).toUpperCase() + singular.slice(1);
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;

    // Only audit mutation methods
    if (!METHOD_TO_ACTION[method]) {
      return next.handle();
    }

    const action = METHOD_TO_ACTION[method];
    const entity = deriveEntity(request.url);
    const changes = sanitizeChanges(request.body);
    const ipAddress = this.tenantContext.getIpAddress();
    const userAgent = request.headers['user-agent'] || null;

    return next.handle().pipe(
      tap((responseBody) => {
        const tenantId = this.tenantContext.getTenantId();
        const userId = this.tenantContext.getUserId();

        // Skip audit if no tenant context (e.g. registration, login)
        if (!tenantId) return;

        // Derive entityId from response body or URL params
        const entityId =
          responseBody?.id ||
          request.params?.id ||
          null;

        // Fire-and-forget — don't block the response
        this.prisma.baseClient.auditLog
          .create({
            data: {
              tenantId,
              userId: userId || null,
              action,
              entity,
              entityId: entityId ? String(entityId) : null,
              changes: changes ?? undefined,
              ipAddress,
              userAgent,
            },
          })
          .catch((err: any) => {
            this.logger.error(
              `Failed to create audit log: entity=${entity} action=${action} error=${err.message}`,
            );
          });
      }),
    );
  }
}
