import { Test, TestingModule } from '@nestjs/testing';
import { AiController } from './ai.controller';
import { AiPrioritiesService } from './ai-priorities.service';
import { ContractClosureService } from './contract-closure.service';
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

const CONTRACT_ID = 'con-1';

const MOCK_CLOSURE = {
  contractId: CONTRACT_ID,
  status: 'Rescindido',
  closed: true,
  summary: {
    summary: 'El contrato estuvo vigente 21 meses y cerró con deuda.',
    highlights: ['Vigencia efectiva de 21 meses'],
    metrics: { durationMonths: 21 },
    source: 'rules' as const,
    model: null,
    generatedAt: '2026-08-17T18:00:00.000Z',
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AiController', () => {
  let controller: AiController;
  let module: TestingModule;
  let priorities: { getDailyPriorities: jest.Mock };
  let closureSummaries: { get: jest.Mock; generate: jest.Mock };

  beforeEach(async () => {
    priorities = { getDailyPriorities: jest.fn().mockResolvedValue(MOCK_RESULT) };
    closureSummaries = {
      get: jest.fn().mockResolvedValue(MOCK_CLOSURE),
      generate: jest.fn().mockResolvedValue(MOCK_CLOSURE),
    };

    module = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        { provide: AiPrioritiesService, useValue: priorities },
        { provide: ContractClosureService, useValue: closureSummaries },
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

  it('restringe el resumen de cierre a Admin y Gerente', () => {
    expect(
      Reflect.getMetadata('roles', AiController.prototype.getClosureSummary),
    ).toEqual(['Admin', 'Gerente']);
    expect(
      Reflect.getMetadata('roles', AiController.prototype.generateClosureSummary),
    ).toEqual(['Admin', 'Gerente']);
  });

  it('lee el resumen guardado del contrato', async () => {
    const result = await controller.getClosureSummary(CONTRACT_ID);

    expect(result).toEqual(MOCK_CLOSURE);
    expect(closureSummaries.get).toHaveBeenCalledWith(TENANT_ID, CONTRACT_ID);
    expect(closureSummaries.generate).not.toHaveBeenCalled();
  });

  it('regenera el resumen a pedido', async () => {
    const result = await controller.generateClosureSummary(CONTRACT_ID);

    expect(result).toEqual(MOCK_CLOSURE);
    expect(closureSummaries.generate).toHaveBeenCalledWith(TENANT_ID, CONTRACT_ID);
  });
});
