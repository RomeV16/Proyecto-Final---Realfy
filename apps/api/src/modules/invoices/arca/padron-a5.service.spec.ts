/**
 * padron-a5.service.spec.ts — Unit tests for PadronA5Service.
 *
 * Tests:
 * - happy path: returns businessName, fiscalCondition, address
 * - not-found: returns null for unknown CUIT
 * - SOAP fault: throws on server error
 * - auth failure: throws when WsaaService fails
 * - homo vs prod based on certificate
 */

import { Test } from '@nestjs/testing';
import { PadronA5Service } from './padron-a5.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WsaaService } from './wsaa/wsaa.service';
import { NotFoundException } from '@nestjs/common';

// ─── SOAP fixtures ────────────────────────────────────────────────────────────

const PERSONA_FOUND = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:getPersona_v2Response xmlns:ns2="http://a5.soap.ws.server.puc.sr/">
      <personaReturn>
        <idPersona>20111111113</idPersona>
        <tipoClave>CUIT</tipoClave>
        <estadoClave>ACTIVO</estadoClave>
        <razonSocial>EMPRESA TEST SA</razonSocial>
        <impuestos>
          <impuesto>
            <idImpuesto>32</idImpuesto>
            <descripcion>IVA</descripcion>
          </impuesto>
        </impuestos>
        <domicilioFiscal>
          <direccion>AV CORRIENTES 1234</direccion>
          <localidad>CABA</localidad>
          <descripcionProvincia>CIUDAD AUTONOMA DE BUENOS AIRES</descripcionProvincia>
        </domicilioFiscal>
      </personaReturn>
    </ns2:getPersona_v2Response>
  </soap:Body>
</soap:Envelope>`;

const PERSONA_NOT_FOUND = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Server</faultcode>
      <faultstring>No existe persona con ese ID</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;

const PERSONA_AUTH_ERROR = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Server</faultcode>
      <faultstring>Token inválido o expirado</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;

// ─── HTTP mock ────────────────────────────────────────────────────────────────

let currentHttpResponse = PERSONA_FOUND;

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
    return { on: jest.fn(), write: jest.fn(), end: jest.fn() };
  }),
}));

jest.mock('http', () => ({ request: jest.fn() }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MOCK_TA = {
  token: 'padron-token',
  sign: 'padron-sign',
  expirationTime: new Date(Date.now() + 10 * 60 * 60 * 1000),
};

function makeMockIssuer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'issuer-1',
    tenantId: 'tenant-1',
    cuit: '20111111113',
    isActive: true,
    delegationStatus: 'Active',
    ...overrides,
  };
}

function makeMockCert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cert-1',
    tenantId: 'tenant-1',
    isActive: true,
    isProduction: false,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PadronA5Service', () => {
  let service: PadronA5Service;
  let prismaMock: any;
  let wsaaMock: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    currentHttpResponse = PERSONA_FOUND;

    prismaMock = {
      client: {
        arcaIssuer: {
          findFirst: jest.fn().mockResolvedValue(makeMockIssuer()),
        },
        arcaCertificate: {
          findFirst: jest.fn().mockResolvedValue(makeMockCert()),
        },
      },
    };

    wsaaMock = {
      getTa: jest.fn().mockResolvedValue(MOCK_TA),
    };

    const module = await Test.createTestingModule({
      providers: [
        PadronA5Service,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WsaaService, useValue: wsaaMock },
      ],
    }).compile();

    service = module.get(PadronA5Service);
  });

  describe('lookup', () => {
    it('returns businessName, fiscalCondition, and address for known CUIT', async () => {
      const result = await service.lookup('tenant-1', 'issuer-1', '20111111113');

      expect(result).not.toBeNull();
      expect(result!.businessName).toBe('EMPRESA TEST SA');
      expect(result!.fiscalCondition).toBe('ResponsableInscripto');
      expect(result!.address).toContain('AV CORRIENTES 1234');
    });

    it('calls WsaaService.getTa with ws_sr_padron_a5 service', async () => {
      await service.lookup('tenant-1', 'issuer-1', '20111111113');
      expect(wsaaMock.getTa).toHaveBeenCalledWith('tenant-1', 'ws_sr_padron_a5');
    });

    it('returns null when CUIT not found', async () => {
      currentHttpResponse = PERSONA_NOT_FOUND;
      const result = await service.lookup('tenant-1', 'issuer-1', '99-99999999-9');
      expect(result).toBeNull();
    });

    it('throws on auth failure (non-notfound SOAP fault)', async () => {
      currentHttpResponse = PERSONA_AUTH_ERROR;
      await expect(
        service.lookup('tenant-1', 'issuer-1', '20111111113'),
      ).rejects.toThrow('Token inválido');
    });

    it('throws NotFoundException when issuer not found', async () => {
      prismaMock.client.arcaIssuer.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.lookup('tenant-1', 'unknown-issuer', '20111111113'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when certificate not found', async () => {
      prismaMock.client.arcaCertificate.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.lookup('tenant-1', 'issuer-1', '20111111113'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when WsaaService.getTa fails', async () => {
      wsaaMock.getTa.mockRejectedValueOnce(new Error('WSAA offline'));

      await expect(
        service.lookup('tenant-1', 'issuer-1', '20111111113'),
      ).rejects.toThrow('WSAA offline');
    });

    it('strips dashes from CUIT before lookup', async () => {
      const https = require('https');
      const spy = https.request as jest.Mock;

      await service.lookup('tenant-1', 'issuer-1', '20-11111111-3');

      // The HTTP request body should not contain dashes in the idPersona
      const writeCall = spy.mock.results[0].value.write.mock.calls[0][0];
      const bodyStr = writeCall instanceof Buffer ? writeCall.toString() : String(writeCall);
      expect(bodyStr).toContain('<idPersona>20111111113</idPersona>');
    });

    it('uses homo URL when isProduction=false', async () => {
      const https = require('https');
      const spy = https.request as jest.Mock;

      await service.lookup('tenant-1', 'issuer-1', '20111111113');

      const opts = spy.mock.calls[0][0];
      expect(opts.hostname).toContain('awshomo.afip.gov.ar');
    });

    it('uses prod URL when isProduction=true', async () => {
      prismaMock.client.arcaCertificate.findFirst.mockResolvedValueOnce(
        makeMockCert({ isProduction: true }),
      );

      const https = require('https');
      const spy = https.request as jest.Mock;

      await service.lookup('tenant-1', 'issuer-1', '20111111113');

      const opts = spy.mock.calls[0][0];
      expect(opts.hostname).toContain('aws.afip.gov.ar');
    });
  });
});
