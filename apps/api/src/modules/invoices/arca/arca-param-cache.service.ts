import { Injectable, Logger } from '@nestjs/common';
import { ArcaClientFactory } from './arca-client.factory';

/**
 * Available param types that can be fetched from AFIP.
 */
export type ParamType =
  | 'salesPoints'           // FEParamGetPtosVenta — per-CUIT
  | 'voucherTypes'          // FEParamGetTiposCbte — global
  | 'documentTypes'         // FEParamGetTiposDoc  — global
  | 'aliquotTypes'          // FEParamGetTiposIva  — global
  | 'conceptTypes'          // FEParamGetTiposConcepto — global
  | 'condicionIvaReceptor'; // FEParamGetCondicionIvaReceptor — global

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T = unknown> {
  data: T;
  fetchedAt: number;
}

/**
 * ArcaParamCacheService — in-memory cache for AFIP parameter endpoints.
 *
 * Cache key: `${tenantId}:${issuerCuit}:${type}`.
 * TTL: 24h for all entries.
 * Per-CUIT scoping for salesPoints (PdV lists); other types are global per tenant.
 */
@Injectable()
export class ArcaParamCacheService {
  private readonly logger = new Logger(ArcaParamCacheService.name);
  private readonly store = new Map<string, CacheEntry>();

  constructor(private readonly clientFactory: ArcaClientFactory) {}

  /**
   * Get (or fetch) parameter data.
   *
   * @param type     Which AFIP parameter endpoint to query
   * @param tenantId Agency tenant
   * @param issuerId ArcaIssuer (used to get correct client + CUIT scope for salesPoints)
   * @param issuerCuit  The CUIT string, used as part of cache key
   * @param force    If true, bypass cache and re-fetch
   */
  async get<T = unknown>(
    type: ParamType,
    tenantId: string,
    issuerId: string,
    issuerCuit: string,
    force = false,
  ): Promise<T> {
    const key = `${tenantId}:${issuerCuit}:${type}`;
    const now = Date.now();

    if (!force) {
      const cached = this.store.get(key);
      if (cached && now - cached.fetchedAt < TTL_MS) {
        return cached.data as T;
      }
    }

    const { afip } = await this.clientFactory.getClient(
      tenantId,
      issuerId,
      'system:param-cache',
    );

    const eb = afip.ElectronicBilling;
    let data: unknown;

    switch (type) {
      case 'salesPoints':
        data = await eb.getSalesPoints();
        break;
      case 'voucherTypes':
        data = await eb.getVoucherTypes();
        break;
      case 'documentTypes':
        data = await eb.getDocumentTypes();
        break;
      case 'aliquotTypes':
        data = await eb.getAliquotTypes();
        break;
      case 'conceptTypes':
        data = await eb.getConceptTypes();
        break;
      case 'condicionIvaReceptor':
        if (typeof eb.getCondicionIvaReceptor === 'function') {
          data = await eb.getCondicionIvaReceptor();
        } else {
          // Fallback for mock environments that don't implement this
          data = [];
        }
        break;
      default:
        throw new Error(`Unknown param type: ${type as string}`);
    }

    this.store.set(key, { data, fetchedAt: now });
    this.logger.debug('Param cache refreshed', { type, tenantId, issuerCuit });

    return data as T;
  }

  /**
   * Invalidate a specific cache entry.
   */
  invalidate(type: ParamType, tenantId: string, issuerCuit: string): void {
    const key = `${tenantId}:${issuerCuit}:${type}`;
    this.store.delete(key);
    this.logger.debug('Param cache invalidated', { key });
  }

  /**
   * Invalidate all cache entries for a tenant.
   */
  invalidateAll(tenantId: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.store.delete(key);
      }
    }
  }
}
