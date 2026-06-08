import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

const CLS_CORRELATION_ID = 'correlationId';

/**
 * Stores per-request context (correlationId, tenantId, userId) in CLS.
 * correlationId is populated by CorrelationIdMiddleware.
 * tenantId + userId are already managed by TenantContextService via JwtStrategy.
 */
@Injectable()
export class RequestContextService {
  constructor(private readonly cls: ClsService) {}

  getCorrelationId(): string | undefined {
    return this.cls.get(CLS_CORRELATION_ID);
  }

  setCorrelationId(id: string): void {
    this.cls.set(CLS_CORRELATION_ID, id);
  }
}
