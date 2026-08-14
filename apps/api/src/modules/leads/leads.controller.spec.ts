import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LEAD_ID = 'l0000000-0000-0000-0000-000000000001';

const MOCK_LEAD = {
  id: LEAD_ID,
  status: 'active',
  isActive: true,
  source: 'web',
};

function buildMocks() {
  const leadsService = {
    findAll: jest.fn().mockResolvedValue({ items: [MOCK_LEAD], total: 1, page: 1, limit: 20 }),
    findOne: jest.fn().mockResolvedValue(MOCK_LEAD),
    create: jest.fn().mockResolvedValue(MOCK_LEAD),
    update: jest.fn().mockResolvedValue({ ...MOCK_LEAD, source: 'referral' }),
    moveStage: jest.fn().mockResolvedValue({ ...MOCK_LEAD, stageId: 'stage-002' }),
    assign: jest.fn().mockResolvedValue({ ...MOCK_LEAD, assignedToId: 'user-002' }),
    convert: jest.fn().mockResolvedValue({ lead: MOCK_LEAD, person: { id: 'person-001' } }),
    lose: jest.fn().mockResolvedValue({ ...MOCK_LEAD, status: 'lost', lostReason: 'price' }),
    remove: jest.fn().mockResolvedValue({ ...MOCK_LEAD, isActive: false }),
  };
  return { leadsService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LeadsController', () => {
  let controller: LeadsController;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeadsController],
      providers: [{ provide: LeadsService, useValue: mocks.leadsService }],
    })
      .overrideGuard(require('../../common/auth/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/auth/rbac.guard').RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<LeadsController>(LeadsController);
  });

  // ─── GET /leads ───────────────────────────────────────────────────────────

  describe('GET /leads', () => {
    it('returns paginated list on happy path', async () => {
      const result = await controller.findAll({});
      expect(result).toMatchObject({ items: [MOCK_LEAD], total: 1 });
    });

    it('coerces isActive string "true" to boolean', async () => {
      await controller.findAll({ isActive: 'true' });
      expect(mocks.leadsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true }),
      );
    });

    it('coerces isActive string "false" to boolean false', async () => {
      await controller.findAll({ isActive: 'false' });
      expect(mocks.leadsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  // ─── GET /leads/:id ───────────────────────────────────────────────────────

  describe('GET /leads/:id', () => {
    it('returns lead detail on happy path', async () => {
      const result = await controller.findOne(LEAD_ID);
      expect(result).toMatchObject({ id: LEAD_ID });
    });

    it('propagates NotFoundException when lead missing', async () => {
      mocks.leadsService.findOne.mockRejectedValueOnce(new NotFoundException());
      await expect(controller.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── POST /leads ──────────────────────────────────────────────────────────

  describe('POST /leads', () => {
    it('creates and returns lead', async () => {
      const body = { source: 'web', personId: 'person-001' };
      const result = await controller.create(body);
      expect(result).toMatchObject({ id: LEAD_ID });
      expect(mocks.leadsService.create).toHaveBeenCalledWith(body);
    });
  });

  // ─── PATCH /leads/:id ─────────────────────────────────────────────────────

  describe('PATCH /leads/:id', () => {
    it('updates and returns modified lead', async () => {
      const result = await controller.update(LEAD_ID, { source: 'referral' });
      expect(result).toMatchObject({ source: 'referral' });
    });
  });

  // ─── PATCH /leads/:id/stage ───────────────────────────────────────────────

  describe('PATCH /leads/:id/stage', () => {
    it('moves lead to a new stage', async () => {
      const result = await controller.moveStage(LEAD_ID, { stageId: 'stage-002' });
      expect(result).toMatchObject({ stageId: 'stage-002' });
      expect(mocks.leadsService.moveStage).toHaveBeenCalledWith(LEAD_ID, { stageId: 'stage-002' });
    });
  });

  // ─── PATCH /leads/:id/assign ──────────────────────────────────────────────

  describe('PATCH /leads/:id/assign', () => {
    it('assigns lead to a user', async () => {
      const result = await controller.assign(LEAD_ID, { userId: 'user-002' });
      expect(result).toMatchObject({ assignedToId: 'user-002' });
    });
  });

  // ─── POST /leads/:id/convert ──────────────────────────────────────────────

  describe('POST /leads/:id/convert', () => {
    it('converts lead and returns person', async () => {
      const result = await controller.convert(LEAD_ID, { type: 'Inquilino' });
      expect(result).toHaveProperty('person');
      expect(mocks.leadsService.convert).toHaveBeenCalledWith(LEAD_ID, { type: 'Inquilino' });
    });
  });

  // ─── POST /leads/:id/lose ─────────────────────────────────────────────────

  describe('POST /leads/:id/lose', () => {
    it('marks lead as lost with reason', async () => {
      const result = await controller.lose(LEAD_ID, { reason: 'price' });
      expect(result).toMatchObject({ status: 'lost' });
      expect(mocks.leadsService.lose).toHaveBeenCalledWith(LEAD_ID, { reason: 'price' });
    });
  });

  // ─── DELETE /leads/:id ────────────────────────────────────────────────────

  describe('DELETE /leads/:id', () => {
    it('soft-deletes lead', async () => {
      const result = await controller.remove(LEAD_ID);
      expect(result).toMatchObject({ isActive: false });
      expect(mocks.leadsService.remove).toHaveBeenCalledWith(LEAD_ID);
    });
  });
});
