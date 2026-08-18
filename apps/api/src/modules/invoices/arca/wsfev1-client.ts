/**
 * wsfev1-client.ts — Thin SOAP client for AFIP's WSFEv1 (wsfe1) web service.
 *
 * Design: direct SOAP over HTTPS using Node's built-in `https` module.
 * No external SOAP library required.
 *
 * Endpoints:
 *   Homo: https://wswhomo.afip.gov.ar/wsfev1/service.asmx
 *   Prod: https://servicios1.afip.gov.ar/wsfev1/service.asmx
 *
 * The client receives a pre-fetched TokenAuthorization (from WsaaService)
 * and builds FEAuthRequest internally. This fully decouples us from AfipSDK.
 *
 * Replaces AfipSDK's ElectronicBilling class for all WSFEv1 operations.
 */

import * as https from 'https';
import * as http from 'http';
import { Injectable, Logger } from '@nestjs/common';
import type { TokenAuthorization } from './wsaa/wsaa.service';

// ─── Endpoints ────────────────────────────────────────────────────────────────

const WSFEV1_HOMO = 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx';
const WSFEV1_PROD = 'https://servicios1.afip.gov.ar/wsfev1/service.asmx';

// ─── XML/SOAP helpers ─────────────────────────────────────────────────────────

const NS = 'http://ar.gov.afip.dif.FEV1/';

function escapeXml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xmlTag(tag: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && !Array.isArray(value)) {
    const inner = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => xmlTag(k, v))
      .join('');
    return `<${tag}>${inner}</${tag}>`;
  }
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

function buildEnvelope(method: string, bodyInner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:${method}>
      ${bodyInner}
    </ar:${method}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function authXml(issuerCuit: string, ta: TokenAuthorization): string {
  return `<ar:Auth>
      <ar:Token>${escapeXml(ta.token)}</ar:Token>
      <ar:Sign>${escapeXml(ta.sign)}</ar:Sign>
      <ar:Cuit>${escapeXml(issuerCuit.replace(/-/g, ''))}</ar:Cuit>
    </ar:Auth>`;
}

/** Send a raw SOAP request */
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
        SOAPAction: `"${NS}${soapAction}"`,
      },
      timeout: 60_000,
    };

    const req = mod.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode ?? 200) >= 500) {
          reject(new Error(`WSFEv1 HTTP ${res.statusCode}: ${text.slice(0, 400)}`));
        } else {
          resolve(text);
        }
      });
    });

    req.on('timeout', () => req.destroy(new Error('WSFEv1 request timed out')));
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

/** Parse a simple XML element to string (handles CDATA and text nodes) */
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'i');
  return (xml.match(re)?.[1] ?? '').trim();
}

function extractTagNum(xml: string, tag: string): number {
  return parseInt(extractTag(xml, tag), 10) || 0;
}

/** Raise a structured error from an AFIP Errors block */
function checkAfipErrors(xml: string): void {
  const errBlock = extractTag(xml, 'Errors') || extractTag(xml, 'Err');
  if (!errBlock) return;

  const code = extractTag(errBlock, 'Code') || extractTag(errBlock, 'code');
  const msg = extractTag(errBlock, 'Msg') || extractTag(errBlock, 'msg');

  if (code && code !== '0') {
    const err = new Error(`AFIP WSFEv1 error ${code}: ${msg}`);
    (err as any).afipCode = code;
    (err as any).afipMsg = msg;
    throw err;
  }
}

/** Format AFIP date (yyyymmdd → yyyy-mm-dd) */
function formatAfipDate(raw: string): string {
  const s = String(raw ?? '');
  if (s.length === 8) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return s;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WsfevCaeResult {
  CAE: string;
  CAEFchVto: string; // yyyy-mm-dd
}

export interface WsfevSalesPoint {
  Nro: number;
  EmisionTipo: string;
  Bloqueado: string;
  FchBaja: string | null;
}

export interface WsfevVoucherType {
  Id: number;
  Desc: string;
  FchDesde: string;
  FchHasta: string;
}

export interface WsfevDocumentType {
  Id: number;
  Desc: string;
  FchDesde: string;
  FchHasta: string;
}

export interface WsfevAliquotType {
  Id: number;
  Desc: string;
  FchDesde: string;
  FchHasta: string;
}

export interface WsfevCondicionIvaReceptor {
  Id: number;
  Desc: string;
}

export interface WsfevServerStatus {
  AppServer: string;
  DbServer: string;
  AuthServer: string;
}

// ─── IVA array XML builder ────────────────────────────────────────────────────

function buildIvaArrayXml(iva: Array<{ Id: number; BaseImp: number; Importe: number }>): string {
  return `<ar:Iva>${iva.map(i => `<ar:AlicIva><ar:Id>${i.Id}</ar:Id><ar:BaseImp>${i.BaseImp}</ar:BaseImp><ar:Importe>${i.Importe}</ar:Importe></ar:AlicIva>`).join('')}</ar:Iva>`;
}

function buildCbtesAsocXml(asoc: Array<{ Tipo: number; PtoVta: number; Nro: number }>): string {
  return `<ar:CbtesAsoc>${asoc.map(a => `<ar:CbteAsoc><ar:Tipo>${a.Tipo}</ar:Tipo><ar:PtoVta>${a.PtoVta}</ar:PtoVta><ar:Nro>${a.Nro}</ar:Nro></ar:CbteAsoc>`).join('')}</ar:CbtesAsoc>`;
}

function buildTributosXml(trib: Array<Record<string, unknown>>): string {
  return `<ar:Tributos>${trib.map(t => {
    const inner = Object.entries(t).map(([k, v]) => `<ar:${k}>${escapeXml(v)}</ar:${k}>`).join('');
    return `<ar:Tributo>${inner}</ar:Tributo>`;
  }).join('')}</ar:Tributos>`;
}

// ─── Parse helpers for list responses ────────────────────────────────────────

function parseRepeatedTag<T>(xml: string, wrapTag: string, itemTag: string, mapFn: (item: string) => T): T[] {
  const wrapBlock = extractTag(xml, wrapTag);
  if (!wrapBlock) return [];
  const results: T[] = [];
  const re = new RegExp(`<(?:[^:>]+:)?${itemTag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${itemTag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(wrapBlock)) !== null) {
    results.push(mapFn(m[1]));
  }
  return results;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class Wsfev1Client {
  private readonly logger = new Logger(Wsfev1Client.name);

  /**
   * Create a bound instance configured for a specific issuer.
   * Returns a closure-based interface compatible with the existing
   * ArcaService/ArcaParamCacheService usage patterns.
   */
  createBinding(issuerCuit: string, ta: TokenAuthorization, isProduction: boolean) {
    const url = isProduction ? WSFEV1_PROD : WSFEV1_HOMO;
    // Las funciones flecha ya cierran sobre `this`, no hace falta un alias.
    return {
      getServerStatus: () => this.getServerStatus(url),
      getLastVoucher: (ptoVta: number, cbteTipo: number) =>
        this.getLastVoucher(url, issuerCuit, ta, ptoVta, cbteTipo),
      createVoucher: (data: Record<string, unknown>) =>
        this.createVoucher(url, issuerCuit, ta, data),
      getSalesPoints: () => this.getSalesPoints(url, issuerCuit, ta),
      getVoucherTypes: () => this.getVoucherTypes(url, issuerCuit, ta),
      getDocumentTypes: () => this.getDocumentTypes(url, issuerCuit, ta),
      getAliquotTypes: () => this.getAliquotTypes(url, issuerCuit, ta),
      getConceptTypes: () => this.getConceptTypes(url, issuerCuit, ta),
      getCondicionIvaReceptor: () => this.getCondicionIvaReceptor(url, issuerCuit, ta),
    };
  }

  // ─── FEDummy ───────────────────────────────────────────────────────────────

  async getServerStatus(url: string): Promise<WsfevServerStatus> {
    const envelope = buildEnvelope('FEDummy', '');
    const response = await soapPost(url, 'FEDummy', envelope);
    return {
      AppServer: extractTag(response, 'AppServer') || 'OK',
      DbServer: extractTag(response, 'DbServer') || 'OK',
      AuthServer: extractTag(response, 'AuthServer') || 'OK',
    };
  }

  // ─── FECompUltimoAutorizado ────────────────────────────────────────────────

  async getLastVoucher(
    url: string,
    issuerCuit: string,
    ta: TokenAuthorization,
    ptoVta: number,
    cbteTipo: number,
  ): Promise<number> {
    const bodyInner = `${authXml(issuerCuit, ta)}
      <ar:PtoVta>${ptoVta}</ar:PtoVta>
      <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`;

    const envelope = buildEnvelope('FECompUltimoAutorizado', bodyInner);
    const response = await soapPost(url, 'FECompUltimoAutorizado', envelope);
    checkAfipErrors(response);

    return extractTagNum(response, 'CbteNro');
  }

  // ─── FECAESolicitar ────────────────────────────────────────────────────────

  async createVoucher(
    url: string,
    issuerCuit: string,
    ta: TokenAuthorization,
    data: Record<string, unknown>,
  ): Promise<WsfevCaeResult> {
    // Build FECAEDetRequest XML
    const detFields = [
      xmlTag('ar:Concepto', data['Concepto']),
      xmlTag('ar:DocTipo', data['DocTipo']),
      xmlTag('ar:DocNro', data['DocNro']),
      xmlTag('ar:CbteDesde', data['CbteDesde']),
      xmlTag('ar:CbteHasta', data['CbteHasta']),
      xmlTag('ar:CbteFch', data['CbteFch']),
      xmlTag('ar:ImpTotal', data['ImpTotal']),
      xmlTag('ar:ImpTotConc', data['ImpTotConc'] ?? 0),
      xmlTag('ar:ImpNeto', data['ImpNeto']),
      xmlTag('ar:ImpOpEx', data['ImpOpEx'] ?? 0),
      xmlTag('ar:ImpIVA', data['ImpIVA'] ?? 0),
      xmlTag('ar:ImpTrib', data['ImpTrib'] ?? 0),
      xmlTag('ar:MonId', data['MonId'] ?? 'PES'),
      xmlTag('ar:MonCotiz', data['MonCotiz'] ?? 1),
    ];

    if (data['CondicionIVAReceptorId'] !== undefined) {
      detFields.push(xmlTag('ar:CondicionIVAReceptorId', data['CondicionIVAReceptorId']));
    }

    // Service dates
    if (data['FchServDesde']) detFields.push(xmlTag('ar:FchServDesde', data['FchServDesde']));
    if (data['FchServHasta']) detFields.push(xmlTag('ar:FchServHasta', data['FchServHasta']));
    if (data['FchVtoPago']) detFields.push(xmlTag('ar:FchVtoPago', data['FchVtoPago']));

    // IVA array
    const ivaArr = data['Iva'] as Array<{ Id: number; BaseImp: number; Importe: number }> | undefined;
    if (ivaArr && ivaArr.length > 0) {
      detFields.push(buildIvaArrayXml(ivaArr));
    }

    // Tributos
    const tribArr = data['Tributos'] as Array<Record<string, unknown>> | undefined;
    if (tribArr && tribArr.length > 0) {
      detFields.push(buildTributosXml(tribArr));
    }

    // CbtesAsoc
    const asocRaw = data['CbtesAsoc'] as Array<{ Tipo: number; PtoVta: number; Nro: number }> | undefined;
    if (asocRaw && asocRaw.length > 0) {
      detFields.push(buildCbtesAsocXml(asocRaw));
    }

    const bodyInner = `${authXml(issuerCuit, ta)}
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${data['PtoVta']}</ar:PtoVta>
          <ar:CbteTipo>${data['CbteTipo']}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            ${detFields.join('\n            ')}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>`;

    const envelope = buildEnvelope('FECAESolicitar', bodyInner);
    const response = await soapPost(url, 'FECAESolicitar', envelope);
    checkAfipErrors(response);

    // Check observation/errors in detail response
    const detResp = extractTag(response, 'FECAEDetResponse');
    if (detResp) {
      const resultado = extractTag(detResp, 'Resultado');
      if (resultado && resultado !== 'A') {
        const obs = extractTag(detResp, 'Observaciones') || extractTag(detResp, 'Obs');
        throw new Error(`FECAESolicitar rejected (Resultado=${resultado}): ${obs || 'unknown reason'}`);
      }
    }

    const cae = extractTag(response, 'CAE');
    const caeFchVto = formatAfipDate(extractTag(response, 'CAEFchVto'));

    if (!cae) {
      throw new Error('FECAESolicitar: no CAE in response');
    }

    return { CAE: cae, CAEFchVto: caeFchVto };
  }

  // ─── FEParamGetPtosVenta ───────────────────────────────────────────────────

  async getSalesPoints(
    url: string,
    issuerCuit: string,
    ta: TokenAuthorization,
  ): Promise<WsfevSalesPoint[]> {
    const bodyInner = authXml(issuerCuit, ta);
    const envelope = buildEnvelope('FEParamGetPtosVenta', bodyInner);
    const response = await soapPost(url, 'FEParamGetPtosVenta', envelope);
    checkAfipErrors(response);

    return parseRepeatedTag(response, 'ResultGet', 'PtoVenta', (item) => ({
      Nro: extractTagNum(item, 'Nro'),
      EmisionTipo: extractTag(item, 'EmisionTipo') || '',
      Bloqueado: extractTag(item, 'Bloqueado') || 'N',
      FchBaja: extractTag(item, 'FchBaja') || null,
    }));
  }

  // ─── FEParamGetTiposCbte ───────────────────────────────────────────────────

  async getVoucherTypes(
    url: string,
    issuerCuit: string,
    ta: TokenAuthorization,
  ): Promise<WsfevVoucherType[]> {
    const bodyInner = authXml(issuerCuit, ta);
    const envelope = buildEnvelope('FEParamGetTiposCbte', bodyInner);
    const response = await soapPost(url, 'FEParamGetTiposCbte', envelope);
    checkAfipErrors(response);

    return parseRepeatedTag(response, 'ResultGet', 'CbteTipo', (item) => ({
      Id: extractTagNum(item, 'Id'),
      Desc: extractTag(item, 'Desc') || '',
      FchDesde: formatAfipDate(extractTag(item, 'FchDesde')),
      FchHasta: formatAfipDate(extractTag(item, 'FchHasta')),
    }));
  }

  // ─── FEParamGetTiposDoc ────────────────────────────────────────────────────

  async getDocumentTypes(
    url: string,
    issuerCuit: string,
    ta: TokenAuthorization,
  ): Promise<WsfevDocumentType[]> {
    const bodyInner = authXml(issuerCuit, ta);
    const envelope = buildEnvelope('FEParamGetTiposDoc', bodyInner);
    const response = await soapPost(url, 'FEParamGetTiposDoc', envelope);
    checkAfipErrors(response);

    return parseRepeatedTag(response, 'ResultGet', 'DocTipo', (item) => ({
      Id: extractTagNum(item, 'Id'),
      Desc: extractTag(item, 'Desc') || '',
      FchDesde: formatAfipDate(extractTag(item, 'FchDesde')),
      FchHasta: formatAfipDate(extractTag(item, 'FchHasta')),
    }));
  }

  // ─── FEParamGetTiposIva ────────────────────────────────────────────────────

  async getAliquotTypes(
    url: string,
    issuerCuit: string,
    ta: TokenAuthorization,
  ): Promise<WsfevAliquotType[]> {
    const bodyInner = authXml(issuerCuit, ta);
    const envelope = buildEnvelope('FEParamGetTiposIva', bodyInner);
    const response = await soapPost(url, 'FEParamGetTiposIva', envelope);
    checkAfipErrors(response);

    return parseRepeatedTag(response, 'ResultGet', 'IvaTipo', (item) => ({
      Id: extractTagNum(item, 'Id'),
      Desc: extractTag(item, 'Desc') || '',
      FchDesde: formatAfipDate(extractTag(item, 'FchDesde')),
      FchHasta: formatAfipDate(extractTag(item, 'FchHasta')),
    }));
  }

  // ─── FEParamGetTiposConcepto ───────────────────────────────────────────────

  async getConceptTypes(
    url: string,
    issuerCuit: string,
    ta: TokenAuthorization,
  ): Promise<Array<{ Id: number; Desc: string }>> {
    const bodyInner = authXml(issuerCuit, ta);
    const envelope = buildEnvelope('FEParamGetTiposConcepto', bodyInner);
    const response = await soapPost(url, 'FEParamGetTiposConcepto', envelope);
    checkAfipErrors(response);

    return parseRepeatedTag(response, 'ResultGet', 'ConceptoTipo', (item) => ({
      Id: extractTagNum(item, 'Id'),
      Desc: extractTag(item, 'Desc') || '',
    }));
  }

  // ─── FEParamGetCondicionIvaReceptor ────────────────────────────────────────

  async getCondicionIvaReceptor(
    url: string,
    issuerCuit: string,
    ta: TokenAuthorization,
  ): Promise<WsfevCondicionIvaReceptor[]> {
    const bodyInner = authXml(issuerCuit, ta);
    const envelope = buildEnvelope('FEParamGetCondicionIvaReceptor', bodyInner);
    const response = await soapPost(url, 'FEParamGetCondicionIvaReceptor', envelope);
    checkAfipErrors(response);

    // Try both CondIvaReceptor and CondicionIvaReceptor tags (AFIP inconsistency)
    const results = parseRepeatedTag(response, 'ResultGet', 'CondIvaReceptor', (item) => ({
      Id: extractTagNum(item, 'Id'),
      Desc: extractTag(item, 'Desc') || '',
    }));

    if (results.length > 0) return results;

    return parseRepeatedTag(response, 'ResultGet', 'CondicionIvaReceptor', (item) => ({
      Id: extractTagNum(item, 'Id'),
      Desc: extractTag(item, 'Desc') || '',
    }));
  }
}
