import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Roles } from '../../common/auth/roles.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/auth/rbac.guard';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  UserRole,
  OccupancyTrendQuerySchema,
  DashboardRangeQuerySchema,
  DashboardCashFlowQuerySchema,
} from '@realfy/shared';
import type { DateRange } from './dashboard-calculations';

/** Cuántos meses cubren los widgets de rango cuando no se pide uno explícito. */
const DEFAULT_RANGE_MONTHS = 12;

/**
 * Valida la query de un widget y devuelve los filtros ya tipados.
 * Los widgets del panel se piden por querystring, así que un parámetro mal
 * formado tiene que cortar con 400 y no llegar a las agregaciones.
 */
function parseQuery<T>(schema: { parse: (value: unknown) => T }, query: unknown): T {
  try {
    return schema.parse(query);
  } catch (err: any) {
    throw new BadRequestException({
      error: 'VALIDATION_ERROR',
      message: 'Invalid dashboard widget query',
      details: err.errors ?? err.message,
    });
  }
}

/**
 * Resuelve el rango de fechas de un widget.
 * Sin `from` se arranca el primer día del mes de hace DEFAULT_RANGE_MONTHS - 1
 * meses; sin `to` se cierra en el momento de la consulta.
 */
function resolveRange(filters: { from?: string; to?: string }): DateRange {
  const now = new Date();
  const from = filters.from
    ? new Date(`${filters.from}T00:00:00.000Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (DEFAULT_RANGE_MONTHS - 1), 1));
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : now;

  if (from > to) {
    throw new BadRequestException({
      error: 'VALIDATION_ERROR',
      message: 'Invalid dashboard widget query',
      details: 'from must be earlier than to',
    });
  }

  return { from, to };
}

// Los indicadores salen de agregar datos de todo el tenant, así que la sesión se
// exige acá y no sólo desde los guards globales: si mañana alguien marca el
// módulo como público o cambia el registro global, este controlador sigue cerrado.
@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * GET /dashboard/stats — Métricas agregadas del tenant en sesión.
   * Requiere sesión; sin restricción de rol, cualquier usuario autenticado ve el panel.
   */
  @Get('stats')
  getStats() {
    return this.dashboardService.getStats();
  }

  /**
   * GET /dashboard/occupancy-trend?months=12 — Ocupación de la cartera de
   * alquiler al cierre de cada uno de los últimos meses.
   */
  @Get('occupancy-trend')
  @Roles(UserRole.Admin, UserRole.Gerente)
  async getOccupancyTrend(@Query() query: Record<string, unknown>) {
    const { months } = parseQuery(OccupancyTrendQuerySchema, query);
    return this.dashboardService.getOccupancyTrend(this.tenantId(), months);
  }

  /**
   * GET /dashboard/profitability?from&to — Ingresos, gastos y neto por
   * propiedad en el rango pedido, ordenado por neto descendente.
   */
  @Get('profitability')
  @Roles(UserRole.Admin, UserRole.Gerente)
  async getProfitability(@Query() query: Record<string, unknown>) {
    const filters = parseQuery(DashboardRangeQuerySchema, query);
    return this.dashboardService.getProfitabilityByProperty(
      this.tenantId(),
      resolveRange(filters),
    );
  }

  /**
   * GET /dashboard/cash-flow?from&to&granularity — Ingresos contra egresos
   * agrupados por mes o por semana ISO.
   */
  @Get('cash-flow')
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones)
  async getCashFlow(@Query() query: Record<string, unknown>) {
    const filters = parseQuery(DashboardCashFlowQuerySchema, query);
    return this.dashboardService.getCashFlow(
      this.tenantId(),
      resolveRange(filters),
      filters.granularity,
    );
  }

  /**
   * GET /dashboard/delinquency-rate — Tasa de morosidad actual y su serie
   * de los últimos doce meses.
   */
  @Get('delinquency-rate')
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones)
  async getDelinquencyRate() {
    return this.dashboardService.getDelinquencyRate(this.tenantId());
  }

  /**
   * GET /dashboard/fiscal — Fiscal/AFIP stats widget for the current tenant.
   * Restricted to Admin and Gerente roles.
   */
  @Get('fiscal')
  @Roles(UserRole.Admin, UserRole.Gerente)
  async getFiscalStats() {
    return this.dashboardService.getFiscalStats(this.tenantId());
  }

  // ─── Private ──────────────────────────────────────────

  private tenantId(): string {
    return this.tenantContext.getTenantId()!;
  }
}
