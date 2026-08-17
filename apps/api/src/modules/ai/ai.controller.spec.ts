import { Test, TestingModule } from '@nestjs/testing';
import { AiController } from './ai.controller';
import { AiPrioritiesService } from './ai-priorities.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/auth/rbac.guard';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tn000000-0000-0000-0000-000000000001';

const MOCK_RESULT = {
  generatedAt: '2026-08-17T12:00:00.000Z',
  source: 'rules' as const,
  model: null,
  totals: {
    overdueAmount: 250000,
    pendingAmount: 90000,
    overdueCollections: 1,
    openTickets: 2,
    expiringContracts: 1,
    staleLeads: 1,
  },
  priorities: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AiController', () => {
  let controller: AiController;
  let module: TestingModule;
  let priorities: { getDailyPriorities: jest.Mock };

  beforeEach(async () => {
    priorities = { getDailyPriorities: jest.fn().mockResolvedValue(MOCK_RESULT) };

    module = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        { provide: AiPrioritiesService, useValue: priorities },
        {
          provide: TenantContextService,
          useValue: { getTenantId: jest.fn().mockReturnValue(TENANT_ID) },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AiController);
  });

  afterEach(async () => {
    await module.close();
  });

  it('exige sesion y rol para todo el controlador', () => {
    const guards = Reflect.getMetadata('__guards__', AiController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RbacGuard);
  });

  it('restringe las prioridades del dia a Admin y Gerente', () => {
    const roles = Reflect.getMetadata('roles', AiController.prototype.getPriorities);
    expect(roles).toEqual(['Admin', 'Gerente']);
  });

  it('resuelve las prioridades de la inmobiliaria en sesion', async () => {
    const result = await controller.getPriorities();

    expect(result).toEqual(MOCK_RESULT);
    expect(priorities.getDailyPriorities).toHaveBeenCalledWith(TENANT_ID);
  });
});
