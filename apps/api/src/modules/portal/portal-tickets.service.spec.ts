import { PortalTicketsService } from './portal-tickets.service';

describe('PortalTicketsService', () => {
  let service: PortalTicketsService;
  let prisma: any;
  let tenantContext: any;
  let media: any;
  let ticketNotifications: any;

  beforeEach(() => {
    prisma = {
      client: {
        contractPerson: { findMany: jest.fn() },
        ticket: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
        ticketCategory: { findMany: jest.fn(), findUnique: jest.fn() },
        ticketComment: { create: jest.fn() },
        ticketAttachment: { create: jest.fn() },
      },
    };
    tenantContext = {
      getPersonId: jest.fn(),
      getTenantId: jest.fn().mockReturnValue('tenant-1'),
    };
    media = { processAndUpload: jest.fn() };
    ticketNotifications = {
      notifyStaffOnNewTicket: jest.fn().mockResolvedValue(undefined),
      notifyOnComment: jest.fn().mockResolvedValue(undefined),
    };

    service = new PortalTicketsService(
      prisma,
      tenantContext,
      media,
      ticketNotifications,
    );
  });

  describe('getTickets', () => {
    it('returns an empty result when the inquilino has no accessible properties', async () => {
      tenantContext.getPersonId.mockReturnValue('person-1');
      prisma.client.contractPerson.findMany.mockResolvedValue([]);

      const result = await service.getTickets(1, 10);
      expect(result).toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
      });
      expect(prisma.client.ticket.findMany).not.toHaveBeenCalled();
    });

    it('queries tickets scoped to the inquilino properties', async () => {
      tenantContext.getPersonId.mockReturnValue('person-1');
      prisma.client.contractPerson.findMany.mockResolvedValue([
        { contract: { propertyId: 'p1', isActive: true } },
      ]);
      prisma.client.ticket.findMany.mockResolvedValue([{ id: 't1' }]);
      prisma.client.ticket.count.mockResolvedValue(1);

      const result = await service.getTickets(1, 10);
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(prisma.client.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { propertyId: { in: ['p1'] } } }),
      );
    });
  });

  describe('getCategories', () => {
    it('returns active categories for the tenant', async () => {
      prisma.client.ticketCategory.findMany.mockResolvedValue([
        { id: 'cat-1', name: 'Plomería', icon: null, color: null },
      ]);

      const result = await service.getCategories();
      expect(result).toHaveLength(1);
      expect(prisma.client.ticketCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });
  });
});
