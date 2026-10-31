import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { AUDIT_OPERATION_KEY } from './audit-operation.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { AuditAction } from '@realfy/shared';
import { AuditService, sanitizeChanges } from './audit.service';

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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
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
    const operation = this.reflector.get<string | undefined>(
      AUDIT_OPERATION_KEY,
      context.getHandler(),
    );
    const sanitized = sanitizeChanges(request.body);
    const metadata = operation
      ? { ...(isPlainObject(sanitized) ? sanitized : {}), operation }
      : isPlainObject(sanitized)
        ? sanitized
        : undefined;
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
        this.audit
          .record(this.prisma.baseClient, {
            tenantId,
            userId: userId || null,
            action,
            entity,
            entityId: entityId ? String(entityId) : null,
            metadata,
            ipAddress,
            userAgent,
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
