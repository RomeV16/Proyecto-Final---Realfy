import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { RequestContextService } from '../logger/request-context.service';

/**
 * Reads x-request-id header or generates a new UUID.
 * Stores it in CLS via RequestContextService and echoes it back in the response.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId =
      (req.headers['x-request-id'] as string) || randomUUID();

    this.requestContext.setCorrelationId(correlationId);
    res.setHeader('x-request-id', correlationId);

    next();
  }
}

/**
 * Functional middleware version for use in main.ts before NestJS DI is available.
 * Note: this version cannot access CLS; registration via app.use() is only for
 * the header echo. The DI-aware version (above) runs inside the Nest middleware chain.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const existing = req.headers['x-request-id'] as string | undefined;
  if (!existing) {
    req.headers['x-request-id'] = randomUUID();
  }
  next();
}
