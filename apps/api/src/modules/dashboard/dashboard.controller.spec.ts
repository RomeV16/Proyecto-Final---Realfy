import { BadRequestException } from '@nestjs/common';
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

const MOCK_OCCUPANCY_TREND = [
  { month: '2026-07', occupancyPct: 78.5 },
  { month: '2026-08', occupancyPct: 82 },
];

const MOCK_PROFITABILITY = [
  { propertyId: 'prop-1', label: 'Belgrano 100', revenue: 150000, expenses: 20000, net: 130000 },
];

const MOCK_CASH_FLOW = [
  { period: '2026-08', inflow: 150000, outflow: 90000, net: 60000 },
];

const MOCK_DELINQUENCY = {
  current: 12.5,
  trend: [{ month: '2026-08', pct: 12.5 }],
};

function buildMocks() {
  const dashboardService = {
    getStats: jest.fn().mockResolvedValue(MOCK_STATS),
    getOccupancyTrend: jest.fn().mockResolvedValue(MOCK_OCCUPANCY_TREND),
    getProfitabilityByProperty: jest.fn().mockResolvedValue(MOCK_PROFITABILITY),
    getCashFlow: jest.fn().mockResolvedValue(MOCK_CASH_FLOW),
    getDelinquencyRate: jest.fn().mockResolvedValue(MOCK_DELINQUENCY),
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

  it('restringe cada widget de metricas al rol que le corresponde', () => {
    const rolesOf = (handler: (...args: any[]) => unknown) =>
      Reflect.getMetadata('roles', handler);

    expect(rolesOf(DashboardController.prototype.getOccupancyTrend)).toEqual(['Admin', 'Gerente']);
    expect(rolesOf(DashboardController.prototype.getProfitability)).toEqual(['Admin', 'Gerente']);
    expect(rolesOf(DashboardController.prototype.getCashFlow)).toEqual([
      'Admin',
      'Gerente',
      'Liquidaciones',
    ]);
    expect(rolesOf(DashboardController.prototype.getDelinquencyRate)).toEqual([
      'Admin',
      'Gerente',
      'Liquidaciones',
    ]);
  });

  it('deja los indicadores generales abiertos a cualquier sesion', () => {
    expect(Reflect.getMetadata('roles', DashboardController.prototype.getStats)).toBeUndefined();
  });

  // ─── GET /dashboard/occupancy-trend ───────────────────────────────────────

  describe('GET /dashboard/occupancy-trend', () => {
    it('pide doce meses cuando no se especifica el rango', async () => {
      const result = await controller.getOccupancyTrend({});

      expect(result).toEqual(MOCK_OCCUPANCY_TREND);
      expect(mocks.dashboardService.getOccupancyTrend).toHaveBeenCalledWith(TENANT_ID, 12);
    });

    it('respeta la cantidad de meses pedida', async () => {
      await controller.getOccupancyTrend({ months: '6' });

      expect(mocks.dashboardService.getOccupancyTrend).toHaveBeenCalledWith(TENANT_ID, 6);
    });

    it('rechaza una cantidad de meses invalida', async () => {
      await expect(controller.getOccupancyTrend({ months: '99' })).rejects.toThrow(
        BadRequestException,
      );
      expect(mocks.dashboardService.getOccupancyTrend).not.toHaveBeenCalled();
    });
  });

  // ─── GET /dashboard/profitability ─────────────────────────────────────────

  describe('GET /dashboard/profitability', () => {
    it('usa el rango explicito cuando viene en la query', async () => {
      await controller.getProfitability({ from: '2026-01-01', to: '2026-03-31' });

      const [tenantId, range] = mocks.dashboardService.getProfitabilityByProperty.mock.calls[0];
      expect(tenantId).toBe(TENANT_ID);
      expect(range.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(range.to.toISOString()).toBe('2026-03-31T23:59:59.999Z');
    });

    it('cae en los ultimos doce meses cuando no hay rango', async () => {
      const result = await controller.getProfitability({});

      expect(result).toEqual(MOCK_PROFITABILITY);
      const [, range] = mocks.dashboardService.getProfitabilityByProperty.mock.calls[0];
      const monthsApart =
        (range.to.getUTCFullYear() - range.from.getUTCFullYear()) * 12 +
        (range.to.getUTCMonth() - range.from.getUTCMonth());
      expect(monthsApart).toBe(11);
      expect(range.from.getUTCDate()).toBe(1);
    });

    it('rechaza fechas mal formadas', async () => {
      await expect(controller.getProfitability({ from: '01/01/2026' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza un rango invertido', async () => {
      await expect(
        controller.getProfitability({ from: '2026-03-31', to: '2026-01-01' }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.dashboardService.getProfitabilityByProperty).not.toHaveBeenCalled();
    });
  });

  // ─── GET /dashboard/cash-flow ─────────────────────────────────────────────

  describe('GET /dashboard/cash-flow', () => {
    it('agrupa por mes por defecto', async () => {
      const result = await controller.getCashFlow({});

      expect(result).toEqual(MOCK_CASH_FLOW);
      expect(mocks.dashboardService.getCashFlow).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ from: expect.any(Date), to: expect.any(Date) }),
        'month',
      );
    });

    it('acepta la granularidad semanal', async () => {
      await controller.getCashFlow({ granularity: 'week' });

      expect(mocks.dashboardService.getCashFlow).toHaveBeenCalledWith(
        TENANT_ID,
        expect.anything(),
        'week',
      );
    });

    it('rechaza una granularidad desconocida', async () => {
      await expect(controller.getCashFlow({ granularity: 'trimestre' })).rejects.toThrow(
        BadRequestException,
      );
      expect(mocks.dashboardService.getCashFlow).not.toHaveBeenCalled();
    });
  });

  // ─── GET /dashboard/delinquency-rate ──────────────────────────────────────

  describe('GET /dashboard/delinquency-rate', () => {
    it('devuelve la tasa actual y su serie', async () => {
      const result = await controller.getDelinquencyRate();

      expect(result).toEqual(MOCK_DELINQUENCY);
      expect(mocks.dashboardService.getDelinquencyRate).toHaveBeenCalledWith(TENANT_ID);
    });

    it('propagates service errors', async () => {
      mocks.dashboardService.getDelinquencyRate.mockRejectedValueOnce(new Error('DB error'));
      await expect(controller.getDelinquencyRate()).rejects.toThrow('DB error');
    });
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
