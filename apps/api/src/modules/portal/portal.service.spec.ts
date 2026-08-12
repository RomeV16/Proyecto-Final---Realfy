import { ForbiddenException } from '@nestjs/common';
import { PortalService } from './portal.service';

describe('PortalService', () => {
  let service: PortalService;
  let prisma: any;
  let tenantContext: any;
  let liquidacionesService: any;

  beforeEach(() => {
    prisma = {
      client: {
        contractPerson: { findMany: jest.fn() },
        liquidacion: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
      },
    };
    tenantContext = { getPersonId: jest.fn() };
    liquidacionesService = { generatePdf: jest.fn() };

    service = new PortalService(prisma, tenantContext, liquidacionesService);
  });

  describe('getContracts', () => {
    it('throws ForbiddenException when there is no person context', async () => {
      tenantContext.getPersonId.mockReturnValue(undefined);
      await expect(service.getContracts()).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('returns only active contracts for the inquilino', async () => {
      tenantContext.getPersonId.mockReturnValue('person-1');
      prisma.client.contractPerson.findMany.mockResolvedValue([
        {
          contract: {
            id: 'c1',
            propertyId: 'p1',
            isActive: true,
            property: { id: 'p1', name: 'Depto', address: 'Calle 1' },
            contractType: 'Alquiler',
            status: 'Activo',
            startDate: new Date(),
            endDate: new Date(),
            rentAmount: { toString: () => '100000' },
            rentCurrency: 'ARS',
            adjustmentType: 'IPC',
            adjustmentPeriod: 3,
            adjustments: [],
            schedules: [],
          },
        },
        { contract: { id: 'c2', isActive: false } },
      ]);

      const result = await service.getContracts();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('c1');
    });
  });

  describe('getLiquidaciones', () => {
    it('returns an empty page when the inquilino has no contracts', async () => {
      tenantContext.getPersonId.mockReturnValue('person-1');
      prisma.client.contractPerson.findMany.mockResolvedValue([]);

      const result = await service.getLiquidaciones({ page: 1, limit: 20 });
      expect(result).toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
    });
  });
});
