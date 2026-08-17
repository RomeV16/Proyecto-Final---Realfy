import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { IssuersService } from './issuers.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { FiscalCondition } from '@realfy/shared';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-001';
const ISSUER_ID = 'issuer-001';

const VALID_CUIT = '20000000001'; // passes AFIP checksum
const VALID_CUIT_2 = '27000000014'; // different valid CUIT for contrast tests

const VALID_CREATE = {
  cuit: VALID_CUIT,
  businessName: 'Empresa SA',
  fiscalCondition: FiscalCondition.ResponsableInscripto,
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function buildPrismaMock(overrides: Partial<any> = {}) {
  return {
    client: {
      arcaIssuer: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: ISSUER_ID, ...VALID_CREATE, isSelf: false, isActive: true }),
        update: jest.fn().mockResolvedValue({ id: ISSUER_ID, isActive: false }),
      },
      arcaPuntoDeVenta: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'pdv-001', number: 1 }),
        delete: jest.fn().mockResolvedValue({ id: 'pdv-001' }),
      },
      comprobante: {
        count: jest.fn().mockResolvedValue(0),
      },
      tenant: {
        findFirst: jest.fn().mockResolvedValue({ id: TENANT_ID, cuit: null }),
      },
      ...overrides,
    },
  };
}

async function buildService(prismaMock: any): Promise<IssuersService> {
  const tenantContextMock = {
    getTenantId: jest.fn().mockReturnValue(TENANT_ID),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      IssuersService,
      { provide: PrismaService, useValue: prismaMock },
      { provide: TenantContextService, useValue: tenantContextMock },
    ],
  }).compile();

  return module.get<IssuersService>(IssuersService);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('IssuersService', () => {
  describe('createIssuer', () => {
    it('creates issuer with valid CUIT', async () => {
      const prisma = buildPrismaMock();
      const svc = await buildService(prisma);

      const result = await svc.createIssuer(VALID_CREATE);
      expect(result).toHaveProperty('id', ISSUER_ID);
      expect(prisma.client.arcaIssuer.create).toHaveBeenCalled();
    });

    it('throws BadRequest when CUIT checksum is invalid', async () => {
      const prisma = buildPrismaMock();
      const svc = await buildService(prisma);

      await expect(svc.createIssuer({ ...VALID_CREATE, cuit: '20-00000000-0' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws Conflict when CUIT already exists for tenant', async () => {
      const prisma = buildPrismaMock();
      prisma.client.arcaIssuer.findFirst = jest.fn().mockResolvedValue({ id: 'existing' });
      const svc = await buildService(prisma);

      await expect(svc.createIssuer(VALID_CREATE)).rejects.toThrow(ConflictException);
    });

    it('auto-flags isSelf=true when CUIT matches tenant.cuit', async () => {
      const prisma = buildPrismaMock();
      // Tenant has same CUIT as the issuer being created
      prisma.client.tenant.findFirst = jest.fn().mockResolvedValue({ id: TENANT_ID, cuit: VALID_CUIT });
      prisma.client.arcaIssuer.findFirst = jest.fn().mockResolvedValue(null);
      prisma.client.arcaIssuer.create = jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: ISSUER_ID, ...data }),
      );
      const svc = await buildService(prisma);

      const result = await svc.createIssuer(VALID_CREATE);
      expect(result.isSelf).toBe(true);
    });

    it('sets isSelf=false when CUIT does not match tenant.cuit', async () => {
      const prisma = buildPrismaMock();
      prisma.client.tenant.findFirst = jest.fn().mockResolvedValue({ id: TENANT_ID, cuit: VALID_CUIT_2 });
      prisma.client.arcaIssuer.findFirst = jest.fn().mockResolvedValue(null);
      prisma.client.arcaIssuer.create = jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: ISSUER_ID, ...data }),
      );
      const svc = await buildService(prisma);

      const result = await svc.createIssuer(VALID_CREATE);
      expect(result.isSelf).toBe(false);
    });
  });

  describe('deleteIssuer', () => {
    it('soft-deletes when no comprobantes exist', async () => {
      const prisma = buildPrismaMock();
      prisma.client.arcaIssuer.findFirst = jest.fn().mockResolvedValue({ id: ISSUER_ID });
      const svc = await buildService(prisma);

      await svc.deleteIssuer(ISSUER_ID);
      expect(prisma.client.arcaIssuer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
    });

    it('throws BadRequest when comprobantes exist', async () => {
      const prisma = buildPrismaMock();
      prisma.client.arcaIssuer.findFirst = jest.fn().mockResolvedValue({ id: ISSUER_ID });
      prisma.client.comprobante.count = jest.fn().mockResolvedValue(3);
      const svc = await buildService(prisma);

      await expect(svc.deleteIssuer(ISSUER_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFound when issuer does not exist', async () => {
      const prisma = buildPrismaMock();
      // findFirst returns null (issuer not found)
      const svc = await buildService(prisma);

      await expect(svc.deleteIssuer('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listIssuers', () => {
    it('returns active issuers for tenant', async () => {
      const prisma = buildPrismaMock();
      prisma.client.arcaIssuer.findMany = jest.fn().mockResolvedValue([
        { id: ISSUER_ID, isActive: true, puntosDeVenta: [] },
      ]);
      const svc = await buildService(prisma);

      const result = await svc.listIssuers();
      expect(result).toHaveLength(1);
    });
  });

  describe('PdV', () => {
    it('createPdv upserts PdV', async () => {
      const prisma = buildPrismaMock();
      prisma.client.arcaIssuer.findFirst = jest.fn().mockResolvedValue({ id: ISSUER_ID });
      const svc = await buildService(prisma);

      const result = await svc.createPdv(ISSUER_ID, { number: 1 });
      expect(result).toHaveProperty('number', 1);
    });

    it('createPdv throws NotFound when issuer missing', async () => {
      const prisma = buildPrismaMock();
      const svc = await buildService(prisma);
      await expect(svc.createPdv('bad-id', { number: 1 })).rejects.toThrow(NotFoundException);
    });

    it('deletePdv removes PdV', async () => {
      const prisma = buildPrismaMock();
      prisma.client.arcaPuntoDeVenta.findFirst = jest.fn().mockResolvedValue({ id: 'pdv-001' });
      const svc = await buildService(prisma);

      const result = await svc.deletePdv('pdv-001');
      expect(result).toHaveProperty('id', 'pdv-001');
    });

    it('deletePdv throws NotFound when PdV missing', async () => {
      const prisma = buildPrismaMock();
      const svc = await buildService(prisma);
      await expect(svc.deletePdv('bad-pdv')).rejects.toThrow(NotFoundException);
    });
  });
});
