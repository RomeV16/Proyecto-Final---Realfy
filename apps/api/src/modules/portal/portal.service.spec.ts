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
            property: { id: 'p1', title: 'Depto Palermo', street: 'Gorriti', number: '4520' },
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
      expect(result[0].property).toEqual({ id: 'p1', name: 'Depto Palermo', address: 'Gorriti 4520' });
    });

    it('sin calle usa null como dirección para que la pantalla caiga en el título', async () => {
      tenantContext.getPersonId.mockReturnValue('person-1');
      prisma.client.contractPerson.findMany.mockResolvedValue([
        {
          contract: {
            id: 'c1',
            propertyId: 'p1',
            isActive: true,
            property: { id: 'p1', title: 'Local Centro', street: null, number: null },
            rentAmount: { toString: () => '100000' },
            adjustments: [],
            schedules: [],
          },
        },
      ]);

      const [contract] = await service.getContracts();
      expect(contract.property).toEqual({ id: 'p1', name: 'Local Centro', address: null });
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
