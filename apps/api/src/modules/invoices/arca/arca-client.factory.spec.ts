import { Test } from '@nestjs/testing';
import { ArcaClientFactory } from './arca-client.factory';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { WsaaService } from './wsaa/wsaa.service';
import { Wsfev1Client } from './wsfev1-client';
import { NotFoundException } from '@nestjs/common';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MOCK_TA = {
  token: 'test-token',
  sign: 'test-sign',
  expirationTime: new Date(Date.now() + 10 * 60 * 60 * 1000),
};

function makeMockCert(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'cert-1',
    tenantId: 'tenant-1',
    isActive: true,
    isProduction: false,
    certEncrypted: Buffer.from('encrypted-cert'),
    keyEncrypted: Buffer.from('encrypted-key'),
    dekWrapped: Buffer.from('wrapped-dek'),
    ...overrides,
  };
}

function makeMockIssuer(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'issuer-1',
    tenantId: 'tenant-1',
    cuit: '20-12345678-9',
    delegationStatus: 'Active',
    isActive: true,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ArcaClientFactory', () => {
  let factory: ArcaClientFactory;
  let prismaMock: any;
  let cryptoMock: any;
  let wsaaMock: any;
  let wsfev1Mock: any;

  const mockBinding = {
    getServerStatus: jest.fn().mockResolvedValue({ AppServer: 'OK', DbServer: 'OK', AuthServer: 'OK' }),
    getLastVoucher: jest.fn().mockResolvedValue(0),
    createVoucher: jest.fn().mockResolvedValue({ CAE: '12345678901234', CAEFchVto: '2026-12-31' }),
    getSalesPoints: jest.fn().mockResolvedValue([]),
    getVoucherTypes: jest.fn().mockResolvedValue([]),
    getDocumentTypes: jest.fn().mockResolvedValue([]),
    getAliquotTypes: jest.fn().mockResolvedValue([]),
    getConceptTypes: jest.fn().mockResolvedValue([]),
    getCondicionIvaReceptor: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    prismaMock = {
      client: {
        arcaCertificate: {
          findFirst: jest.fn().mockResolvedValue(makeMockCert()),
        },
        arcaIssuer: {
          findFirst: jest.fn().mockResolvedValue(makeMockIssuer()),
        },
        arcaCertificateAccessLog: {
          create: jest.fn().mockResolvedValue({ id: 'log-1' }),
        },
      },
    };

    cryptoMock = {
      decrypt: jest
        .fn()
        .mockResolvedValueOnce(Buffer.from('cert-pem'))
        .mockResolvedValueOnce(Buffer.from('key-pem')),
    };

    wsaaMock = {
      getTa: jest.fn().mockResolvedValue(MOCK_TA),
    };

    wsfev1Mock = {
      createBinding: jest.fn().mockReturnValue(mockBinding),
    };

    const module = await Test.createTestingModule({
      providers: [
        ArcaClientFactory,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CryptoService, useValue: cryptoMock },
        { provide: WsaaService, useValue: wsaaMock },
        { provide: Wsfev1Client, useValue: wsfev1Mock },
      ],
    }).compile();

    factory = module.get(ArcaClientFactory);
  });

  it('creates a new client and writes access log', async () => {
    const client = await factory.getClient('tenant-1', 'issuer-1', 'system:test');

    expect(client.tenantId).toBe('tenant-1');
    expect(client.issuerId).toBe('issuer-1');
    expect(client.issuerCuit).toBe('20-12345678-9');
    expect(prismaMock.client.arcaCertificateAccessLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          certificateId: 'cert-1',
          actor: 'system:test',
        }),
      }),
    );
  });

  it('calls WsaaService.getTa for wsfe service', async () => {
    await factory.getClient('tenant-1', 'issuer-1', 'system:test');
    expect(wsaaMock.getTa).toHaveBeenCalledWith('tenant-1', 'wsfe');
  });

  it('calls Wsfev1Client.createBinding with issuer CUIT and TA', async () => {
    await factory.getClient('tenant-1', 'issuer-1', 'system:test');
    expect(wsfev1Mock.createBinding).toHaveBeenCalledWith(
      '20-12345678-9',
      MOCK_TA,
      false, // isProduction=false from cert
    );
  });

  it('returns client with ElectronicBilling binding', async () => {
    const client = await factory.getClient('tenant-1', 'issuer-1', 'system:test');

    expect(client.afip).toBeDefined();
    expect(client.afip.ElectronicBilling).toBeDefined();
    expect(typeof client.afip.ElectronicBilling.getSalesPoints).toBe('function');
  });

  it('returns cached client without re-calling WsaaService', async () => {
    await factory.getClient('tenant-1', 'issuer-1', 'system:test');
    await factory.getClient('tenant-1', 'issuer-1', 'system:test');

    // WsaaService.getTa should only be called on first creation
    expect(wsaaMock.getTa).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException when no active certificate exists', async () => {
    prismaMock.client.arcaCertificate.findFirst.mockResolvedValueOnce(null);

    await expect(factory.getClient('tenant-1', 'issuer-1', 'actor')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when issuer is not found', async () => {
    prismaMock.client.arcaIssuer.findFirst.mockResolvedValueOnce(null);

    await expect(factory.getClient('tenant-1', 'issuer-unknown', 'actor')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('re-creates client after TTL expiry', async () => {
    const first = await factory.getClient('tenant-1', 'issuer-1', 'actor');
    // Force expiry
    first.expiresAt = Date.now() - 1;

    await factory.getClient('tenant-1', 'issuer-1', 'actor');

    // WsaaService.getTa should be called on each creation
    expect(wsaaMock.getTa).toHaveBeenCalledTimes(2);
  });

  it('access log failure is non-fatal', async () => {
    prismaMock.client.arcaCertificateAccessLog.create.mockRejectedValueOnce(
      new Error('DB error'),
    );

    const client = await factory.getClient('tenant-1', 'issuer-1', 'actor');
    expect(client).toBeDefined();
  });

  it('respects isProduction flag from certificate', async () => {
    prismaMock.client.arcaCertificate.findFirst.mockResolvedValueOnce(
      makeMockCert({ isProduction: true }),
    );

    await factory.getClient('tenant-1', 'issuer-1', 'actor');

    expect(wsfev1Mock.createBinding).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      true,
    );
  });
});
