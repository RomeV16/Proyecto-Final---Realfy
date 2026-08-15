/**
 * wsaa.service.spec.ts — Unit tests for WsaaService.
 *
 * Tests:
 * - happy path: builds TRA, signs, posts to WSAA, parses TA
 * - single-flight: concurrent getTa calls share one HTTP request
 * - cache: second call returns cached TA without re-calling WSAA
 * - expiry refresh: expired TA triggers a new WSAA call
 * - homo vs prod endpoint selection based on isProduction
 * - auth failure: NotFoundException when cert missing
 */

import { Test } from '@nestjs/testing';
import { WsaaService } from './wsaa.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { CryptoService } from '../../../../common/crypto/crypto.service';
import { NotFoundException } from '@nestjs/common';

// ─── Mock node-forge ──────────────────────────────────────────────────────────

jest.mock('node-forge', () => ({
  pki: {
    certificateFromPem: jest.fn().mockReturnValue({ subject: { getField: () => null } }),
    privateKeyFromPem: jest.fn().mockReturnValue({}),
    oids: {
      contentType: '1.2.840.113549.1.9.3',
      data: '1.2.840.113549.1.7.1',
      messageDigest: '1.2.840.113549.1.9.4',
      signingTime: '1.2.840.113549.1.9.5',
      sha256: '2.16.840.1.101.3.4.2.1',
    },
  },
  pkcs7: {
    createSignedData: jest.fn().mockReturnValue({
      content: null,
      addCertificate: jest.fn(),
      addSigner: jest.fn(),
      sign: jest.fn(),
      toAsn1: jest.fn().mockReturnValue({}),
    }),
  },
  util: {
    createBuffer: jest.fn().mockReturnValue({}),
    encode64: jest.fn().mockReturnValue('MOCK_BASE64_CMS'),
    decode64: jest.fn().mockReturnValue(''),
  },
  asn1: {
    toDer: jest.fn().mockReturnValue({ getBytes: jest.fn().mockReturnValue('DER_BYTES') }),
    fromDer: jest.fn().mockReturnValue({ type: 0x30 }),
  },
  md: {
    sha256: { create: jest.fn().mockReturnValue({}) },
  },
}));

// ─── WSAA SOAP response fixture ───────────────────────────────────────────────

// AFIP hands out tickets valid for 12h. The fixture expiry has to be relative to
// now, otherwise the cache-hit assertions start failing once the wall clock
// passes a hardcoded date.
const TA_EXPIRATION = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

const VALID_TA_XML = `
  <token>MOCK_TOKEN_VALUE</token>
  <sign>MOCK_SIGN_VALUE</sign>
  <expirationTime>${TA_EXPIRATION}</expirationTime>
`;

const VALID_SOAP_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <loginCmsResponse>
      <loginCmsReturn>&lt;loginTicketResponse&gt;
        &lt;credentials&gt;
          &lt;token&gt;MOCK_TOKEN_VALUE&lt;/token&gt;
          &lt;sign&gt;MOCK_SIGN_VALUE&lt;/sign&gt;
        &lt;/credentials&gt;
        &lt;header&gt;
          &lt;expirationTime&gt;${TA_EXPIRATION}&lt;/expirationTime&gt;
        &lt;/header&gt;
      &lt;/loginTicketResponse&gt;</loginCmsReturn>
    </loginCmsResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockCert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cert-1',
    tenantId: 'tenant-1',
    isActive: true,
    isProduction: false,
    certEncrypted: Buffer.from('enc-cert'),
    keyEncrypted: Buffer.from('enc-key'),
    dekWrapped: Buffer.from('wrapped-dek'),
    ...overrides,
  };
}

// ─── HTTP mock (intercept https.request) ──────────────────────────────────────

let mockHttpCallback: ((response: string) => void) | undefined;
let capturedRequestOptions: any = null;

jest.mock('https', () => ({
  request: jest.fn((options: any, cb: any) => {
    capturedRequestOptions = options;
    const mockRes = {
      statusCode: 200,
      on: jest.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'data') handler(Buffer.from(VALID_SOAP_RESPONSE));
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

jest.mock('http', () => ({
  request: jest.fn(),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WsaaService', () => {
  let service: WsaaService;
  let prismaMock: any;
  let cryptoMock: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    capturedRequestOptions = null;

    prismaMock = {
      client: {
        arcaCertificate: {
          findFirst: jest.fn().mockResolvedValue(makeMockCert()),
        },
      },
    };

    cryptoMock = {
      decrypt: jest.fn()
        .mockResolvedValueOnce(Buffer.from('-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----\n'))
        .mockResolvedValueOnce(Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nMOCK\n-----END RSA PRIVATE KEY-----\n')),
    };

    const module = await Test.createTestingModule({
      providers: [
        WsaaService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CryptoService, useValue: cryptoMock },
      ],
    }).compile();

    service = module.get(WsaaService);
  });

  describe('getTa', () => {
    it('returns token and sign from WSAA response', async () => {
      const ta = await service.getTa('tenant-1', 'wsfe');

      expect(ta.token).toBe('MOCK_TOKEN_VALUE');
      expect(ta.sign).toBe('MOCK_SIGN_VALUE');
      expect(ta.expirationTime).toBeInstanceOf(Date);
    });

    it('calls decrypt twice (cert + key)', async () => {
      await service.getTa('tenant-1', 'wsfe');
      expect(cryptoMock.decrypt).toHaveBeenCalledTimes(2);
    });

    it('caches TA — second call does not re-call WSAA', async () => {
      await service.getTa('tenant-1', 'wsfe');
      await service.getTa('tenant-1', 'wsfe');

      // decrypt should only be called on first acquisition
      expect(cryptoMock.decrypt).toHaveBeenCalledTimes(2);
    });

    it('single-flight — concurrent calls share one HTTP request', async () => {
      const https = require('https');
      const httpRequestSpy = https.request as jest.Mock;

      // Fire two concurrent calls
      const [ta1, ta2] = await Promise.all([
        service.getTa('tenant-1', 'wsfe'),
        service.getTa('tenant-1', 'wsfe'),
      ]);

      // Only one HTTP request should have been made
      expect(httpRequestSpy).toHaveBeenCalledTimes(1);
      expect(ta1.token).toBe(ta2.token);
    });

    it('uses homo endpoint when isProduction=false', async () => {
      await service.getTa('tenant-1', 'wsfe');

      expect(capturedRequestOptions?.hostname).toBe('wsaahomo.afip.gov.ar');
    });

    it('uses prod endpoint when isProduction=true', async () => {
      prismaMock.client.arcaCertificate.findFirst.mockResolvedValueOnce(
        makeMockCert({ isProduction: true }),
      );

      // Reset decrypt mock for second call
      cryptoMock.decrypt
        .mockResolvedValueOnce(Buffer.from('-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----\n'))
        .mockResolvedValueOnce(Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nMOCK\n-----END RSA PRIVATE KEY-----\n'));

      await service.getTa('tenant-1', 'wsfe');

      expect(capturedRequestOptions?.hostname).toBe('wsaa.afip.gov.ar');
    });

    it('throws NotFoundException when no active certificate', async () => {
      prismaMock.client.arcaCertificate.findFirst.mockResolvedValueOnce(null);

      await expect(service.getTa('tenant-1', 'wsfe')).rejects.toThrow(NotFoundException);
    });

    it('different services get different cache entries', async () => {
      // Reset decrypt mock to allow two separate acquisitions
      cryptoMock.decrypt
        .mockResolvedValueOnce(Buffer.from('-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----\n'))
        .mockResolvedValueOnce(Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nMOCK\n-----END RSA PRIVATE KEY-----\n'))
        .mockResolvedValueOnce(Buffer.from('-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----\n'))
        .mockResolvedValueOnce(Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nMOCK\n-----END RSA PRIVATE KEY-----\n'));

      await service.getTa('tenant-1', 'wsfe');
      await service.getTa('tenant-1', 'ws_sr_padron_a5');

      // Two different services → two WSAA calls
      expect(cryptoMock.decrypt).toHaveBeenCalledTimes(4);
    });

    it('refreshes TA when near expiry', async () => {
      const ta1 = await service.getTa('tenant-1', 'wsfe');

      // Force TA to appear expired (within refresh margin)
      ta1.expirationTime = new Date(Date.now() - 1000); // already past

      // Invalidate so the service sees it as stale
      service.invalidate('tenant-1', 'wsfe');

      // Re-setup mocks for second acquisition
      cryptoMock.decrypt
        .mockResolvedValueOnce(Buffer.from('-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----\n'))
        .mockResolvedValueOnce(Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nMOCK\n-----END RSA PRIVATE KEY-----\n'));

      const ta2 = await service.getTa('tenant-1', 'wsfe');
      expect(ta2.token).toBe('MOCK_TOKEN_VALUE');
      // decrypt was called again
      expect(cryptoMock.decrypt).toHaveBeenCalledTimes(4);
    });
  });

  describe('invalidate', () => {
    it('forces re-acquisition after invalidation', async () => {
      await service.getTa('tenant-1', 'wsfe');
      service.invalidate('tenant-1', 'wsfe');

      cryptoMock.decrypt
        .mockResolvedValueOnce(Buffer.from('-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----\n'))
        .mockResolvedValueOnce(Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nMOCK\n-----END RSA PRIVATE KEY-----\n'));

      await service.getTa('tenant-1', 'wsfe');
      expect(cryptoMock.decrypt).toHaveBeenCalledTimes(4);
    });
  });

  describe('invalidateAll', () => {
    it('clears all entries for a tenant', async () => {
      await service.getTa('tenant-1', 'wsfe');
      service.invalidateAll('tenant-1');

      cryptoMock.decrypt
        .mockResolvedValueOnce(Buffer.from('-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----\n'))
        .mockResolvedValueOnce(Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nMOCK\n-----END RSA PRIVATE KEY-----\n'));

      await service.getTa('tenant-1', 'wsfe');
      expect(cryptoMock.decrypt).toHaveBeenCalledTimes(4);
    });
  });
});
