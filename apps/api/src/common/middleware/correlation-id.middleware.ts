import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { RequestContextService } from '../logger/request-context.service';

/** Se acepta el identificador del cliente solo si es corto y sin caracteres raros. */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Reads x-request-id header or generates a new UUID.
 * Stores it in CLS via RequestContextService and echoes it back in the response.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const correlationId =
      typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming)
        ? incoming
        : randomUUID();

    this.requestContext.setCorrelationId(correlationId);
    res.setHeader('x-request-id', correlationId);

    next();
  }
}

