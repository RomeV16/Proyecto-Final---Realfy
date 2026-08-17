import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Roles } from '../../common/auth/roles.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/auth/rbac.guard';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { UserRole } from '@realfy/shared';

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
   * GET /dashboard/fiscal — Fiscal/AFIP stats widget for the current tenant.
   * Restricted to Admin and Gerente roles.
   */
  @Get('fiscal')
  @Roles(UserRole.Admin, UserRole.Gerente)
  async getFiscalStats() {
    const tenantId = this.tenantContext.getTenantId();
    return this.dashboardService.getFiscalStats(tenantId!);
  }
}
