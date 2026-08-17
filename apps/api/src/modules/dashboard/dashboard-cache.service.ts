import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

interface CacheEntry {
  value: any;
  expiresAt: number;
}

const TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Per-tenant in-memory cache for dashboard aggregation methods.
 *
 * Cache key format: `${tenantId}:${methodName}:${argsHash}`
 * Multi-tenant isolation is guaranteed because tenantId is always the first
 * segment of the key — values can never leak across tenants.
 *
 * EventEmitter integration note:
 * @nestjs/event-emitter is not yet installed in this codebase.
 * TODO: install `@nestjs/event-emitter`, register `EventEmitterModule.forRoot()`
 * in AppModule, then add @OnEvent listeners below for:
 *   - 'liquidacion.paid'        → bust(tenantId)
 *   - 'liquidacion.generated'   → bust(tenantId)
 *   - 'payment.recorded'        → bust(tenantId)
 *   - 'penalty.applied'         → bust(tenantId)
 *   - 'penalty.waived'          → bust(tenantId)
 *   - 'property.state_changed'  → bust(tenantId)
 * Example stub (uncomment once event-emitter is wired):
 *
 *   @OnEvent('liquidacion.paid')
 *   handleLiquidacionPaid(payload: { tenantId: string }) {
 *     this.bust(payload.tenantId);
 *   }
 */
@Injectable()
export class DashboardCacheService {
  private readonly logger = new Logger(DashboardCacheService.name);
  private readonly store = new Map<string, CacheEntry>();

  private makeKey(tenantId: string, methodName: string, args: unknown[]): string {
    const argsHash = crypto
      .createHash('sha1')
      .update(JSON.stringify(args))
      .digest('hex')
      .slice(0, 8);
    return `${tenantId}:${methodName}:${argsHash}`;
  }

  get<T>(tenantId: string, methodName: string, args: unknown[]): T | undefined {
    const key = this.makeKey(tenantId, methodName, args);
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(tenantId: string, methodName: string, args: unknown[], value: unknown): void {
    const key = this.makeKey(tenantId, methodName, args);
    this.store.set(key, { value, expiresAt: Date.now() + TTL_MS });
  }

  /**
   * Bust cache entries for a tenant.
   * @param tenantId  - The tenant whose cache to invalidate.
   * @param methodName - Optional: if provided, only bust entries for that method;
   *                     if omitted, bust ALL entries for the tenant.
   */
  bust(tenantId: string, methodName?: string): void {
    const prefix = methodName
      ? `${tenantId}:${methodName}:`
      : `${tenantId}:`;

    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    this.logger.debug(
      `Cache busted: tenantId=${tenantId} method=${methodName ?? '*'} entries=${count}`,
    );
  }
}
