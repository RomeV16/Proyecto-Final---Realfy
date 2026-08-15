import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { WsaaService } from './wsaa/wsaa.service';
import { Wsfev1Client } from './wsfev1-client';

/**
 * ElectronicBilling-compatible binding shape.
 * Matches the subset of AfipSDK's ElectronicBilling API that our code uses.
 */
export interface ElectronicBillingBinding {
  getServerStatus(): Promise<{ AppServer: string; DbServer: string; AuthServer: string }>;
  getLastVoucher(ptoVta: number, cbteTipo: number): Promise<number>;
  createVoucher(data: Record<string, unknown>): Promise<{ CAE: string; CAEFchVto: string }>;
  getSalesPoints(): Promise<any[]>;
  getVoucherTypes(): Promise<any[]>;
  getDocumentTypes(): Promise<any[]>;
  getAliquotTypes(): Promise<any[]>;
  getConceptTypes(): Promise<any[]>;
  getCondicionIvaReceptor?: () => Promise<any[]>;
}

/**
 * An ArcaClient instance together with the tenantId that owns it.
 * The `afip` property now exposes an ElectronicBillingBinding instead of AfipSDK.
 */
export interface AfipClient {
  afip: {
    ElectronicBilling: ElectronicBillingBinding;
  };
  tenantId: string;
  issuerId: string;
  issuerCuit: string;
  expiresAt: number; // ms epoch
}

/**
 * Cache entry — short TTL since the TA is now managed by WsaaService separately.
 */
interface CacheEntry {
  client: AfipClient;
  lastUsed: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE = 64;

/**
 * ArcaClientFactory — resolves ArcaCertificate + ArcaIssuer for a tenant and
 * returns an ElectronicBilling-compatible binding backed by our own WSFEv1 SOAP client.
 *
 * This replaces the previous AfipSDK-based factory. The public API shape is preserved
 * so all callers (ArcaService, ArcaParamCacheService, ArcaTaManager) continue to work.
 *
 * Note: ARCA_MOCK=1 still uses the mock shim (imported from __mocks__) for test isolation.
 */
@Injectable()
export class ArcaClientFactory {
  private readonly logger = new Logger(ArcaClientFactory.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly wsaa: WsaaService,
    private readonly wsfev1: Wsfev1Client,
  ) {}

  /**
   * Get (or create) a live ElectronicBilling binding for a given (tenantId, issuerId) pair.
   *
   * @param tenantId  The agency tenant
   * @param issuerId  The ArcaIssuer whose CUIT is used for WSFEv1 calls
   * @param actor     Identifier for the access log (e.g. "system:emit")
   */
  async getClient(tenantId: string, issuerId: string, actor: string): Promise<AfipClient> {
    const cacheKey = `${tenantId}:${issuerId}`;
    const now = Date.now();

    const cached = this.cache.get(cacheKey);
    if (cached && now < cached.client.expiresAt) {
      cached.lastUsed = now;
      return cached.client;
    }

    if (cached) {
      this.cache.delete(cacheKey);
    }

    // ── ARCA_MOCK=1 fast-path ─────────────────────────────────────────────────
    if (process.env['ARCA_MOCK'] === '1') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MockAfipConstructor } = require('./__mocks__/afip-mock');
      const mockIssuer = await this.prisma.client.arcaIssuer.findFirst({
        where: { id: issuerId, tenantId },
      });
      const mockCuit = mockIssuer?.cuit ?? '00-00000000-0';
      const mockInstance = new MockAfipConstructor({ CUIT: mockCuit, production: false });
      const mockClient: AfipClient = {
        afip: mockInstance,
        tenantId,
        issuerId,
        issuerCuit: mockCuit,
        expiresAt: now + TTL_MS,
      };
      this.cache.set(cacheKey, { client: mockClient, lastUsed: now });
      this.logger.debug('Mock client created (ARCA_MOCK=1)', { tenantId, issuerId, mockCuit });
      return mockClient;
    }

    // Load ArcaCertificate
    const cert = await this.prisma.client.arcaCertificate.findFirst({
      where: { tenantId },
    });

    if (!cert || !cert.isActive) {
      throw new NotFoundException(`No active ArcaCertificate found for tenant ${tenantId}`);
    }

    // Load ArcaIssuer
    const issuer = await this.prisma.client.arcaIssuer.findFirst({
      where: { id: issuerId, tenantId },
    });

    if (!issuer) {
      throw new NotFoundException(`ArcaIssuer ${issuerId} not found for tenant ${tenantId}`);
    }

    // Write access log (non-fatal)
    try {
      await this.prisma.client.arcaCertificateAccessLog.create({
        data: {
          tenantId,
          certificateId: cert.id,
          actor,
          reason: `arca-client-factory:getClient:issuerId=${issuerId}`,
        },
      });
    } catch (logErr) {
      this.logger.warn('Failed to write ArcaCertificateAccessLog', { logErr });
    }

    // Get TA from WsaaService (single-flight, cached ~10h, signed with agency cert)
    const ta = await this.wsaa.getTa(tenantId, 'wsfe');

    // Build ElectronicBilling binding
    const binding = this.wsfev1.createBinding(
      issuer.cuit,
      ta,
      cert.isProduction,
    );

    const client: AfipClient = {
      afip: { ElectronicBilling: binding },
      tenantId,
      issuerId,
      issuerCuit: issuer.cuit,
      expiresAt: now + TTL_MS,
    };

    if (this.cache.size >= MAX_CACHE) {
      this._evictLru();
    }

    this.cache.set(cacheKey, { client, lastUsed: now });

    this.logger.debug('WSFEv1 client binding created', {
      tenantId,
      issuerId,
      issuerCuit: issuer.cuit,
      isProduction: cert.isProduction,
    });

    return client;
  }

  private _evictLru(): void {
    let lruKey = '';
    let lruTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastUsed < lruTime) {
        lruTime = entry.lastUsed;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
      this.logger.debug('Evicted LRU client binding', { key: lruKey });
    }
  }

  /** Kept for backward compat — now a no-op since no PEM in client */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private _zeroClient(_client: AfipClient): void {
    // No-op: we no longer store PEMs in the client object
  }
}
