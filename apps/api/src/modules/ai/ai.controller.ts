import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@realfy/shared';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/auth/rbac.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { AiPrioritiesService } from './ai-priorities.service';
import { ContractClosureService } from './contract-closure.service';

// Las prioridades agregan la operación completa de la inmobiliaria, así que la
// sesión se exige acá y no sólo desde los guards globales.
@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly priorities: AiPrioritiesService,
    private readonly closureSummaries: ContractClosureService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * GET /ai/priorities — Pendientes del día ordenados por urgencia, con el
   * detalle de si el orden lo propuso el modelo de lenguaje o las reglas.
   * Restringido a Admin y Gerencia, como el resto de las vistas de cartera.
   */
  @Get('priorities')
  @Roles(UserRole.Admin, UserRole.Gerente)
  async getPriorities() {
    return this.priorities.getDailyPriorities(this.tenantContext.getTenantId()!);
  }

  /**
   * GET /ai/contracts/:contractId/closure-summary — Resumen de gestión guardado
   * del contrato, con las métricas que lo respaldan y quién lo redactó.
   * Restringido a Admin y Gerencia: es la lectura de cierre de una cartera.
   */
  @Get('contracts/:contractId/closure-summary')
  @Roles(UserRole.Admin, UserRole.Gerente)
  async getClosureSummary(@Param('contractId') contractId: string) {
    return this.closureSummaries.get(this.tenantContext.getTenantId()!, contractId);
  }

  /**
   * POST /ai/contracts/:contractId/closure-summary — Genera o regenera el
   * resumen del contrato cerrado. Restringido a Admin y Gerencia.
   */
  @Post('contracts/:contractId/closure-summary')
  @Roles(UserRole.Admin, UserRole.Gerente)
  async generateClosureSummary(@Param('contractId') contractId: string) {
    return this.closureSummaries.generate(this.tenantContext.getTenantId()!, contractId);
  }
}
