import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONTRACT_ID = 'c0000000-0000-0000-0000-000000000001';

const MOCK_CONTRACT = {
  id: CONTRACT_ID,
  status: 'Vigente',
  isActive: true,
  currentRent: '50000.00',
};

function buildMocks() {
  const contractsService = {
    findAll: jest.fn().mockResolvedValue({ items: [MOCK_CONTRACT], total: 1, page: 1, limit: 20 }),
    findOne: jest.fn().mockResolvedValue(MOCK_CONTRACT),
    create: jest.fn().mockResolvedValue(MOCK_CONTRACT),
    update: jest.fn().mockResolvedValue({ ...MOCK_CONTRACT, status: 'Renovado' }),
    terminate: jest.fn().mockResolvedValue({ ...MOCK_CONTRACT, status: 'Rescindido', isActive: false }),
  };

  return { contractsService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContractsController', () => {
  let controller: ContractsController;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContractsController],
      providers: [
        { provide: ContractsService, useValue: mocks.contractsService },
      ],
    })
      .overrideGuard(require('../../common/auth/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/auth/rbac.guard').RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ContractsController>(ContractsController);
  });

  // ─── GET /contracts ───────────────────────────────────────────────────────

  describe('GET /contracts', () => {
    it('returns paginated list', async () => {
      const result = await controller.findAll({});
      expect(result).toMatchObject({ items: [MOCK_CONTRACT], total: 1 });
    });

    it('coerces numeric query params', async () => {
      await controller.findAll({ page: '2', limit: '10', guaranteeExpiringWithinDays: '30' });
      expect(mocks.contractsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 10, guaranteeExpiringWithinDays: 30 }),
      );
    });

    it('passes non-numeric query params through unchanged', async () => {
      await controller.findAll({ status: 'Vigente' });
      expect(mocks.contractsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Vigente' }),
      );
    });
  });

  // ─── GET /contracts/:id ───────────────────────────────────────────────────

  describe('GET /contracts/:id', () => {
    it('returns contract detail on happy path', async () => {
      const result = await controller.findOne(CONTRACT_ID);
      expect(result).toMatchObject({ id: CONTRACT_ID });
      expect(mocks.contractsService.findOne).toHaveBeenCalledWith(CONTRACT_ID);
    });

    it('propagates NotFoundException when contract missing', async () => {
      mocks.contractsService.findOne.mockRejectedValueOnce(new NotFoundException());
      await expect(controller.findOne('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── POST /contracts ──────────────────────────────────────────────────────

  describe('POST /contracts', () => {
    const VALID_BODY = { propertyId: 'prop-001', startDate: '2026-01-01' };

    it('creates and returns contract', async () => {
      const result = await controller.create(VALID_BODY);
      expect(result).toMatchObject({ id: CONTRACT_ID });
      expect(mocks.contractsService.create).toHaveBeenCalledWith(VALID_BODY);
    });
  });

  // ─── PATCH /contracts/:id ─────────────────────────────────────────────────

  describe('PATCH /contracts/:id', () => {
    it('updates and returns modified contract', async () => {
      const result = await controller.update(CONTRACT_ID, { status: 'Renovado' });
      expect(result).toMatchObject({ status: 'Renovado' });
      expect(mocks.contractsService.update).toHaveBeenCalledWith(CONTRACT_ID, { status: 'Renovado' });
    });
  });

  // ─── POST /contracts/:id/terminate ───────────────────────────────────────

  describe('POST /contracts/:id/terminate', () => {
    it('terminates contract and returns rescinded state', async () => {
      const result = await controller.terminate(CONTRACT_ID);
      expect(result).toMatchObject({ status: 'Rescindido', isActive: false });
      expect(mocks.contractsService.terminate).toHaveBeenCalledWith(CONTRACT_ID);
    });

    it('propagates NotFoundException when contract missing', async () => {
      mocks.contractsService.terminate.mockRejectedValueOnce(new NotFoundException());
      await expect(controller.terminate('bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
