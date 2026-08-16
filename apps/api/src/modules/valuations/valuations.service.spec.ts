import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ValuationsService } from './valuations.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

const TENANT_ID = 'tenant-abc';
const PROPERTY_ID = 'a0000000-0000-4000-8000-000000000001';

const MOCK_PROPERTY = {
  id: PROPERTY_ID,
  type: 'Departamento',
  city: 'Buenos Aires',
  rooms: 3,
  isActive: true,
};

function createMockPrismaService() {
  return {
    client: {
      propertyValuation: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      property: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    },
  } as unknown as PrismaService;
}

function createMockTenantContext() {
  return {
    getTenantId: jest.fn().mockReturnValue(TENANT_ID),
  } as unknown as TenantContextService;
}

describe('ValuationsService', () => {
  let service: ValuationsService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let tenantContext: ReturnType<typeof createMockTenantContext>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    tenantContext = createMockTenantContext();
    service = new ValuationsService(prisma as any, tenantContext as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── create — alta de tasación ──────────────────────────────────────────────

  describe('create', () => {
    beforeEach(() => {
      (prisma.client.property.findFirst as jest.Mock).mockResolvedValue(MOCK_PROPERTY);
    });

    it('creates a valuation scoped to the current tenant and given property', async () => {
      const created = { id: 'val-1', propertyId: PROPERTY_ID, tenantId: TENANT_ID };
      (prisma.client.propertyValuation.create as jest.Mock).mockResolvedValue(created);

      const result = await service.create(PROPERTY_ID, {
        valuationDate: '2026-01-15',
        value: 150000,
        currency: 'USD',
        method: 'Comparativo',
        appraiser: 'Juan Pérez',
      });

      expect(prisma.client.propertyValuation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          propertyId: PROPERTY_ID,
          tenantId: TENANT_ID,
          value: 150000,
          currency: 'USD',
          method: 'Comparativo',
          appraiser: 'Juan Pérez',
        }),
      });
      expect(result).toEqual(created);
    });

    it('defaults currency to ARS when not provided', async () => {
      (prisma.client.propertyValuation.create as jest.Mock).mockResolvedValue({ id: 'val-2' });

      await service.create(PROPERTY_ID, {
        valuationDate: '2026-01-15',
        value: 200000,
        method: 'Costo',
      });

      expect(prisma.client.propertyValuation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ currency: 'ARS' }),
      });
    });

    it('throws BadRequestException when value is not positive', async () => {
      await expect(
        service.create(PROPERTY_ID, {
          valuationDate: '2026-01-15',
          value: -10,
          method: 'Comparativo',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when method is missing', async () => {
      await expect(
        service.create(PROPERTY_ID, {
          valuationDate: '2026-01-15',
          value: 100000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the property does not exist', async () => {
      (prisma.client.property.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.create(PROPERTY_ID, {
          valuationDate: '2026-01-15',
          value: 100000,
          method: 'Comparativo',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findComparables ─────────────────────────────────────────────────────────

  describe('findComparables', () => {
    it('excludes the current property and filters by type/city/rooms ±1', async () => {
      (prisma.client.property.findFirst as jest.Mock).mockResolvedValue(MOCK_PROPERTY);
      (prisma.client.property.findMany as jest.Mock).mockResolvedValue([]);

      await service.findComparables(PROPERTY_ID);

      expect(prisma.client.property.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { not: PROPERTY_ID },
            type: MOCK_PROPERTY.type,
            isActive: true,
            city: { equals: MOCK_PROPERTY.city, mode: 'insensitive' },
            rooms: { gte: 2, lte: 4 },
          }),
        }),
      );
    });

    it('maps each comparable to include its latest valuation only', async () => {
      (prisma.client.property.findFirst as jest.Mock).mockResolvedValue(MOCK_PROPERTY);
      (prisma.client.property.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'comp-1',
          title: 'Depto comparable',
          type: 'Departamento',
          city: 'Buenos Aires',
          rooms: 3,
          area: 60,
          price: 120000,
          currency: 'USD',
          valuations: [{ value: 130000, currency: 'USD', valuationDate: '2026-02-01' }],
        },
      ]);

      const result = await service.findComparables(PROPERTY_ID);

      expect(result).toEqual([
        expect.objectContaining({
          id: 'comp-1',
          latestValuation: { value: 130000, currency: 'USD', valuationDate: '2026-02-01' },
        }),
      ]);
    });

    it('throws NotFoundException when the property does not exist', async () => {
      (prisma.client.property.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findComparables(PROPERTY_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── remove ──────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes an existing valuation', async () => {
      (prisma.client.propertyValuation.findFirst as jest.Mock).mockResolvedValue({ id: 'val-1' });
      (prisma.client.propertyValuation.delete as jest.Mock).mockResolvedValue({});

      const result = await service.remove(PROPERTY_ID, 'val-1');

      expect(prisma.client.propertyValuation.delete).toHaveBeenCalledWith({ where: { id: 'val-1' } });
      expect(result).toEqual({ deleted: true });
    });

    it('throws NotFoundException when the valuation does not belong to the property', async () => {
      (prisma.client.propertyValuation.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.remove(PROPERTY_ID, 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});
