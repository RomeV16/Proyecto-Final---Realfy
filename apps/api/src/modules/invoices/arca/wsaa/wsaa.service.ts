/**
 * WsaaService — rolls our own WSAA client, independent of AfipSDK.
 *
 * Key design decisions:
 * - Signs TRA with the AGENCY certificate (not the issuer's CUIT cert).
 *   This satisfies AFIP's delegation model: the agency cert is trusted to
 *   act on behalf of any delegated CUIT (ws delegation in WSASS).
 * - Caches TAs per (tenantId, service) for ~10h.
 * - Single-flight per (tenantId, service): concurrent callers share one
 *   in-flight WSAA request, avoiding the `coe.alreadyAuthenticated` error.
 * - Works in both homo and production based on ArcaCertificate.isProduction.
 *
 * Replaces the `ArcaTaManager` + `ArcaClientFactory` TA acquisition path.
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as https from 'https';
import * as http from 'http';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { CryptoService } from '../../../../common/crypto/crypto.service';
import { buildTra, signTra } from './tra-signer';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenAuthorization {
  token: string;
  sign: string;
  expirationTime: Date;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WSAA_HOMO = 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms';
const WSAA_PROD = 'https://wsaa.afip.gov.ar/ws/services/LoginCms';

/** Refresh 15 minutes before expiry */
const REFRESH_MARGIN_MS = 15 * 60 * 1000;

// ─── Cache entry ──────────────────────────────────────────────────────────────

interface CacheEntry {
  ta: TokenAuthorization;
  /** We store the in-flight promise while acquiring */
  inFlight?: Promise<TokenAuthorization>;
}

// ─── SOAP helpers ─────────────────────────────────────────────────────────────

function buildLoginCmsEnvelope(cms: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="https://wsaa.afip.gov.ar/ws/services/LoginCms">
  <SOAP-ENV:Body>
    <tns:loginCms>
      <in0>${cms}</in0>
    </tns:loginCms>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

/** Extract the TA XML from the WSAA SOAP response */
function extractTaXml(soapResponse: string): string {
  const match = soapResponse.match(/<loginCmsReturn[^>]*>([\s\S]*?)<\/loginCmsReturn>/);
  if (!match?.[1]) {
    throw new Error('WSAA: could not parse loginCmsReturn from response');
  }
  // Unescape HTML entities
  return match[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Extract a tag value from simple XML (no namespaces) */
function extractXmlTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1]?.trim() ?? '';
}

/** Parse the TA XML into a TokenAuthorization */
function parseTaXml(taXml: string): TokenAuthorization {
  const token = extractXmlTag(taXml, 'token');
  const sign = extractXmlTag(taXml, 'sign');
  const expirationTimeStr = extractXmlTag(taXml, 'expirationTime');

  if (!token || !sign) {
    throw new Error('WSAA: TA XML missing token or sign');
  }

  let expirationTime: Date;
  try {
    expirationTime = new Date(expirationTimeStr);
    if (isNaN(expirationTime.getTime())) throw new Error('invalid date');
  } catch {
    // Default 10h expiry if parsing fails
    expirationTime = new Date(Date.now() + 10 * 60 * 60 * 1000);
  }

  return { token, sign, expirationTime };
}

/** Send a raw SOAP request over HTTPS */
function soapPost(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const mod = isHttps ? https : http;

    const bodyBuf = Buffer.from(body, 'utf8');

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': bodyBuf.length,
        SOAPAction: '',
      },
      timeout: 30_000,
    };

    const req = mod.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const responseText = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode ?? 200) >= 400) {
          reject(new Error(`WSAA HTTP ${res.statusCode}: ${responseText.slice(0, 200)}`));
        } else {
          resolve(responseText);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('WSAA request timed out'));
    });

    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WsaaService {
  private readonly logger = new Logger(WsaaService.name);

  /**
   * TA cache: key = `${tenantId}:${service}`
   */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Get a valid TokenAuthorization for a given tenant + AFIP service.
   *
   * Single-flight: concurrent callers for the same key share one request.
   * Result is cached for ~10h (refreshed 15min before expiry).
   *
   * @param tenantId  Agency tenant
   * @param service   AFIP service name (e.g. "wsfe", "ws_sr_padron_a5")
   */
  async getTa(tenantId: string, service: string): Promise<TokenAuthorization> {
    const key = `${tenantId}:${service}`;
    const now = Date.now();

    const entry = this.cache.get(key);

    // Return cached TA if still valid
    if (entry && !entry.inFlight) {
      if (entry.ta.expirationTime.getTime() - REFRESH_MARGIN_MS > now) {
        return entry.ta;
      }
    }

    // If there's an in-flight request, reuse it
    if (entry?.inFlight) {
      this.logger.debug('Reusing in-flight WSAA request', { key });
      return entry.inFlight;
    }

    // Start a new acquisition
    const inFlight = this._acquire(tenantId, service).then((ta) => {
      this.cache.set(key, { ta });
      return ta;
    }).catch((err) => {
      // Remove the in-flight marker so the next call retries
      const existing = this.cache.get(key);
      if (existing?.inFlight) {
        this.cache.delete(key);
      }
      throw err;
    });

    // Store in-flight promise
    this.cache.set(key, { ...(entry ?? { ta: undefined as any }), inFlight });

    return inFlight;
  }

  /**
   * Perform the actual WSAA call.
   */
  private async _acquire(tenantId: string, service: string): Promise<TokenAuthorization> {
    // Load ArcaCertificate
    const cert = await this.prisma.client.arcaCertificate.findFirst({
      where: { tenantId, isActive: true },
    });

    if (!cert) {
      throw new NotFoundException(`No active ArcaCertificate for tenant ${tenantId}`);
    }

    // Decrypt PEMs
    const certPem = (await this.crypto.decrypt({
      ciphertext: Buffer.from(cert.certEncrypted),
      dek_wrapped: Buffer.from(cert.dekWrapped),
    })).toString('utf-8');

    const keyPem = (await this.crypto.decrypt({
      ciphertext: Buffer.from(cert.keyEncrypted),
      dek_wrapped: Buffer.from(cert.dekWrapped),
    })).toString('utf-8');

    // Build and sign TRA
    const traXml = buildTra(service);
    const cms = signTra(traXml, certPem, keyPem);

    // Send to WSAA
    const wsaaUrl = cert.isProduction ? WSAA_PROD : WSAA_HOMO;
    const envelope = buildLoginCmsEnvelope(cms);

    this.logger.debug('Calling WSAA', { service, url: wsaaUrl, isProduction: cert.isProduction });

    const response = await soapPost(wsaaUrl, envelope);

    // Parse TA from response
    const taXml = extractTaXml(response);
    const ta = parseTaXml(taXml);

    this.logger.log('WSAA TA acquired', {
      tenantId,
      service,
      expiresAt: ta.expirationTime.toISOString(),
    });

    return ta;
  }

  /**
   * Invalidate cached TA for a tenant+service (force re-auth on next call).
   */
  invalidate(tenantId: string, service: string): void {
    this.cache.delete(`${tenantId}:${service}`);
  }

  /**
   * Invalidate all TAs for a tenant.
   */
  invalidateAll(tenantId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.cache.delete(key);
      }
    }
  }
}
