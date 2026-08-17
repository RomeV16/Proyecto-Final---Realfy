import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as forge from 'node-forge';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { CryptoService } from '../../common/crypto/crypto.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CertificateMetadata {
  id: string;
  tenantId: string;
  commonName: string;
  notBefore: Date;
  notAfter: Date;
  isProduction: boolean;
  isActive: boolean;
  daysUntilExpiry: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UploadCertificateInput {
  /** PEM-encoded certificate */
  certPem: string;
  /** PEM-encoded private key */
  keyPem: string;
  isProduction: boolean;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly cryptoService: CryptoService,
  ) {}

  // ─── Upload ───────────────────────────────────────────────────────────────

  async uploadCertificate(input: UploadCertificateInput): Promise<CertificateMetadata> {
    const tenantId = this.tenantContext.getTenantId()!;

    // Validate it's real X.509
    let cert: forge.pki.Certificate;
    try {
      cert = forge.pki.certificateFromPem(input.certPem);
    } catch (err) {
      throw new BadRequestException({
        error: 'INVALID_CERTIFICATE',
        message: 'certPem is not a valid X.509 PEM certificate',
      });
    }

    // Validate private key PEM
    try {
      // forge doesn't expose a direct validator, but decryptRsaPrivateKey or privateKeyFromPem will throw
      forge.pki.privateKeyFromPem(input.keyPem);
    } catch (err) {
      throw new BadRequestException({
        error: 'INVALID_PRIVATE_KEY',
        message: 'keyPem is not a valid PEM private key',
      });
    }

    const commonName = (cert.subject.getField('CN')?.value as string) ?? '';
    const notBefore = cert.validity.notBefore;
    const notAfter = cert.validity.notAfter;

    // Encrypt cert + key
    const certBuf = Buffer.from(input.certPem, 'utf8');
    const keyBuf = Buffer.from(input.keyPem, 'utf8');

    const certBlob = await this.cryptoService.encrypt(certBuf);
    // Combine key into same DEK wrapping (store cert ciphertext, key in separate Bytes columns)
    // The schema uses certEncrypted + keyEncrypted + dekWrapped — we'll use one DEK for cert
    // and encrypt key separately
    const keyBlob = await this.cryptoService.encrypt(keyBuf);

    // Upsert (one cert per tenant)
    const existing = await this.prisma.client.arcaCertificate.findFirst({
      where: { tenantId },
    });

    const certData: any = {
      commonName,
      notBefore,
      notAfter,
      isProduction: input.isProduction,
      isActive: true,
      certEncrypted: certBlob.ciphertext,
      keyEncrypted: keyBlob.ciphertext,
      dekWrapped: certBlob.dek_wrapped,
      kekVersion: 1,
    };

    let row: any;
    if (existing) {
      row = await this.prisma.client.arcaCertificate.update({
        where: { id: existing.id },
        data: certData,
      });
    } else {
      row = await this.prisma.client.arcaCertificate.create({
        data: { tenantId, ...certData },
      });
    }

    this.logger.log('Certificate uploaded', { tenantId, commonName, isProduction: input.isProduction });

    return this.toMetadata(row);
  }

  // ─── Metadata (no key material) ──────────────────────────────────────────

  async getCertificateMetadata(): Promise<CertificateMetadata | null> {
    const tenantId = this.tenantContext.getTenantId()!;

    const row = await this.prisma.client.arcaCertificate.findFirst({
      where: { tenantId },
    });

    if (!row) return null;

    return this.toMetadata(row);
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  async deleteCertificate(force = false): Promise<void> {
    const tenantId = this.tenantContext.getTenantId()!;

    const row = await this.prisma.client.arcaCertificate.findFirst({
      where: { tenantId },
    });
    if (!row) {
      throw new NotFoundException({ error: 'CERT_NOT_FOUND', message: 'No certificate found for tenant' });
    }

    if (!force) {
      // Block if any issuers are Active
      const activeIssuerCount = await this.prisma.client.arcaIssuer.count({
        where: { tenantId, isActive: true, delegationStatus: 'Active' },
      });
      if (activeIssuerCount > 0) {
        throw new BadRequestException({
          error: 'CERT_IN_USE',
          message: `Cannot delete certificate: ${activeIssuerCount} issuer(s) have Active delegation. Pass ?force=true to override.`,
        });
      }
    }

    await this.prisma.client.arcaCertificate.delete({ where: { id: row.id } });
    this.logger.log('Certificate deleted', { tenantId, certId: row.id, force });
  }

  // ─── Helper ───────────────────────────────────────────────────────────────

  private toMetadata(row: any): CertificateMetadata {
    const now = new Date();
    const daysUntilExpiry = Math.floor(
      (new Date(row.notAfter).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    return {
      id: row.id,
      tenantId: row.tenantId,
      commonName: row.commonName,
      notBefore: row.notBefore,
      notAfter: row.notAfter,
      isProduction: row.isProduction,
      isActive: row.isActive,
      daysUntilExpiry,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
