/**
 * InvoicesService — edge-case unit tests.
 *
 * Covers:
 * 1. clientRequestId replay returns same Comprobante, no second AFIP call.
 * 2. RG 5616/2024 — condicionIVAReceptorId absence caught by Zod.
 * 3. impTotal mismatch caught by Zod refinement.
 * 4. NC idempotency replay.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { ArcaService } from './arca/arca.service';
import { FiscalCondition } from '@realfy/shared';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-svc-extra';
const ISSUER_ID = '00000000-0000-0000-0000-000000000001'; // Must be valid UUID for Zod schema

const VALID_RECEPTOR = {
  docTipo: 80,
  docNro: '20301234564',
  businessName: 'Empresa SA',
  fiscalCondition: FiscalCondition.ResponsableInscripto,
  condicionIVAReceptorId: 1,
};

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

const MOCK_COMPROBANTE = {
  id: 'cbte-svc-001',
  tenantId: TENANT_ID,
  cae: '12345678901234',
  caeFchVto: new Date('2026-12-31'),
  numero: 1,
  clientRequestId: 'req-001',
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function buildMockIssuer(overrides: any = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    tenantId: TENANT_ID,
    cuit: '20-11111111-1',
    businessName: 'Agency SA',
    fiscalCondition: FiscalCondition.ResponsableInscripto,
    delegationStatus: 'Active',
    isActive: true,
    ...overrides,
  };
}

function buildPrismaMock(overrides: any = {}) {
  return {
    client: {
      arcaIssuer: {
        findFirst: jest.fn().mockResolvedValue(buildMockIssuer()),
      },
      arcaPuntoDeVenta: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pdv-001', number: 1, bloqueado: false }),
      },
      comprobante: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(MOCK_COMPROBANTE),
      },
      ...overrides,
    },
  };
}

async function buildService(prisma: any, arca: any): Promise<InvoicesService> {
  const tenantContextMock = {
    getTenantId: jest.fn().mockReturnValue(TENANT_ID),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      InvoicesService,
      { provide: PrismaService, useValue: prisma },
      { provide: TenantContextService, useValue: tenantContextMock },
      { provide: ArcaService, useValue: arca },
    ],
  }).compile();
  return module.get<InvoicesService>(InvoicesService);
}

function buildArcaMock(overrides: any = {}) {
  return {
    emit: jest.fn().mockResolvedValue({ cae: '12345678901234', caeFchVto: '2026-12-31', numero: 1, raw: {} }),
    emitNotaCredito: jest.fn().mockResolvedValue({ cae: '99999999901234', caeFchVto: '2026-12-31', numero: 2, raw: {} }),
    getLastVoucher: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('InvoicesService — edge cases', () => {

  // ── 1. Idempotency: clientRequestId replay ─────────────────────────────────

  describe('emitFromDto — clientRequestId idempotency', () => {
    it('returns existing comprobante without calling ArcaService.emit when clientRequestId already seen', async () => {
      const prisma = buildPrismaMock();
      const arca = buildArcaMock();
      // Simulate DB already has a comprobante with this clientRequestId
      prisma.client.comprobante.findFirst = jest.fn().mockResolvedValue(MOCK_COMPROBANTE);

      const svc = await buildService(prisma, arca);

      const dto = { ...VALID_EMIT_DTO, clientRequestId: 'req-001' };
      const result = await svc.emitFromDto(dto as any);

      expect(result.isIdempotentReplay).toBe(true);
      expect(result.comprobante.id).toBe('cbte-svc-001');
      // AFIP must NOT be called again
      expect(arca.emit).not.toHaveBeenCalled();
    });

    it('idempotent replay returns the same cae and numero as original', async () => {
      const prisma = buildPrismaMock();
      const arca = buildArcaMock();
      prisma.client.comprobante.findFirst = jest.fn().mockResolvedValue(MOCK_COMPROBANTE);

      const svc = await buildService(prisma, arca);

      const result = await svc.emitFromDto({ ...VALID_EMIT_DTO, clientRequestId: 'req-001' } as any);

      expect(result.comprobante.cae).toBe('12345678901234');
      expect(result.comprobante.numero).toBe(1);
    });

    it('does not replay when no clientRequestId is provided', async () => {
      const prisma = buildPrismaMock();
      const arca = buildArcaMock();
      // findFirst returns null — no match
      prisma.client.comprobante.findFirst = jest.fn().mockResolvedValue(null);

      const svc = await buildService(prisma, arca);

      const result = await svc.emitFromDto(VALID_EMIT_DTO as any);

      expect(result.isIdempotentReplay).toBe(false);
      expect(arca.emit).toHaveBeenCalledTimes(1);
    });

    it('two different clientRequestIds result in two separate AFIP calls', async () => {
      const prisma = buildPrismaMock();
      const arca = buildArcaMock();
      // Always return null → no existing comprobante
      prisma.client.comprobante.findFirst = jest.fn().mockResolvedValue(null);

      const svc = await buildService(prisma, arca);

      await svc.emitFromDto({ ...VALID_EMIT_DTO, clientRequestId: 'req-AAA' } as any);
      await svc.emitFromDto({ ...VALID_EMIT_DTO, clientRequestId: 'req-BBB' } as any);

      expect(arca.emit).toHaveBeenCalledTimes(2);
    });
  });

  // ── 2. RG 5616/2024 — condicionIVAReceptorId required ─────────────────────
  // The Zod schema in EmitInvoiceDtoSchema enforces condicionIVAReceptorId: z.number().int()
  // The controller calls EmitInvoiceDtoSchema.safeParse before calling service.
  // The service's emitFromDto works with already-parsed DTO, so Zod validation
  // is enforced at the controller boundary (see invoices.controller.spec.ts).
  // These tests verify that our shared schema rejects missing field.

  describe('RG 5616/2024 — EmitInvoiceDtoSchema requires condicionIVAReceptorId', () => {
    it('EmitInvoiceDtoSchema rejects receptor without condicionIVAReceptorId', async () => {
      // Import the schema directly to test it standalone
      const { EmitInvoiceDtoSchema } = await import('@realfy/shared');

      const dtoWithoutCondicion = {
        ...VALID_EMIT_DTO,
        receptor: {
          docTipo: 80,
          docNro: '20301234564',
          businessName: 'Empresa SA',
          fiscalCondition: FiscalCondition.ResponsableInscripto,
          // condicionIVAReceptorId is MISSING
        },
      };

      const result = EmitInvoiceDtoSchema.safeParse(dtoWithoutCondicion);
      expect(result.success).toBe(false);
      if (!result.success) {
        const fieldErrors = result.error.errors.map((e) => e.path.join('.'));
        expect(fieldErrors.some((p) => p.includes('condicionIVAReceptorId'))).toBe(true);
      }
    });

    it('EmitInvoiceDtoSchema accepts receptor with condicionIVAReceptorId', async () => {
      const { EmitInvoiceDtoSchema } = await import('@realfy/shared');

      const result = EmitInvoiceDtoSchema.safeParse(VALID_EMIT_DTO);
      expect(result.success).toBe(true);
    });

    it('EmitInvoiceDtoSchema rejects condicionIVAReceptorId as string (type safety)', async () => {
      const { EmitInvoiceDtoSchema } = await import('@realfy/shared');

      const dtoWithStringCondicion = {
        ...VALID_EMIT_DTO,
        receptor: { ...VALID_RECEPTOR, condicionIVAReceptorId: '1' }, // string, not int
      };

      const result = EmitInvoiceDtoSchema.safeParse(dtoWithStringCondicion);
      expect(result.success).toBe(false);
    });
  });

  // ── 3. impTotal mismatch — Zod refinement ──────────────────────────────────

  describe('EmitInvoiceDtoSchema — impTotal mismatch refinement', () => {
    it('rejects when impTotal does not match sum of parts', async () => {
      const { EmitInvoiceDtoSchema } = await import('@realfy/shared');

      const badDto = {
        ...VALID_EMIT_DTO,
        impTotal: '9999.00', // intentionally wrong
        impNeto: '1000.00',
        impIVA: '210.00',
      };

      const result = EmitInvoiceDtoSchema.safeParse(badDto);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toMatch(/mismatch/i);
      }
    });

    it('accepts when impTotal exactly matches sum within 0.01 tolerance', async () => {
      const { EmitInvoiceDtoSchema } = await import('@realfy/shared');

      const goodDto = {
        ...VALID_EMIT_DTO,
        impTotal: '1210.00',
        impNeto: '1000.00',
        impIVA: '210.00',
        impTotConc: '0',
        impOpEx: '0',
        impTrib: '0',
      };

      const result = EmitInvoiceDtoSchema.safeParse(goodDto);
      expect(result.success).toBe(true);
    });

    it('catches floating point drift — refuses obvious summation errors', async () => {
      const { EmitInvoiceDtoSchema } = await import('@realfy/shared');

      const driftDto = {
        ...VALID_EMIT_DTO,
        impTotal: '1210.05',  // 0.05 over — beyond 0.01 tolerance
        impNeto: '1000.00',
        impIVA: '210.00',
      };

      const result = EmitInvoiceDtoSchema.safeParse(driftDto);
      expect(result.success).toBe(false);
    });
  });

  // ── 4. NC emitNotaCreditoFromDto idempotency ────────────────────────────────

  describe('emitNotaCreditoFromDto — clientRequestId idempotency', () => {
    it('returns existing NC comprobante without calling ArcaService when clientRequestId seen', async () => {
      const ncComprobante = { ...MOCK_COMPROBANTE, id: 'nc-cbte-001', cbteTipo: 3 };
      const prisma = buildPrismaMock();
      const arca = buildArcaMock();
      prisma.client.comprobante.findFirst = jest.fn().mockResolvedValue(ncComprobante);

      const svc = await buildService(prisma, arca);

      const ncDto = {
        ...VALID_EMIT_DTO,
        cbteTipo: 3,
        concepto: 2 as const,
        fchServDesde: '2026-04-01',
        fchServHasta: '2026-04-30',
        fchVtoPago: '2026-04-30',
        cbtesAsoc: [{ tipo: 1, ptoVta: 1, nro: 1 }],
        clientRequestId: 'nc-req-001',
      };

      const result = await svc.emitNotaCreditoFromDto(ncDto as any);

      expect(result.isIdempotentReplay).toBe(true);
      expect(result.comprobante.id).toBe('nc-cbte-001');
      expect(arca.emitNotaCredito).not.toHaveBeenCalled();
    });
  });

  // ── 5. resolveIssuerContext fallback ────────────────────────────────────────

  describe('resolveIssuerContext', () => {
    it('throws BadRequest when no issuerId provided and no self-issuer exists', async () => {
      const prisma = buildPrismaMock();
      prisma.client.arcaIssuer.findFirst = jest.fn().mockResolvedValue(null);
      const arca = buildArcaMock();
      const svc = await buildService(prisma, arca);

      const dtoWithoutIssuerId = {
        ...VALID_EMIT_DTO,
        issuerId: undefined,
      };

      await expect(svc.emitFromDto(dtoWithoutIssuerId as any)).rejects.toThrow(BadRequestException);
    });
  });
});
