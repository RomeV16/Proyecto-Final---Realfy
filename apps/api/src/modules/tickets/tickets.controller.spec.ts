import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TICKET_ID = 't0000000-0000-0000-0000-000000000001';

const MOCK_TICKET = {
  id: TICKET_ID,
  status: 'Abierto',
  priority: 'media',
  title: 'Test ticket',
};

function buildMocks() {
  const ticketsService = {
    create: jest.fn().mockResolvedValue(MOCK_TICKET),
    findAll: jest.fn().mockResolvedValue({ items: [MOCK_TICKET], total: 1, page: 1, limit: 20 }),
    findOne: jest.fn().mockResolvedValue({ ...MOCK_TICKET, comments: [], validTransitions: ['En proceso'] }),
    update: jest.fn().mockResolvedValue({ ...MOCK_TICKET, priority: 'alta' }),
    transition: jest.fn().mockResolvedValue({ ...MOCK_TICKET, status: 'En proceso' }),
    assignProvider: jest.fn().mockResolvedValue({ ...MOCK_TICKET, providerId: 'prov-001' }),
    updateCost: jest.fn().mockResolvedValue({ ...MOCK_TICKET, estimatedCost: '5000.00' }),
    addComment: jest.fn().mockResolvedValue({ id: 'comment-001', text: 'Fixed', attachments: [] }),
    listComments: jest.fn().mockResolvedValue([{ id: 'comment-001', text: 'Fixed' }]),
  };
  return { ticketsService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TicketsController', () => {
  let controller: TicketsController;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TicketsController],
      providers: [{ provide: TicketsService, useValue: mocks.ticketsService }],
    })
      .overrideGuard(require('../../common/auth/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/auth/rbac.guard').RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TicketsController>(TicketsController);
  });

  // ─── POST /tickets ────────────────────────────────────────────────────────

  describe('POST /tickets', () => {
    it('creates and returns ticket', async () => {
      const body = { title: 'Test ticket', priority: 'media' };
      const result = await controller.create(body);
      expect(result).toMatchObject({ id: TICKET_ID, status: 'Abierto' });
      expect(mocks.ticketsService.create).toHaveBeenCalledWith(body);
    });
  });

  // ─── GET /tickets ─────────────────────────────────────────────────────────

  describe('GET /tickets', () => {
    it('returns paginated list', async () => {
      const result = await controller.findAll({});
      expect(result).toMatchObject({ items: [MOCK_TICKET], total: 1 });
    });

    it('coerces page and limit to numbers', async () => {
      await controller.findAll({ page: '2', limit: '10' });
      expect(mocks.ticketsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 10 }),
      );
    });
  });

  // ─── GET /tickets/:id ─────────────────────────────────────────────────────

  describe('GET /tickets/:id', () => {
    it('returns ticket detail with comments and valid transitions', async () => {
      const result = await controller.findOne(TICKET_ID);
      expect(result).toMatchObject({ id: TICKET_ID });
      expect(result).toHaveProperty('validTransitions');
    });

    it('propagates NotFoundException when ticket missing', async () => {
      mocks.ticketsService.findOne.mockRejectedValueOnce(new NotFoundException());
      await expect(controller.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── PATCH /tickets/:id ───────────────────────────────────────────────────

  describe('PATCH /tickets/:id', () => {
    it('updates ticket priority', async () => {
      const result = await controller.update(TICKET_ID, { priority: 'alta' });
      expect(result).toMatchObject({ priority: 'alta' });
    });
  });

  // ─── POST /tickets/:id/transition ─────────────────────────────────────────

  describe('POST /tickets/:id/transition', () => {
    it('transitions ticket to new status', async () => {
      const result = await controller.transition(TICKET_ID, { status: 'En proceso' });
      expect(result).toMatchObject({ status: 'En proceso' });
      expect(mocks.ticketsService.transition).toHaveBeenCalledWith(TICKET_ID, { status: 'En proceso' });
    });

    it('propagates error when invalid transition attempted', async () => {
      mocks.ticketsService.transition.mockRejectedValueOnce(new BadRequestException('Invalid transition'));
      await expect(controller.transition(TICKET_ID, { status: 'Invalid' })).rejects.toThrow(BadRequestException);
    });
  });

  // ─── POST /tickets/:id/assign-provider ───────────────────────────────────

  describe('POST /tickets/:id/assign-provider', () => {
    it('assigns provider to ticket', async () => {
      const result = await controller.assignProvider(TICKET_ID, { providerId: 'prov-001' });
      expect(result).toMatchObject({ providerId: 'prov-001' });
    });
  });

  // ─── PATCH /tickets/:id/cost ──────────────────────────────────────────────

  describe('PATCH /tickets/:id/cost', () => {
    it('updates cost tracking fields', async () => {
      const result = await controller.updateCost(TICKET_ID, { estimatedCost: '5000.00' });
      expect(result).toMatchObject({ estimatedCost: '5000.00' });
    });
  });

  // ─── POST /tickets/:id/comments ───────────────────────────────────────────

  describe('POST /tickets/:id/comments', () => {
    it('adds text comment without file', async () => {
      const result = await controller.addComment(TICKET_ID, { text: 'Fixed' }, undefined);
      expect(result).toMatchObject({ id: 'comment-001', text: 'Fixed' });
      expect(mocks.ticketsService.addComment).toHaveBeenCalledWith(TICKET_ID, { text: 'Fixed' }, undefined);
    });

    it('adds comment with image file', async () => {
      const mockFile = { buffer: Buffer.from('img'), mimetype: 'image/jpeg' } as Express.Multer.File;
      const result = await controller.addComment(TICKET_ID, { text: 'See photo' }, mockFile);
      expect(result).toHaveProperty('id');
    });
  });

  // ─── GET /tickets/:id/comments ────────────────────────────────────────────

  describe('GET /tickets/:id/comments', () => {
    it('returns comment list', async () => {
      const result = await controller.listComments(TICKET_ID);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toMatchObject({ id: 'comment-001' });
    });
  });
});
