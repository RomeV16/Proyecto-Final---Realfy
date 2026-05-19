import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { TenantContextService } from './tenant-context.service';

/**
 * Extracts tenant context from the request.
 *
 * At this stage in the middleware chain, the JWT has NOT been validated yet
 * (Passport guards run later). This middleware only stores the IP address.
 * The JWT guard + strategy will call TenantContextService.setTenantId/setUserId/setUserRole
 * after token validation.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(req: Request, _res: Response, next: NextFunction) {
    // Store IP address — available before auth
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'unknown';
    this.tenantContext.setIpAddress(ip);

    next();
  }
}
