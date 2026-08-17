/**
 * CertificateService — edge-case unit tests.
 *
 * Covers:
 * 1. Upload → metadata → delete lifecycle.
 * 2. Delete rejects when issuers are active.
 * 3. daysUntilExpiry is correctly computed.
 * 4. Key material (PEM, encrypted bytes) is absent from metadata responses.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as forge from 'node-forge';
import { CertificateService } from './certificate.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { CryptoService } from '../../common/crypto/crypto.service';

const TENANT_ID = 'tenant-cert-extra';

// ─── Helper: generate a real self-signed PEM pair ─────────────────────────────

function generateTestCertPem(daysValid = 365): { certPem: string; keyPem: string; notAfter: Date } {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + daysValid);
  const attrs = [{ name: 'commonName', value: '20-30123456-4' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    notAfter: cert.validity.notAfter,
  };
}

// ─── Mock builders ─────────────────────────────────────────────────────────────

function buildCertRow(overrides: any = {}) {
  const now = new Date();
  const notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  return {
    id: 'cert-001',
    tenantId: TENANT_ID,
    commonName: '20-30123456-4',
    notBefore: now,
    notAfter,
    isProduction: false,
    isActive: true,
    certEncrypted: Buffer.from('enc-cert'),
    keyEncrypted: Buffer.from('enc-key'),
    dekWrapped: Buffer.from('dek'),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildPrismaMock(certRow: any = null, issuerCount = 0) {
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
        count: jest.fn().mockResolvedValue(issuerCount),
      },
    },
  };
}

function buildCryptoMock() {
  return {
    encrypt: jest.fn().mockResolvedValue({ ciphertext: Buffer.from('enc'), dek_wrapped: Buffer.from('dek') }),
    decrypt: jest.fn().mockResolvedValue(Buffer.from('plain')),
    parseCertificate: jest.fn().mockReturnValue({
      commonName: '20-30123456-4',
      notBefore: new Date('2025-01-01'),
      notAfter: new Date('2026-01-01'),
    }),
  };
}

async function buildService(prismaMock: any, cryptoMock: any): Promise<CertificateService> {
  const tenantContextMock = { getTenantId: jest.fn().mockReturnValue(TENANT_ID) };
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

describe('CertificateService — edge cases', () => {
  let certPem: string;
  let keyPem: string;

  beforeAll(() => {
    const pair = generateTestCertPem();
    certPem = pair.certPem;
    keyPem = pair.keyPem;
  });

  // ── 1. Upload → metadata lifecycle ─────────────────────────────────────────

  describe('upload → metadata lifecycle', () => {
    it('upload returns metadata with commonName but NOT raw PEM material', async () => {
      const prisma = buildPrismaMock(null);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      const meta = await svc.uploadCertificate({ certPem, keyPem, isProduction: false });

      expect(meta).toHaveProperty('commonName');
      expect(meta).not.toHaveProperty('certPem');
      expect(meta).not.toHaveProperty('keyPem');
      expect(meta).not.toHaveProperty('certEncrypted');
      expect(meta).not.toHaveProperty('keyEncrypted');
      expect(meta).not.toHaveProperty('dekWrapped');
    });

    it('getCertificateMetadata returns same fields as upload (no key material)', async () => {
      const certRow = buildCertRow();
      const prisma = buildPrismaMock(certRow);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      const meta = await svc.getCertificateMetadata();

      expect(meta).not.toBeNull();
      expect(meta).not.toHaveProperty('certEncrypted');
      expect(meta).not.toHaveProperty('keyEncrypted');
      expect(meta).not.toHaveProperty('dekWrapped');
      expect(meta).toHaveProperty('commonName');
      expect(meta).toHaveProperty('notBefore');
      expect(meta).toHaveProperty('notAfter');
    });

    it('getCertificateMetadata returns null when no cert exists', async () => {
      const prisma = buildPrismaMock(null);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      const meta = await svc.getCertificateMetadata();
      expect(meta).toBeNull();
    });
  });

  // ── 2. Delete rejects when issuers are active ──────────────────────────────

  describe('deleteCertificate — rejects when issuers active', () => {
    it('throws BadRequest when 1 or more active issuers exist (no force)', async () => {
      const prisma = buildPrismaMock({ id: 'cert-001', tenantId: TENANT_ID }, 1);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await expect(svc.deleteCertificate(false)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequest when 5 active issuers exist (no force)', async () => {
      const prisma = buildPrismaMock({ id: 'cert-001', tenantId: TENANT_ID }, 5);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await expect(svc.deleteCertificate(false)).rejects.toThrow(BadRequestException);
    });

    it('allows delete when force=true even with active issuers', async () => {
      const prisma = buildPrismaMock({ id: 'cert-001', tenantId: TENANT_ID }, 3);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await expect(svc.deleteCertificate(true)).resolves.not.toThrow();
      expect(prisma.client.arcaCertificate.delete).toHaveBeenCalled();
    });

    it('allows delete with no issuers (force=false)', async () => {
      const prisma = buildPrismaMock({ id: 'cert-001', tenantId: TENANT_ID }, 0);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await expect(svc.deleteCertificate(false)).resolves.not.toThrow();
      expect(prisma.client.arcaCertificate.delete).toHaveBeenCalled();
    });

    it('throws NotFound when trying to delete non-existent cert', async () => {
      const prisma = buildPrismaMock(null);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await expect(svc.deleteCertificate(false)).rejects.toThrow(NotFoundException);
    });

    it('error message from CERT_IN_USE includes the count of active issuers', async () => {
      const prisma = buildPrismaMock({ id: 'cert-001', tenantId: TENANT_ID }, 3);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      let caught: any = null;
      try {
        await svc.deleteCertificate(false);
      } catch (err: any) {
        caught = err;
      }

      expect(caught).not.toBeNull();
      expect(caught.response?.error).toBe('CERT_IN_USE');
      expect(caught.response?.message).toMatch(/3/);
    });
  });

  // ── 3. daysUntilExpiry computation ─────────────────────────────────────────

  describe('daysUntilExpiry computation', () => {
    it('daysUntilExpiry is approximately 365 for a cert expiring in 1 year', async () => {
      const now = new Date();
      const notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      const certRow = buildCertRow({ notAfter });
      const prisma = buildPrismaMock(certRow);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      const meta = await svc.getCertificateMetadata();
      expect(meta?.daysUntilExpiry).toBeGreaterThanOrEqual(364);
      expect(meta?.daysUntilExpiry).toBeLessThanOrEqual(366);
    });

    it('daysUntilExpiry is negative for an already-expired cert', async () => {
      const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const certRow = buildCertRow({ notAfter: pastDate });
      const prisma = buildPrismaMock(certRow);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      const meta = await svc.getCertificateMetadata();
      expect(meta?.daysUntilExpiry).toBeLessThan(0);
    });

    it('daysUntilExpiry is approximately 10 for near-expiry cert', async () => {
      const in10 = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const certRow = buildCertRow({ notAfter: in10 });
      const prisma = buildPrismaMock(certRow);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      const meta = await svc.getCertificateMetadata();
      expect(meta?.daysUntilExpiry).toBeGreaterThanOrEqual(9);
      expect(meta?.daysUntilExpiry).toBeLessThanOrEqual(11);
    });
  });

  // ── 4. Upload with invalid PEM inputs ──────────────────────────────────────

  describe('uploadCertificate — input validation', () => {
    it('throws BadRequest for garbage certPem', async () => {
      const prisma = buildPrismaMock(null);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await expect(
        svc.uploadCertificate({ certPem: 'not-a-cert', keyPem, isProduction: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequest for garbage keyPem', async () => {
      const prisma = buildPrismaMock(null);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await expect(
        svc.uploadCertificate({ certPem, keyPem: 'not-a-key', isProduction: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('encrypts cert and key separately (2 encrypt calls)', async () => {
      const prisma = buildPrismaMock(null);
      const crypto = buildCryptoMock();
      const svc = await buildService(prisma, crypto);

      await svc.uploadCertificate({ certPem, keyPem, isProduction: false });

      expect(crypto.encrypt).toHaveBeenCalledTimes(2);
    });
  });
});
