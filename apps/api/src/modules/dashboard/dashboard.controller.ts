import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Roles } from '../../common/auth/roles.decorator';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { UserRole } from '@realfy/shared';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly tenantContext: TenantContextService,
  ) {}

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
