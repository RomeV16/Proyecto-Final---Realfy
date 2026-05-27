import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tn000000-0000-0000-0000-000000000001';

const MOCK_TENANT = {
  id: TENANT_ID,
  name: 'Inmobiliaria Test',
  isActive: true,
};

function buildMocks() {
  const tenantsService = {
    create: jest.fn().mockResolvedValue(MOCK_TENANT),
    update: jest.fn().mockResolvedValue({ ...MOCK_TENANT, name: 'Updated Inmobiliaria' }),
    findMine: jest.fn().mockResolvedValue(MOCK_TENANT),
    // Additional methods referenced in other modules
    getPenaltyConfig: jest.fn(),
    updatePenaltyConfig: jest.fn(),
  };
  return { tenantsService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TenantsController', () => {
  let controller: TenantsController;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [{ provide: TenantsService, useValue: mocks.tenantsService }],
    })
      .overrideGuard(require('../../common/auth/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/auth/rbac.guard').RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TenantsController>(TenantsController);
  });

  // ─── POST /tenants ────────────────────────────────────────────────────────

  describe('POST /tenants', () => {
    const VALID_BODY = { name: 'Inmobiliaria Test', slug: 'inmo-test' };

    it('creates tenant and returns it', async () => {
      const result = await controller.create(VALID_BODY);
      expect(result).toMatchObject({ id: TENANT_ID, name: 'Inmobiliaria Test' });
      expect(mocks.tenantsService.create).toHaveBeenCalledWith(VALID_BODY);
    });

    it('propagates error when slug already taken', async () => {
      mocks.tenantsService.create.mockRejectedValueOnce(new Error('Slug already exists'));
      await expect(controller.create(VALID_BODY)).rejects.toThrow('Slug already exists');
    });
  });

  // ─── PATCH /tenants/:id ───────────────────────────────────────────────────

  describe('PATCH /tenants/:id', () => {
    it('updates tenant branding and returns modified record', async () => {
      const result = await controller.update(TENANT_ID, { name: 'Updated Inmobiliaria' });
      expect(result).toMatchObject({ name: 'Updated Inmobiliaria' });
      expect(mocks.tenantsService.update).toHaveBeenCalledWith(TENANT_ID, { name: 'Updated Inmobiliaria' });
    });

    it('propagates NotFoundException when tenant not found', async () => {
      mocks.tenantsService.update.mockRejectedValueOnce(new NotFoundException());
      await expect(controller.update('bad-id', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ─── GET /tenants/me ──────────────────────────────────────────────────────

  describe('GET /tenants/me', () => {
    it('returns current tenant details', async () => {
      const result = await controller.findMine();
      expect(result).toMatchObject({ id: TENANT_ID });
      expect(mocks.tenantsService.findMine).toHaveBeenCalledTimes(1);
    });

    it('propagates NotFoundException when no tenant associated', async () => {
      mocks.tenantsService.findMine.mockRejectedValueOnce(new NotFoundException());
      await expect(controller.findMine()).rejects.toThrow(NotFoundException);
    });
  });
});
