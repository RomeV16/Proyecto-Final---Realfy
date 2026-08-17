import { Test, TestingModule } from '@nestjs/testing';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/auth/rbac.guard';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tn000000-0000-0000-0000-000000000001';

const MOCK_STATS = {
  activeContracts: 12,
  totalProperties: 45,
  occupancyRate: 82,
  pendingLiquidaciones: 4,
  tickets: { open: 7, urgent: 2 },
};

const MOCK_FISCAL_STATS = {
  emissionsLast30d: { count: 8, byIssuer: [] },
  errorsLast30d: { count: 1, rate: '12.50', topErrors: [] },
  avgCaeLatencyMs: 420,
  certificate: { exists: true, daysToExpiry: 260, isProduction: false },
  issuers: { active: 2, pending: 1, revoked: 0 },
};

function buildMocks() {
  const dashboardService = {
    getStats: jest.fn().mockResolvedValue(MOCK_STATS),
    getFiscalStats: jest.fn().mockResolvedValue(MOCK_FISCAL_STATS),
  };

  const tenantContextService = {
    getTenantId: jest.fn().mockReturnValue(TENANT_ID),
  };

  return { dashboardService, tenantContextService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardController', () => {
  let controller: DashboardController;
  let module: TestingModule;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    module = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: DashboardService, useValue: mocks.dashboardService },
        { provide: TenantContextService, useValue: mocks.tenantContextService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DashboardController>(DashboardController);
  });

  // ─── Guards ───────────────────────────────────────────────────────────────

  it('exige sesion y rol para todo el controlador', () => {
    const guards = Reflect.getMetadata('__guards__', DashboardController) ?? [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RbacGuard);
  });

  it('restringe los indicadores fiscales a Admin y Gerente', () => {
    const roles = Reflect.getMetadata('roles', DashboardController.prototype.getFiscalStats);
    expect(roles).toEqual(['Admin', 'Gerente']);
  });

  // ─── GET /dashboard/stats ─────────────────────────────────────────────────

  describe('GET /dashboard/stats', () => {
    it('returns aggregated dashboard metrics on happy path', async () => {
      const result = await controller.getStats();
      expect(result).toMatchObject({
        activeContracts: 12,
        totalProperties: 45,
        occupancyRate: 82,
      });
      expect(mocks.dashboardService.getStats).toHaveBeenCalledTimes(1);
    });

    it('includes open ticket counts', async () => {
      const result = await controller.getStats();
      expect(result).toHaveProperty('tickets');
    });

    it('propagates service errors', async () => {
      mocks.dashboardService.getStats.mockRejectedValueOnce(new Error('DB error'));
      await expect(controller.getStats()).rejects.toThrow('DB error');
    });
  });

  // ─── GET /dashboard/fiscal ────────────────────────────────────────────────

  describe('GET /dashboard/fiscal', () => {
    it('returns fiscal stats for current tenant', async () => {
      const result = await controller.getFiscalStats();
      expect(result).toMatchObject({ avgCaeLatencyMs: 420 });
      expect(mocks.tenantContextService.getTenantId).toHaveBeenCalled();
      expect(mocks.dashboardService.getFiscalStats).toHaveBeenCalledWith(TENANT_ID);
    });

    it('includes certificate expiry info', async () => {
      const result = await controller.getFiscalStats();
      expect(result.certificate).toHaveProperty('daysToExpiry');
      expect(result.certificate).toHaveProperty('isProduction');
    });

    it('propagates service errors', async () => {
      mocks.dashboardService.getFiscalStats.mockRejectedValueOnce(new Error('ARCA unreachable'));
      await expect(controller.getFiscalStats()).rejects.toThrow('ARCA unreachable');
    });
  });
});
