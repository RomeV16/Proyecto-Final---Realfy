import { Test, TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { IssuersService } from './issuers.service';
import { CertificateService } from './certificate.service';
import { FiscalPdfService } from './fiscal-pdf.service';
import { ArcaService } from './arca/arca.service';
import { ArcaParamCacheService } from './arca/arca-param-cache.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { FiscalCondition } from '@realfy/shared';

// ─── Fixture helpers ─────────────────────────────────────────────────────────

const TENANT_ID = 'a0000000-0000-0000-0000-000000000000';
const ISSUER_ID = 'b0000000-0000-0000-0000-000000000001';

const VALID_RECEPTOR = {
  docTipo: 80,
  docNro: '20301234564',
  businessName: 'Empresa SA',
  fiscalCondition: FiscalCondition.ResponsableInscripto,
  condicionIVAReceptorId: 1,
};

/** Valid EmitInvoiceDto — concepto=1 (productos) so no service dates needed */
const VALID_EMIT_DTO = {
  issuerId: ISSUER_ID,
  ptoVta: 1,
  cbteTipo: 1,
  concepto: 1 as const,
  cbteFch: '2026-04-14',
  receptor: VALID_RECEPTOR,
  impTotal: '1210.00',
  impNeto: '1000.00',
  impIVA: '210.00',
  impTotConc: '0',
  impOpEx: '0',
  impTrib: '0',
};

/** Valid NC DTO — must include cbtesAsoc */
const VALID_NC_DTO = {
  ...VALID_EMIT_DTO,
  cbteTipo: 3, // Nota de Crédito A
  cbtesAsoc: [{ tipo: 1, ptoVta: 1, nro: 42 }],
};

const MOCK_COMPROBANTE = {
  id: 'cbte-001',
  tenantId: TENANT_ID,
  cae: '12345678901234',
  numero: 1,
};

// ─── Service mocks ────────────────────────────────────────────────────────────

function buildMocks() {
  const invoicesServiceMock = {
    previewEmitFromDto: jest.fn().mockResolvedValue({
      nextNumero: 1,
      payload: {},
      warnings: [],
    }),
    emitFromDto: jest.fn().mockResolvedValue({ comprobante: MOCK_COMPROBANTE, isIdempotentReplay: false }),
    emitNotaCreditoFromDto: jest.fn().mockResolvedValue({ comprobante: MOCK_COMPROBANTE, isIdempotentReplay: false }),
    findAll: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
    findOneWithLogs: jest.fn().mockResolvedValue({ ...MOCK_COMPROBANTE, arcaRequestLogs: [] }),
    voidComprobante: jest.fn().mockResolvedValue(MOCK_COMPROBANTE),
  };

  const issuersServiceMock = {
    listIssuers: jest.fn().mockResolvedValue([]),
    createIssuer: jest.fn().mockResolvedValue({ id: ISSUER_ID, cuit: '20301234564' }),
    updateIssuer: jest.fn().mockResolvedValue({ id: ISSUER_ID }),
    deleteIssuer: jest.fn().mockResolvedValue({ id: ISSUER_ID, isActive: false }),
    listPdv: jest.fn().mockResolvedValue([]),
    createPdv: jest.fn().mockResolvedValue({ id: 'pdv-001', number: 1 }),
    deletePdv: jest.fn().mockResolvedValue({ id: 'pdv-001' }),
  };

  const certificateServiceMock = {
    getCertificateMetadata: jest.fn().mockResolvedValue({
      id: 'cert-001',
      tenantId: TENANT_ID,
      commonName: 'Test CN',
      notBefore: new Date('2025-01-01'),
      notAfter: new Date('2026-01-01'),
      isProduction: false,
      isActive: true,
      daysUntilExpiry: 260,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    uploadCertificate: jest.fn().mockResolvedValue({ id: 'cert-001', commonName: 'Test CN' }),
    deleteCertificate: jest.fn().mockResolvedValue(undefined),
  };

  const fiscalPdfServiceMock = {
    generatePdfForComprobante: jest.fn().mockResolvedValue({ buffer: Buffer.from('pdf'), filename: 'cbte.pdf' }),
  };

  const arcaServiceMock = {
    verifyDelegation: jest.fn().mockResolvedValue({ ok: true }),
    syncPuntosDeVenta: jest.fn().mockResolvedValue([]),
    padronLookup: jest.fn().mockResolvedValue(null),
    healthcheck: jest.fn().mockResolvedValue({ afipUp: true, taValid: true }),
  };

  const arcaParamCacheMock = {
    get: jest.fn().mockResolvedValue([{ Id: 1, Desc: 'Factura A' }]),
  };

  const tenantContextMock = {
    getTenantId: jest.fn().mockReturnValue(TENANT_ID),
  };

  return { invoicesServiceMock, issuersServiceMock, certificateServiceMock, fiscalPdfServiceMock, arcaServiceMock, arcaParamCacheMock, tenantContextMock };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('InvoicesController', () => {
  let controller: InvoicesController;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvoicesController],
      providers: [
        { provide: InvoicesService, useValue: mocks.invoicesServiceMock },
        { provide: IssuersService, useValue: mocks.issuersServiceMock },
        { provide: CertificateService, useValue: mocks.certificateServiceMock },
        { provide: FiscalPdfService, useValue: mocks.fiscalPdfServiceMock },
        { provide: ArcaService, useValue: mocks.arcaServiceMock },
        { provide: ArcaParamCacheService, useValue: mocks.arcaParamCacheMock },
        { provide: TenantContextService, useValue: mocks.tenantContextMock },
      ],
    })
      .overrideGuard(require('../../common/auth/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/auth/rbac.guard').RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<InvoicesController>(InvoicesController);
  });

  // ─── Preview ───────────────────────────────────────────────────────────────

  describe('POST /invoices/preview', () => {
    it('returns nextNumero + payload + warnings on happy path', async () => {
      const result = await controller.previewEmit(VALID_EMIT_DTO as any);
      expect(result).toMatchObject({ nextNumero: 1, payload: {}, warnings: [] });
      expect(mocks.invoicesServiceMock.previewEmitFromDto).toHaveBeenCalledWith(
        expect.objectContaining({ issuerId: ISSUER_ID }),
      );
    });
  });

  // ─── Emit happy path ───────────────────────────────────────────────────────

  describe('POST /invoices/emit', () => {
    it('returns comprobante on happy path', async () => {
      const mockRes = { setHeader: jest.fn() } as any;
      const result = await controller.emitInvoice(VALID_EMIT_DTO, mockRes);
      expect(result).toMatchObject({ id: 'cbte-001' });
      expect(mocks.invoicesServiceMock.emitFromDto).toHaveBeenCalled();
    });

    it('sets X-Idempotent-Replay header when duplicate clientRequestId', async () => {
      mocks.invoicesServiceMock.emitFromDto.mockResolvedValueOnce({
        comprobante: MOCK_COMPROBANTE,
        isIdempotentReplay: true,
      });
      const mockRes = { setHeader: jest.fn() } as any;
      await controller.emitInvoice(
        { ...VALID_EMIT_DTO, clientRequestId: 'c0000000-0000-0000-0000-000000000001' },
        mockRes,
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Idempotent-Replay', 'true');
    });

    it('throws 422 when impTotal mismatches sum of parts', async () => {
      const bad = { ...VALID_EMIT_DTO, impTotal: '9999.00' }; // intentionally wrong
      const mockRes = { setHeader: jest.fn() } as any;
      await expect(controller.emitInvoice(bad, mockRes)).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws 422 when concepto=2 but service dates missing', async () => {
      const bad = { ...VALID_EMIT_DTO, concepto: 2 }; // no fchServDesde etc.
      const mockRes = { setHeader: jest.fn() } as any;
      await expect(controller.emitInvoice(bad, mockRes)).rejects.toThrow(UnprocessableEntityException);
    });
  });

  // ─── Emit NC ───────────────────────────────────────────────────────────────

  describe('POST /invoices/emit-nc', () => {
    it('returns NC comprobante on happy path', async () => {
      const mockRes = { setHeader: jest.fn() } as any;
      const result = await controller.emitNotaCredito(VALID_NC_DTO, mockRes);
      expect(result).toMatchObject({ id: 'cbte-001' });
    });

    it('throws 422 when cbtesAsoc is empty', async () => {
      const bad = { ...VALID_NC_DTO, cbtesAsoc: [] };
      const mockRes = { setHeader: jest.fn() } as any;
      await expect(controller.emitNotaCredito(bad, mockRes)).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws 422 when cbtesAsoc is absent', async () => {
      const bad = { ...VALID_EMIT_DTO }; // no cbtesAsoc
      const mockRes = { setHeader: jest.fn() } as any;
      await expect(controller.emitNotaCredito(bad, mockRes)).rejects.toThrow(UnprocessableEntityException);
    });

    it('sets X-Idempotent-Replay header on NC duplicate', async () => {
      mocks.invoicesServiceMock.emitNotaCreditoFromDto.mockResolvedValueOnce({
        comprobante: MOCK_COMPROBANTE,
        isIdempotentReplay: true,
      });
      const mockRes = { setHeader: jest.fn() } as any;
      await controller.emitNotaCredito(VALID_NC_DTO, mockRes);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Idempotent-Replay', 'true');
    });
  });

  // ─── List ─────────────────────────────────────────────────────────────────

  describe('GET /invoices', () => {
    it('returns paginated list', async () => {
      const result = await controller.findAll({});
      expect(result).toMatchObject({ items: [], total: 0 });
    });
  });

  // ─── Certificate ──────────────────────────────────────────────────────────

  describe('Certificate routes', () => {
    it('GET /certificate returns metadata without key material', async () => {
      const result = await controller.getCertificate();
      expect(result).not.toHaveProperty('certEncrypted');
      expect(result).not.toHaveProperty('keyEncrypted');
      expect(result).toHaveProperty('commonName');
      expect(result).toHaveProperty('daysUntilExpiry');
    });

    it('POST /certificate parses correctly', async () => {
      const body = {
        certPem: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
        keyPem: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
        isProduction: false,
      };
      const result = await controller.uploadCertificate(body);
      expect(result).toHaveProperty('commonName', 'Test CN');
      expect(mocks.certificateServiceMock.uploadCertificate).toHaveBeenCalledWith(
        expect.objectContaining({ certPem: body.certPem, keyPem: body.keyPem }),
      );
    });

    it('POST /certificate throws 422 when certPem missing', async () => {
      await expect(
        controller.uploadCertificate({ keyPem: 'key', isProduction: false }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('DELETE /certificate calls service', async () => {
      await controller.deleteCertificate();
      expect(mocks.certificateServiceMock.deleteCertificate).toHaveBeenCalledWith(false);
    });

    it('DELETE /certificate with ?force=true passes force=true', async () => {
      await controller.deleteCertificate('true');
      expect(mocks.certificateServiceMock.deleteCertificate).toHaveBeenCalledWith(true);
    });
  });

  // ─── Issuers ──────────────────────────────────────────────────────────────

  describe('Issuer routes', () => {
    const VALID_ISSUER_BODY = {
      cuit: '20000000001', // passes AFIP checksum
      businessName: 'Empresa SA',
      fiscalCondition: FiscalCondition.ResponsableInscripto,
    };

    it('GET /issuers returns list', async () => {
      const result = await controller.listIssuers();
      expect(Array.isArray(result)).toBe(true);
    });

    it('POST /issuers creates issuer', async () => {
      const result = await controller.createIssuer(VALID_ISSUER_BODY as any);
      expect(result).toHaveProperty('id', ISSUER_ID);
      expect(mocks.issuersServiceMock.createIssuer).toHaveBeenCalled();
    });

    it('POST /issuers throws 422 when body invalid', async () => {
      await expect(controller.createIssuer({} as any)).rejects.toThrow(UnprocessableEntityException);
    });

    it('PATCH /issuers/:id updates issuer', async () => {
      const result = await controller.updateIssuer(ISSUER_ID, { businessName: 'New Name' } as any);
      expect(result).toHaveProperty('id', ISSUER_ID);
    });

    it('DELETE /issuers/:id soft-deletes issuer', async () => {
      const result = await controller.deleteIssuer(ISSUER_ID);
      expect(result).toMatchObject({ isActive: false });
    });
  });

  // ─── PdV routes ───────────────────────────────────────────────────────────

  describe('PdV routes', () => {
    it('GET /issuers/:id/pdv returns list', async () => {
      const result = await controller.listPdv(ISSUER_ID);
      expect(Array.isArray(result)).toBe(true);
    });

    it('POST /issuers/:id/pdv creates pdv', async () => {
      const result = await controller.createPdv(ISSUER_ID, { number: 1 } as any);
      expect(result).toHaveProperty('number', 1);
    });

    it('POST /issuers/:id/pdv throws 422 when number missing', async () => {
      await expect(controller.createPdv(ISSUER_ID, {} as any)).rejects.toThrow(UnprocessableEntityException);
    });

    it('DELETE /pdv/:id removes pdv', async () => {
      const result = await controller.deletePdv('pdv-001');
      expect(result).toHaveProperty('id', 'pdv-001');
    });
  });

  // ─── Delegation + sync ────────────────────────────────────────────────────

  describe('POST /issuers/:id/verify-delegation', () => {
    it('calls arcaService.verifyDelegation', async () => {
      const result = await controller.verifyDelegation(ISSUER_ID);
      expect(result).toMatchObject({ ok: true });
      expect(mocks.arcaServiceMock.verifyDelegation).toHaveBeenCalledWith(TENANT_ID, ISSUER_ID);
    });
  });

  describe('POST /issuers/:id/sync-pdv', () => {
    it('calls arcaService.syncPuntosDeVenta', async () => {
      const result = await controller.syncPdv(ISSUER_ID);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── Healthcheck ──────────────────────────────────────────────────────────

  describe('GET /invoices/healthcheck', () => {
    it('returns arca status and cert info', async () => {
      const result = await controller.healthcheck();
      expect(result).toMatchObject({ afipUp: true, taValid: true });
      expect(result).toHaveProperty('certificate');
    });
  });

  // ─── Param cache ──────────────────────────────────────────────────────────

  describe('GET /invoices/param-cache/:type', () => {
    it('returns cached data for tiposCbte', async () => {
      mocks.issuersServiceMock.listIssuers.mockResolvedValueOnce([
        { id: ISSUER_ID, cuit: '20301234564', isActive: true },
      ]);

      const result = await controller.getParamCache('tiposCbte');

      expect(result).toMatchObject({ type: 'tiposCbte' });
      expect(result).toHaveProperty('data');
      expect(mocks.arcaParamCacheMock.get).toHaveBeenCalledWith(
        'voucherTypes',
        TENANT_ID,
        ISSUER_ID,
        '20301234564',
      );
    });

    it('returns cached data for tiposDoc', async () => {
      mocks.issuersServiceMock.listIssuers.mockResolvedValueOnce([
        { id: ISSUER_ID, cuit: '20301234564', isActive: true },
      ]);

      const result = await controller.getParamCache('tiposDoc');
      expect(result).toMatchObject({ type: 'tiposDoc' });
    });

    it('returns cached data for tiposIva', async () => {
      mocks.issuersServiceMock.listIssuers.mockResolvedValueOnce([
        { id: ISSUER_ID, cuit: '20301234564', isActive: true },
      ]);

      const result = await controller.getParamCache('tiposIva');
      expect(result).toMatchObject({ type: 'tiposIva' });
    });

    it('returns cached data for condicionIvaReceptor', async () => {
      mocks.issuersServiceMock.listIssuers.mockResolvedValueOnce([
        { id: ISSUER_ID, cuit: '20301234564', isActive: true },
      ]);

      const result = await controller.getParamCache('condicionIvaReceptor');
      expect(result).toMatchObject({ type: 'condicionIvaReceptor' });
    });

    it('uses provided issuerId query param', async () => {
      mocks.issuersServiceMock.listIssuers.mockResolvedValueOnce([
        { id: 'other-issuer', cuit: '20111111113', isActive: true },
        { id: ISSUER_ID, cuit: '20301234564', isActive: true },
      ]);

      await controller.getParamCache('tiposCbte', ISSUER_ID);

      expect(mocks.arcaParamCacheMock.get).toHaveBeenCalledWith(
        'voucherTypes',
        TENANT_ID,
        ISSUER_ID,
        '20301234564',
      );
    });

    it('throws 422 for unknown param type', async () => {
      await expect(controller.getParamCache('unknown')).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws 422 when no active issuers exist', async () => {
      mocks.issuersServiceMock.listIssuers.mockResolvedValueOnce([]);

      await expect(controller.getParamCache('tiposCbte')).rejects.toThrow(UnprocessableEntityException);
    });
  });

  // ─── Padrón lookup ────────────────────────────────────────────────────────

  describe('GET /invoices/padron/:cuit', () => {
    it('calls arcaService.padronLookup with correct args', async () => {
      mocks.arcaServiceMock.padronLookup.mockResolvedValueOnce({
        businessName: 'TEST SA',
        fiscalCondition: 'ResponsableInscripto',
      });

      const result = await controller.padronLookup('20111111113', ISSUER_ID);
      expect(result).toMatchObject({ businessName: 'TEST SA' });
      expect(mocks.arcaServiceMock.padronLookup).toHaveBeenCalledWith(
        TENANT_ID,
        ISSUER_ID,
        '20111111113',
      );
    });

    it('returns null when CUIT not found', async () => {
      const result = await controller.padronLookup('99999999999', ISSUER_ID);
      expect(result).toBeNull();
    });

    it('throws 422 when issuerId not provided', async () => {
      await expect(controller.padronLookup('20111111113', undefined)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });
});
