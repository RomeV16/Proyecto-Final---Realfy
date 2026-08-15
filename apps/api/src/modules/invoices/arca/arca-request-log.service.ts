import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

export interface ArcaRequestLogOptions {
  tenantId: string;
  issuerId?: string;
  operation: string;
  issuerCuit?: string;
  comprobanteId?: string;
  requestPayload?: Record<string, unknown>;
}

export interface ArcaRequestLogResult {
  success: boolean;
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
  latencyMs: number;
}

/**
 * Regex patterns for fields to scrub from logged payloads.
 * Token/Sign from WSAA must never appear in logs.
 */
const SCRUB_KEYS = new Set(['Token', 'Sign', 'token', 'sign']);

/**
 * Recursively scrub sensitive keys from a JSON-serialisable object.
 */
function scrubPayload(obj: unknown, depth = 0): unknown {
  if (depth > 20 || obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => scrubPayload(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = SCRUB_KEYS.has(k) ? '[REDACTED]' : scrubPayload(v, depth + 1);
  }
  return result;
}

/**
 * ArcaRequestLogService — wraps every AFIP call to record ArcaRequestLog rows.
 *
 * Usage:
 *   const result = await logService.wrap(opts, () => afip.ElectronicBilling.createVoucher(data));
 *
 * On success, `result.data` contains the AFIP response.
 * On failure, re-throws the error after persisting the log row.
 */
@Injectable()
export class ArcaRequestLogService {
  private readonly logger = new Logger(ArcaRequestLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Execute `fn`, record a log row regardless of outcome, and return the result.
   * Throws if `fn` throws (log row records the error).
   */
  async wrap<T>(
    opts: ArcaRequestLogOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    let success = false;
    let data: T | undefined;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    let responsePayload: unknown;

    try {
      data = await fn();
      success = true;
      responsePayload = data;
    } catch (err: any) {
      errorCode = err?.code ?? err?.name ?? 'UNKNOWN';
      errorMessage = err?.message ?? String(err);
      responsePayload = { error: errorMessage, code: errorCode };
    }

    const latencyMs = Date.now() - start;

    const scrubbedRequest = opts.requestPayload
      ? scrubPayload(opts.requestPayload)
      : undefined;
    const scrubbedResponse = scrubPayload(responsePayload);

    try {
      await this.prisma.client.arcaRequestLog.create({
        data: {
          tenantId: opts.tenantId,
          issuerId: opts.issuerId ?? null,
          operation: opts.operation,
          issuerCuit: opts.issuerCuit ?? null,
          requestPayload: scrubbedRequest as any,
          responsePayload: scrubbedResponse as any,
          latencyMs,
          success,
          errorCode: errorCode ?? null,
          errorMessage: errorMessage ?? null,
          comprobanteId: opts.comprobanteId ?? null,
        },
      });
    } catch (logErr) {
      // Logging failure should not block the caller
      this.logger.warn('Failed to persist ArcaRequestLog', { logErr });
    }

    if (!success) {
      const err: any = new Error(errorMessage ?? 'AFIP call failed');
      err.code = errorCode;
      throw err;
    }

    return data as T;
  }

  /**
   * Update an existing log row to attach a comprobanteId after persistence.
   */
  async attachComprobanteId(logId: string, comprobanteId: string): Promise<void> {
    try {
      await this.prisma.client.arcaRequestLog.update({
        where: { id: logId },
        data: { comprobanteId },
      });
    } catch {
      // Best-effort
    }
  }
}
