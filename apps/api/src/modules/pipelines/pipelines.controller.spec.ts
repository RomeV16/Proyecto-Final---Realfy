import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { PipelinesController } from './pipelines.controller';
import { PipelinesService } from './pipelines.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PIPELINE_ID = 'p0000000-0000-0000-0000-000000000001';
const STAGE_ID = 's0000000-0000-0000-0000-000000000001';

const MOCK_PIPELINE = {
  id: PIPELINE_ID,
  type: 'Alquiler',
  name: 'Pipeline Alquiler',
  isActive: true,
  stages: [],
};

const MOCK_STAGE = {
  id: STAGE_ID,
  pipelineId: PIPELINE_ID,
  name: 'Consulta nueva',
  sortOrder: 0,
};

function buildMocks() {
  const pipelinesService = {
    create: jest.fn().mockResolvedValue(MOCK_PIPELINE),
    findAll: jest.fn().mockResolvedValue([MOCK_PIPELINE]),
    findOne: jest.fn().mockResolvedValue(MOCK_PIPELINE),
    update: jest.fn().mockResolvedValue({ ...MOCK_PIPELINE, name: 'Renombrado' }),
    remove: jest.fn().mockResolvedValue({ deleted: true }),
    addStage: jest.fn().mockResolvedValue(MOCK_STAGE),
    reorderStages: jest.fn().mockResolvedValue({ ...MOCK_PIPELINE, stages: [MOCK_STAGE] }),
    updateStage: jest.fn().mockResolvedValue({ ...MOCK_STAGE, name: 'Contactado' }),
    removeStage: jest.fn().mockResolvedValue({ deleted: true }),
  };
  return { pipelinesService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PipelinesController', () => {
  let controller: PipelinesController;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PipelinesController],
      providers: [{ provide: PipelinesService, useValue: mocks.pipelinesService }],
    })
      .overrideGuard(require('../../common/auth/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/auth/rbac.guard').RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PipelinesController>(PipelinesController);
  });

  // ─── POST /pipelines ──────────────────────────────────────────────────────

  describe('POST /pipelines', () => {
    it('creates and returns a pipeline', async () => {
      const body = { type: 'Alquiler', name: 'Pipeline Alquiler' };
      const result = await controller.create(body);
      expect(result).toMatchObject({ id: PIPELINE_ID, type: 'Alquiler' });
      expect(mocks.pipelinesService.create).toHaveBeenCalledWith(body);
    });

    it('propagates ConflictException when the pipeline type already exists', async () => {
      mocks.pipelinesService.create.mockRejectedValueOnce(new ConflictException());
      await expect(
        controller.create({ type: 'Alquiler', name: 'Duplicado' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── GET /pipelines ───────────────────────────────────────────────────────

  describe('GET /pipelines', () => {
    it('returns all pipelines for the tenant', async () => {
      const result = await controller.findAll();
      expect(result).toEqual([MOCK_PIPELINE]);
      expect(mocks.pipelinesService.findAll).toHaveBeenCalled();
    });
  });

  // ─── GET /pipelines/:id ───────────────────────────────────────────────────

  describe('GET /pipelines/:id', () => {
    it('returns pipeline detail with stages', async () => {
      const result = await controller.findOne(PIPELINE_ID);
      expect(result).toMatchObject({ id: PIPELINE_ID });
    });

    it('propagates NotFoundException when pipeline missing', async () => {
      mocks.pipelinesService.findOne.mockRejectedValueOnce(new NotFoundException());
      await expect(controller.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── PATCH /pipelines/:id ─────────────────────────────────────────────────

  describe('PATCH /pipelines/:id', () => {
    it('updates pipeline fields', async () => {
      const result = await controller.update(PIPELINE_ID, { name: 'Renombrado' });
      expect(result).toMatchObject({ name: 'Renombrado' });
      expect(mocks.pipelinesService.update).toHaveBeenCalledWith(PIPELINE_ID, { name: 'Renombrado' });
    });
  });

  // ─── DELETE /pipelines/:id ────────────────────────────────────────────────

  describe('DELETE /pipelines/:id', () => {
    it('removes a pipeline', async () => {
      const result = await controller.remove(PIPELINE_ID);
      expect(result).toEqual({ deleted: true });
      expect(mocks.pipelinesService.remove).toHaveBeenCalledWith(PIPELINE_ID);
    });
  });

  // ─── POST /pipelines/:id/stages ───────────────────────────────────────────

  describe('POST /pipelines/:id/stages', () => {
    it('adds a stage to the pipeline', async () => {
      const body = { name: 'Consulta nueva', sortOrder: 0 };
      const result = await controller.addStage(PIPELINE_ID, body);
      expect(result).toMatchObject({ id: STAGE_ID, pipelineId: PIPELINE_ID });
      expect(mocks.pipelinesService.addStage).toHaveBeenCalledWith(PIPELINE_ID, body);
    });
  });

  // ─── PATCH /pipelines/:pipelineId/stages/reorder ─────────────────────────

  describe('PATCH /pipelines/:pipelineId/stages/reorder', () => {
    it('reorders stages and returns the updated pipeline', async () => {
      const body = { stageIds: [STAGE_ID] };
      const result = await controller.reorderStages(PIPELINE_ID, body);
      expect(result).toMatchObject({ id: PIPELINE_ID });
      expect(mocks.pipelinesService.reorderStages).toHaveBeenCalledWith(PIPELINE_ID, body);
    });
  });

  // ─── PATCH /pipelines/:pipelineId/stages/:stageId ────────────────────────

  describe('PATCH /pipelines/:pipelineId/stages/:stageId', () => {
    it('updates a stage', async () => {
      const result = await controller.updateStage(PIPELINE_ID, STAGE_ID, { name: 'Contactado' });
      expect(result).toMatchObject({ name: 'Contactado' });
      expect(mocks.pipelinesService.updateStage).toHaveBeenCalledWith(
        PIPELINE_ID,
        STAGE_ID,
        { name: 'Contactado' },
      );
    });
  });

  // ─── DELETE /pipelines/:pipelineId/stages/:stageId ───────────────────────

  describe('DELETE /pipelines/:pipelineId/stages/:stageId', () => {
    it('removes a stage', async () => {
      const result = await controller.removeStage(PIPELINE_ID, STAGE_ID);
      expect(result).toEqual({ deleted: true });
      expect(mocks.pipelinesService.removeStage).toHaveBeenCalledWith(PIPELINE_ID, STAGE_ID);
    });
  });
});
