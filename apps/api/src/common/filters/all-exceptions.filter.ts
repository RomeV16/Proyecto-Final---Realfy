import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';

/** Prisma error codes we handle explicitly. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';
const PRISMA_NOT_FOUND = 'P2025';

/** Shape returned on every error. */
export interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error?: string;
  errorCode?: string;
  correlationId?: string;
  timestamp: string;
  /** Contexto que agregó el servicio, p. ej. `validTransitions`. */
  [key: string]: unknown;
}

function isPrismaError(err: unknown): err is { code: string; message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as any).code === 'string'
  );
}

/**
 * Códigos del dominio: MAYUSCULAS_CON_GUION_BAJO. Cuando la excepción se
 * construye con un string, Nest rellena `error` con el motivo HTTP ("Not Found"),
 * que no es un código y no debe pisar al genérico.
 */
const DOMAIN_ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Los servicios lanzan `new XException({ error: 'EMAIL_EXISTS', message: '...' })`
 * y el frontend ramifica sobre ese código. El filtro lo respeta en lugar de
 * reemplazarlo por el genérico del status HTTP.
 */
/** Campos del envoltorio: los pone el filtro, no el servicio que lanzó. */
const ENVELOPE_FIELDS = new Set([
  'statusCode',
  'message',
  'error',
  'errorCode',
  'correlationId',
  'timestamp',
]);

/**
 * Varios servicios adjuntan contexto útil al error — `validTransitions` en las
 * máquinas de estado, por ejemplo. El envoltorio se uniforma, pero ese detalle
 * se conserva. Sólo para excepciones HTTP, que son las que el código lanza a
 * propósito: un error inesperado sigue saliendo sin nada adentro.
 */
function domainDetails(exception: unknown): Record<string, unknown> {
  if (!(exception instanceof HttpException)) return {};
  const resp = exception.getResponse();
  if (typeof resp !== 'object' || resp === null) return {};

  return Object.fromEntries(
    Object.entries(resp as Record<string, unknown>).filter(
      ([key]) => !ENVELOPE_FIELDS.has(key),
    ),
  );
}

function domainErrorCode(exception: unknown): string | undefined {
  if (!(exception instanceof HttpException)) return undefined;
  const resp = exception.getResponse();
  if (typeof resp === 'object' && resp !== null && 'error' in resp) {
    const code = (resp as { error?: unknown }).error;
    if (typeof code === 'string' && DOMAIN_ERROR_CODE.test(code)) return code;
  }
  return undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly cls?: ClsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const correlationId =
      (res.getHeader('x-request-id') as string) ||
      (req.headers['x-request-id'] as string) ||
      this.cls?.get?.('correlationId');

    const tenantId = this.cls?.get?.('tenantId');
    const userId = this.cls?.get?.('userId');

    const resolved = this.resolve(exception);
    const { statusCode, message } = resolved;
    const errorCode = domainErrorCode(exception) ?? resolved.errorCode;

    const body: ErrorResponseBody = {
      ...domainDetails(exception),
      statusCode,
      message,
      // `error` es el nombre que ya consumen los clientes; `errorCode` es el de
      // la forma documentada. Se responden los dos con el mismo valor.
      ...(errorCode ? { error: errorCode, errorCode } : {}),
      ...(correlationId ? { correlationId } : {}),
      timestamp: new Date().toISOString(),
    };

    this.logger.error(
      `[${req.method}] ${req.url} → ${statusCode} | correlationId=${correlationId} tenantId=${tenantId} userId=${userId} | ${JSON.stringify(message)}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    res.status(statusCode).json(body);
  }

  private resolve(exception: unknown): {
    statusCode: number;
    message: string | string[];
    errorCode?: string;
  } {
    // --- class-validator / NestJS HttpExceptions ---
    if (exception instanceof BadRequestException) {
      const resp = exception.getResponse() as any;
      const message =
        typeof resp === 'object' && resp !== null && Array.isArray(resp.message)
          ? (resp.message as string[])
          : exception.message;
      return { statusCode: HttpStatus.BAD_REQUEST, message, errorCode: 'VALIDATION_ERROR' };
    }

    if (exception instanceof UnauthorizedException) {
      return { statusCode: HttpStatus.UNAUTHORIZED, message: exception.message, errorCode: 'UNAUTHORIZED' };
    }

    if (exception instanceof ForbiddenException) {
      return { statusCode: HttpStatus.FORBIDDEN, message: exception.message, errorCode: 'FORBIDDEN' };
    }

    if (exception instanceof NotFoundException) {
      return { statusCode: HttpStatus.NOT_FOUND, message: exception.message, errorCode: 'NOT_FOUND' };
    }

    if (exception instanceof HttpException) {
      const resp = exception.getResponse();
      const message =
        typeof resp === 'object' && resp !== null && 'message' in resp
          ? (resp as any).message
          : exception.message;
      return { statusCode: exception.getStatus(), message };
    }

    // --- Prisma errors ---
    if (isPrismaError(exception)) {
      if (exception.code === PRISMA_UNIQUE_VIOLATION) {
        return { statusCode: HttpStatus.CONFLICT, message: 'Resource already exists.', errorCode: 'CONFLICT' };
      }
      if (exception.code === PRISMA_NOT_FOUND) {
        return { statusCode: HttpStatus.NOT_FOUND, message: 'Resource not found.', errorCode: 'NOT_FOUND' };
      }
    }

    // --- Unknown / internal errors — never leak stack or internal details ---
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred. Please try again later.',
      errorCode: 'INTERNAL_ERROR',
    };
  }
}
