/**
 * wsfev1-client.spec.ts — Unit tests for the thin WSFEv1 SOAP client.
 *
 * Tests each public method with fake SOAP responses.
 * All HTTP calls are intercepted via jest.mock('https').
 */

import { Test } from '@nestjs/testing';
import { Wsfev1Client } from './wsfev1-client';

// ─── SOAP response fixtures ───────────────────────────────────────────────────

const DUMMY_OK = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FEDummyResponse>
      <FEDummyResult>
        <AppServer>OK</AppServer>
        <DbServer>OK</DbServer>
        <AuthServer>OK</AuthServer>
      </FEDummyResult>
    </FEDummyResponse>
  </soap:Body>
</soap:Envelope>`;

const LAST_VOUCHER = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECompUltimoAutorizadoResponse>
      <FECompUltimoAutorizadoResult>
        <PtoVta>1</PtoVta>
        <CbteTipo>11</CbteTipo>
        <CbteNro>42</CbteNro>
      </FECompUltimoAutorizadoResult>
    </FECompUltimoAutorizadoResponse>
  </soap:Body>
</soap:Envelope>`;

const CAE_RESPONSE = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitarResponse>
      <FECAESolicitarResult>
        <FeCabResp>
          <Cuit>20111111113</Cuit>
          <PtoVta>1</PtoVta>
          <CbteTipo>11</CbteTipo>
        </FeCabResp>
        <FeDetResp>
          <FECAEDetResponse>
            <CbteDesde>43</CbteDesde>
            <CbteHasta>43</CbteHasta>
            <Resultado>A</Resultado>
            <CAE>12345678901234</CAE>
            <CAEFchVto>20261231</CAEFchVto>
          </FECAEDetResponse>
        </FeDetResp>
      </FECAESolicitarResult>
    </FECAESolicitarResponse>
  </soap:Body>
</soap:Envelope>`;

const SALES_POINTS = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FEParamGetPtosVentaResponse>
      <FEParamGetPtosVentaResult>
        <ResultGet>
          <PtoVenta>
            <Nro>1</Nro>
            <EmisionTipo>Web Services</EmisionTipo>
            <Bloqueado>N</Bloqueado>
            <FchBaja></FchBaja>
          </PtoVenta>
          <PtoVenta>
            <Nro>5</Nro>
            <EmisionTipo>Factura en Línea</EmisionTipo>
            <Bloqueado>N</Bloqueado>
            <FchBaja></FchBaja>
          </PtoVenta>
        </ResultGet>
      </FEParamGetPtosVentaResult>
    </FEParamGetPtosVentaResponse>
  </soap:Body>
</soap:Envelope>`;

const VOUCHER_TYPES = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FEParamGetTiposCbteResponse>
      <FEParamGetTiposCbteResult>
        <ResultGet>
          <CbteTipo>
            <Id>1</Id>
            <Desc>Factura A</Desc>
            <FchDesde>20020101</FchDesde>
            <FchHasta>99991231</FchHasta>
          </CbteTipo>
          <CbteTipo>
            <Id>11</Id>
            <Desc>Factura C</Desc>
            <FchDesde>20020101</FchDesde>
            <FchHasta>99991231</FchHasta>
          </CbteTipo>
        </ResultGet>
      </FEParamGetTiposCbteResult>
    </FEParamGetTiposCbteResponse>
  </soap:Body>
</soap:Envelope>`;

const DOCUMENT_TYPES = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FEParamGetTiposDocResponse>
      <FEParamGetTiposDocResult>
        <ResultGet>
          <DocTipo>
            <Id>80</Id>
            <Desc>CUIT</Desc>
            <FchDesde>20020101</FchDesde>
            <FchHasta>99991231</FchHasta>
          </DocTipo>
          <DocTipo>
            <Id>99</Id>
            <Desc>Sin identificar</Desc>
            <FchDesde>20020101</FchDesde>
            <FchHasta>99991231</FchHasta>
          </DocTipo>
        </ResultGet>
      </FEParamGetTiposDocResult>
    </FEParamGetTiposDocResponse>
  </soap:Body>
</soap:Envelope>`;

const ALIQUOT_TYPES = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FEParamGetTiposIvaResponse>
      <FEParamGetTiposIvaResult>
        <ResultGet>
          <IvaTipo>
            <Id>5</Id>
            <Desc>21%</Desc>
            <FchDesde>20020101</FchDesde>
            <FchHasta>99991231</FchHasta>
          </IvaTipo>
        </ResultGet>
      </FEParamGetTiposIvaResult>
    </FEParamGetTiposIvaResponse>
  </soap:Body>
</soap:Envelope>`;

const CONDICION_IVA = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FEParamGetCondicionIvaReceptorResponse>
      <FEParamGetCondicionIvaReceptorResult>
        <ResultGet>
          <CondIvaReceptor>
            <Id>1</Id>
            <Desc>IVA Responsable Inscripto</Desc>
          </CondIvaReceptor>
          <CondIvaReceptor>
            <Id>5</Id>
            <Desc>Consumidor Final</Desc>
          </CondIvaReceptor>
        </ResultGet>
      </FEParamGetCondicionIvaReceptorResult>
    </FEParamGetCondicionIvaReceptorResponse>
  </soap:Body>
</soap:Envelope>`;

const ERROR_RESPONSE = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECompUltimoAutorizadoResponse>
      <FECompUltimoAutorizadoResult>
        <Errors>
          <Err><Code>601</Code><Msg>CUIT representada no autorizada</Msg></Err>
        </Errors>
      </FECompUltimoAutorizadoResult>
    </FECompUltimoAutorizadoResponse>
  </soap:Body>
</soap:Envelope>`;

// ─── HTTP mock ────────────────────────────────────────────────────────────────

let currentHttpResponse = DUMMY_OK;

jest.mock('https', () => ({
  request: jest.fn((options: any, cb: any) => {
    const mockRes = {
      statusCode: 200,
      on: jest.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'data') handler(Buffer.from(currentHttpResponse));
        if (event === 'end') handler();
      }),
    };
    cb(mockRes);
    return {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };
  }),
}));

jest.mock('http', () => ({ request: jest.fn() }));

// ─── Mock TA ──────────────────────────────────────────────────────────────────

const MOCK_TA = {
  token: 'test-token',
  sign: 'test-sign',
  expirationTime: new Date(Date.now() + 10 * 60 * 60 * 1000),
};

const TEST_URL = 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx';
const TEST_CUIT = '20111111113';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Wsfev1Client', () => {
  let client: Wsfev1Client;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [Wsfev1Client],
    }).compile();

    client = module.get(Wsfev1Client);
  });

  describe('getServerStatus', () => {
    it('returns AppServer, DbServer, AuthServer status', async () => {
      currentHttpResponse = DUMMY_OK;
      const result = await client.getServerStatus(TEST_URL);

      expect(result.AppServer).toBe('OK');
      expect(result.DbServer).toBe('OK');
      expect(result.AuthServer).toBe('OK');
    });
  });

  describe('getLastVoucher', () => {
    it('returns the last voucher number', async () => {
      currentHttpResponse = LAST_VOUCHER;
      const result = await client.getLastVoucher(TEST_URL, TEST_CUIT, MOCK_TA, 1, 11);

      expect(result).toBe(42);
    });

    it('throws on AFIP error response', async () => {
      currentHttpResponse = ERROR_RESPONSE;

      await expect(
        client.getLastVoucher(TEST_URL, TEST_CUIT, MOCK_TA, 1, 11),
      ).rejects.toThrow('601');
    });
  });

  describe('createVoucher', () => {
    it('returns CAE and formatted CAEFchVto', async () => {
      currentHttpResponse = CAE_RESPONSE;

      const result = await client.createVoucher(TEST_URL, TEST_CUIT, MOCK_TA, {
        PtoVta: 1,
        CbteTipo: 11,
        Concepto: 2,
        DocTipo: 99,
        DocNro: 0,
        CbteDesde: 43,
        CbteHasta: 43,
        CbteFch: 20260415,
        ImpTotal: 1.01,
        ImpNeto: 1.01,
        ImpIVA: 0,
        ImpOpEx: 0,
        ImpTotConc: 0,
        ImpTrib: 0,
        MonId: 'PES',
        MonCotiz: 1,
        CondicionIVAReceptorId: 5,
        Concepto2: 2,
        FchServDesde: 20260401,
        FchServHasta: 20260430,
        FchVtoPago: 20260430,
      });

      expect(result.CAE).toBe('12345678901234');
      expect(result.CAEFchVto).toBe('2026-12-31');
    });

    it('throws when Resultado is not A', async () => {
      currentHttpResponse = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitarResponse>
      <FECAESolicitarResult>
        <FeDetResp>
          <FECAEDetResponse>
            <Resultado>R</Resultado>
            <Observaciones><Obs><Code>10016</Code><Msg>Factura B inválida</Msg></Obs></Observaciones>
          </FECAEDetResponse>
        </FeDetResp>
      </FECAESolicitarResult>
    </FECAESolicitarResponse>
  </soap:Body>
</soap:Envelope>`;

      await expect(
        client.createVoucher(TEST_URL, TEST_CUIT, MOCK_TA, {
          PtoVta: 1, CbteTipo: 11,
          Concepto: 2, DocTipo: 99, DocNro: 0,
          CbteDesde: 1, CbteHasta: 1, CbteFch: 20260415,
          ImpTotal: 1.01, ImpNeto: 1.01, ImpIVA: 0,
          ImpOpEx: 0, ImpTotConc: 0, ImpTrib: 0,
          MonId: 'PES', MonCotiz: 1,
        }),
      ).rejects.toThrow('rejected');
    });
  });

  describe('getSalesPoints', () => {
    it('returns array of sales points', async () => {
      currentHttpResponse = SALES_POINTS;
      const result = await client.getSalesPoints(TEST_URL, TEST_CUIT, MOCK_TA);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0].Nro).toBe(1);
      expect(result[0].EmisionTipo).toBe('Web Services');
      expect(result[1].Nro).toBe(5);
    });
  });

  describe('getVoucherTypes', () => {
    it('returns array of voucher types', async () => {
      currentHttpResponse = VOUCHER_TYPES;
      const result = await client.getVoucherTypes(TEST_URL, TEST_CUIT, MOCK_TA);

      expect(result).toHaveLength(2);
      expect(result[0].Id).toBe(1);
      expect(result[0].Desc).toBe('Factura A');
      expect(result[1].Id).toBe(11);
      expect(result[1].FchDesde).toBe('2002-01-01');
    });
  });

  describe('getDocumentTypes', () => {
    it('returns array of document types', async () => {
      currentHttpResponse = DOCUMENT_TYPES;
      const result = await client.getDocumentTypes(TEST_URL, TEST_CUIT, MOCK_TA);

      expect(result).toHaveLength(2);
      expect(result[0].Id).toBe(80);
      expect(result[0].Desc).toBe('CUIT');
    });
  });

  describe('getAliquotTypes', () => {
    it('returns array of aliquot types', async () => {
      currentHttpResponse = ALIQUOT_TYPES;
      const result = await client.getAliquotTypes(TEST_URL, TEST_CUIT, MOCK_TA);

      expect(result).toHaveLength(1);
      expect(result[0].Id).toBe(5);
      expect(result[0].Desc).toBe('21%');
    });
  });

  describe('getCondicionIvaReceptor', () => {
    it('returns array of condicion IVA receptor', async () => {
      currentHttpResponse = CONDICION_IVA;
      const result = await client.getCondicionIvaReceptor(TEST_URL, TEST_CUIT, MOCK_TA);

      expect(result).toHaveLength(2);
      expect(result[0].Id).toBe(1);
      expect(result[1].Id).toBe(5);
      expect(result[1].Desc).toBe('Consumidor Final');
    });
  });

  describe('createBinding', () => {
    it('createBinding returns an object with all expected methods', () => {
      currentHttpResponse = DUMMY_OK;
      const binding = client.createBinding(TEST_CUIT, MOCK_TA, false);

      expect(typeof binding.getServerStatus).toBe('function');
      expect(typeof binding.getLastVoucher).toBe('function');
      expect(typeof binding.createVoucher).toBe('function');
      expect(typeof binding.getSalesPoints).toBe('function');
      expect(typeof binding.getVoucherTypes).toBe('function');
      expect(typeof binding.getDocumentTypes).toBe('function');
      expect(typeof binding.getAliquotTypes).toBe('function');
      expect(typeof binding.getConceptTypes).toBe('function');
      expect(typeof binding.getCondicionIvaReceptor).toBe('function');
    });

    it('createBinding uses homo URL when isProduction=false', async () => {
      currentHttpResponse = DUMMY_OK;
      const https = require('https');
      const httpSpy = https.request as jest.Mock;

      const binding = client.createBinding(TEST_CUIT, MOCK_TA, false);
      await binding.getServerStatus();

      const opts = httpSpy.mock.calls[0][0];
      expect(opts.hostname).toBe('wswhomo.afip.gov.ar');
    });

    it('createBinding uses prod URL when isProduction=true', async () => {
      currentHttpResponse = DUMMY_OK;
      const https = require('https');
      const httpSpy = https.request as jest.Mock;

      const binding = client.createBinding(TEST_CUIT, MOCK_TA, true);
      await binding.getServerStatus();

      const opts = httpSpy.mock.calls[0][0];
      expect(opts.hostname).toBe('servicios1.afip.gov.ar');
    });
  });
});
