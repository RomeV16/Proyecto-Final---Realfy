import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as forge from 'node-forge';
import { CertificateService } from './certificate.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { CryptoService } from '../../common/crypto/crypto.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-001';

/** Generate a minimal self-signed X.509 cert + key pair for testing. */
function generateTestCertPem(): { certPem: string; keyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [{ name: 'commonName', value: 'Test CUIT 20-30123456-4' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildPrismaMock(certRow: any = null) {
  return {
    client: {
      arcaCertificate: {
        findFirst: jest.fn().mockResolvedValue(certRow),
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'cert-001', tenantId: TENANT_ID, ...data, createdAt: new Date(), updatedAt: new Date() }),
        ),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'cert-001', tenantId: TENANT_ID, ...data, createdAt: new Date(), updatedAt: new Date() }),
        ),
        delete: jest.fn().mockResolvedValue({ id: 'cert-001' }),
      },
      arcaIssuer: {
        count: jest.fn().mockResolvedValue(0),
      },
    },
  };
}

function buildCryptoMock() {
  return {
    encrypt: jest.fn().mockResolvedValue({ ciphertext: Buffer.from('enc'), dek_wrapped: Buffer.from('dek') }),
    decrypt: jest.fn().mockResolvedValue(Buffer.from('plain')),
    parseCertificate: jest.fn().mockReturnValue({
      commonName: 'Test CN',
      notBefore: new Date('2025-01-01'),
      notAfter: new Date('2026-01-01'),
    }),
  };
}

async function buildService(prismaMock: any, cryptoMock: any): Promise<CertificateService> {
  const tenantContextMock = {
    getTenantId: jest.fn().mockReturnValue(TENANT_ID),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CertificateService,
      { provide: PrismaService, useValue: prismaMock },
      { provide: TenantContextService, useValue: tenantContextMock },
      { provide: CryptoService, useValue: cryptoMock },
    ],
  }).compile();

  return module.get<CertificateService>(CertificateService);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CertificateService', () => {
  let { certPem, keyPem } = { certPem: '', keyPem: '' };

  beforeAll(() => {
    const pair = generateTestCertPem();
    certPem = pair.certPem;
    keyPem = pair.keyPem;
  });

  describe('uploadCertificate', () => {
    it('encrypts cert and key, stores in DB', async () => {
      const prisma = buildPrismaMock(null);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await svc.uploadCertificate({ certPem, keyPem, isProduction: false });
      expect(crypto.encrypt).toHaveBeenCalledTimes(2); // cert + key
      expect(prisma.client.arcaCertificate.create).toHaveBeenCalled();
    });

    it('upserts when cert already exists', async () => {
      const existingCert = { id: 'cert-existing', tenantId: TENANT_ID };
      const prisma = buildPrismaMock(existingCert);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await svc.uploadCertificate({ certPem, keyPem, isProduction: false });
      expect(prisma.client.arcaCertificate.update).toHaveBeenCalled();
      expect(prisma.client.arcaCertificate.create).not.toHaveBeenCalled();
    });

    it('throws BadRequest when certPem is not valid X.509', async () => {
      const prisma = buildPrismaMock(null);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await expect(
        svc.uploadCertificate({ certPem: 'NOT A PEM', keyPem, isProduction: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequest when keyPem is not valid PEM key', async () => {
      const prisma = buildPrismaMock(null);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await expect(
        svc.uploadCertificate({ certPem, keyPem: 'NOT A KEY', isProduction: false }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getCertificateMetadata', () => {
    it('returns metadata without private key material', async () => {
      const dbRow = {
        id: 'cert-001',
        tenantId: TENANT_ID,
        commonName: 'Test CN',
        notBefore: new Date('2025-01-01'),
        notAfter: new Date('2026-12-31'),
        isProduction: false,
        isActive: true,
        certEncrypted: Buffer.from('enc'),
        keyEncrypted: Buffer.from('enckey'),
        dekWrapped: Buffer.from('dek'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const prisma = buildPrismaMock(dbRow);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      const meta = await svc.getCertificateMetadata();
      expect(meta).not.toBeNull();
      expect(meta).not.toHaveProperty('certEncrypted');
      expect(meta).not.toHaveProperty('keyEncrypted');
      expect(meta).not.toHaveProperty('dekWrapped');
      expect(meta).toHaveProperty('commonName', 'Test CN');
      expect(meta).toHaveProperty('daysUntilExpiry');
    });

    it('returns null when no cert exists', async () => {
      const prisma = buildPrismaMock(null);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      const meta = await svc.getCertificateMetadata();
      expect(meta).toBeNull();
    });
  });

  describe('deleteCertificate', () => {
    it('deletes when no active issuers', async () => {
      const prisma = buildPrismaMock({ id: 'cert-001', tenantId: TENANT_ID });
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await svc.deleteCertificate(false);
      expect(prisma.client.arcaCertificate.delete).toHaveBeenCalled();
    });

    it('throws BadRequest when active issuers exist (no force)', async () => {
      const prisma = buildPrismaMock({ id: 'cert-001', tenantId: TENANT_ID });
      prisma.client.arcaIssuer.count = jest.fn().mockResolvedValue(2);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await expect(svc.deleteCertificate(false)).rejects.toThrow(BadRequestException);
    });

    it('deletes even with active issuers when force=true', async () => {
      const prisma = buildPrismaMock({ id: 'cert-001', tenantId: TENANT_ID });
      prisma.client.arcaIssuer.count = jest.fn().mockResolvedValue(2);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await svc.deleteCertificate(true);
      expect(prisma.client.arcaCertificate.delete).toHaveBeenCalled();
    });

    it('throws NotFound when no cert exists', async () => {
      const prisma = buildPrismaMock(null);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await expect(svc.deleteCertificate(false)).rejects.toThrow(NotFoundException);
    });
  });
});
