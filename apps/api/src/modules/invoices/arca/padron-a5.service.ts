/**
 * PadronA5Service — AFIP Padrón A5 lookup via ws_sr_padron_a5.
 *
 * Uses the WsaaService to obtain a TA for "ws_sr_padron_a5" signed
 * with the agency certificate, then calls getPersona_v2 via raw SOAP.
 *
 * Endpoints:
 *   Homo: https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5
 *   Prod: https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5
 */

import * as https from 'https';
import * as http from 'http';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WsaaService, TokenAuthorization } from './wsaa/wsaa.service';

// ─── Endpoints ────────────────────────────────────────────────────────────────

const PADRON_HOMO = 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5';
const PADRON_PROD = 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5';

const PADRON_SERVICE = 'ws_sr_padron_a5';

// ─── SOAP helpers ─────────────────────────────────────────────────────────────

function escapeXml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildGetPersonaEnvelope(
  token: string,
  sign: string,
  cuitRepresentada: string,
  idPersona: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:per="http://a5.soap.ws.server.puc.sr/">
  <soapenv:Header/>
  <soapenv:Body>
    <per:getPersona_v2>
      <token>${escapeXml(token)}</token>
      <sign>${escapeXml(sign)}</sign>
      <cuitRepresentada>${escapeXml(cuitRepresentada.replace(/-/g, ''))}</cuitRepresentada>
      <idPersona>${escapeXml(idPersona.replace(/-/g, ''))}</idPersona>
    </per:getPersona_v2>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function soapPost(url: string, soapAction: string, body: string): Promise<string> {
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
        SOAPAction: `"${soapAction}"`,
      },
      timeout: 30_000,
    };

    const req = mod.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text);
      });
    });

    req.on('timeout', () => req.destroy(new Error('Padrón A5 request timed out')));
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'i');
  return (xml.match(re)?.[1] ?? '').trim();
}

// ─── Return type ──────────────────────────────────────────────────────────────

export interface PadronResult {
  businessName: string;
  fiscalCondition: string;
  address?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PadronA5Service {
  private readonly logger = new Logger(PadronA5Service.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wsaa: WsaaService,
  ) {}

  /**
   * Look up a CUIT in AFIP Padrón A5.
   *
   * @param tenantId  Agency tenant (provides cert + CUIT for auth)
   * @param issuerId  Which issuer's CUIT is used as `cuitRepresentada`
   * @param cuit      The CUIT to look up
   * @returns PadronResult or null if not found
   */
  async lookup(
    tenantId: string,
    issuerId: string,
    cuit: string,
  ): Promise<PadronResult | null> {
    // Resolve issuer CUIT (used as cuitRepresentada)
    const issuer = await this.prisma.client.arcaIssuer.findFirst({
      where: { id: issuerId, tenantId },
    });

    if (!issuer) {
      throw new NotFoundException(`ArcaIssuer ${issuerId} not found for tenant ${tenantId}`);
    }

    // Get certificate to know prod vs homo
    const cert = await this.prisma.client.arcaCertificate.findFirst({
      where: { tenantId, isActive: true },
    });

    if (!cert) {
      throw new NotFoundException(`No active certificate for tenant ${tenantId}`);
    }

    // Get TA for padron service (agency cert signs for padron)
    let ta: TokenAuthorization;
    try {
      ta = await this.wsaa.getTa(tenantId, PADRON_SERVICE);
    } catch (err: any) {
      this.logger.error('Failed to get WSAA TA for padron', { tenantId, error: err.message });
      throw err;
    }

    const url = cert.isProduction ? PADRON_PROD : PADRON_HOMO;
    const issuerCuitClean = issuer.cuit.replace(/-/g, '');
    const cuitClean = cuit.replace(/-/g, '');

    const envelope = buildGetPersonaEnvelope(ta.token, ta.sign, issuerCuitClean, cuitClean);

    this.logger.debug('Calling Padrón A5', { tenantId, issuerId, cuit: cuitClean });

    let response: string;
    try {
      response = await soapPost(url, '', envelope);
    } catch (err: any) {
      this.logger.error('Padrón A5 SOAP call failed', { error: err.message });
      throw err;
    }

    // Check for "no existe" / not found
    if (/no existe|not found|inexistente/i.test(response)) {
      return null;
    }

    // Check for SOAP faults
    if (response.includes('faultstring') || response.includes('Fault')) {
      const fault = extractTag(response, 'faultstring');
      if (/no existe|not found/i.test(fault)) {
        return null;
      }
      throw new Error(`Padrón A5 SOAP fault: ${fault}`);
    }

    // Parse personaReturn
    const personaBlock = extractTag(response, 'personaReturn') || extractTag(response, 'return');

    if (!personaBlock) {
      this.logger.warn('Padrón A5: empty personaReturn', { cuit });
      return null;
    }

    // Extract relevant fields
    const razonSocial =
      extractTag(personaBlock, 'razonSocial') ||
      extractTag(personaBlock, 'nombre') ||
      extractTag(personaBlock, 'apellido');

    if (!razonSocial) {
      return null;
    }

    // Fiscal condition — look inside impuestos for IVA type
    const condicionFiscal = this._parseCondicionFiscal(personaBlock);

    // Address — first domicilio fiscal
    const address = this._parseAddress(personaBlock);

    return {
      businessName: razonSocial,
      fiscalCondition: condicionFiscal,
      address,
    };
  }

  private _parseCondicionFiscal(personaBlock: string): string {
    // Look for tipoClave (CUIT/CUIL) + categoriaMonotributo or estadoGeneral
    const estadoClave = extractTag(personaBlock, 'estadoClave');
    if (estadoClave && estadoClave !== 'ACTIVO') {
      return estadoClave;
    }

    // Check impuestos block for IVA (Id=32)
    const impuestosBlock = extractTag(personaBlock, 'impuestos');
    if (impuestosBlock) {
      if (/responsable inscripto/i.test(impuestosBlock) || /32/i.test(impuestosBlock)) {
        return 'ResponsableInscripto';
      }
    }

    // Check categorias for monotributo
    const categoriasBlock = extractTag(personaBlock, 'categorias');
    if (categoriasBlock && /monotributo|RS/i.test(categoriasBlock)) {
      return 'Monotributista';
    }

    return 'ConsumidorFinal';
  }

  private _parseAddress(personaBlock: string): string | undefined {
    const domBlock = extractTag(personaBlock, 'domicilioFiscal') ||
      extractTag(personaBlock, 'domicilio');
    if (!domBlock) return undefined;

    const calle = extractTag(domBlock, 'direccion') || extractTag(domBlock, 'calle') || '';
    const localidad = extractTag(domBlock, 'localidad') || '';
    const provincia = extractTag(domBlock, 'descripcionProvincia') || extractTag(domBlock, 'provincia') || '';

    const parts = [calle, localidad, provincia].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : undefined;
  }
}
