import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@realfy/shared';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RbacGuard } from '../../common/auth/rbac.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { AiPrioritiesService } from './ai-priorities.service';

// Las prioridades agregan la operación completa de la inmobiliaria, así que la
// sesión se exige acá y no sólo desde los guards globales.
@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly priorities: AiPrioritiesService,
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
}
