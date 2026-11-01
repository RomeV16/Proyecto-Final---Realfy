import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
import { BILLING_ROLES } from '../../common/auth/role-groups';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { ChargeRulesService } from './charge-rules.service';

@Controller('contracts/:contractId/charge-rules')
export class ChargeRulesController {
  constructor(private readonly rules: ChargeRulesService) {}

  /**
   * GET /contracts/:contractId/charge-rules?at= — Reglas de impuestos y
   * servicios del contrato: las vigentes a `at` y todas las versiones.
   * Cualquier usuario autenticado puede leer.
   */
  @Get()
  async list(@Param('contractId') contractId: string, @Query() query: Record<string, any>) {
    return this.rules.list(contractId, query);
  }

  /**
   * POST /contracts/:contractId/charge-rules — Crea una regla (versión nueva si
   * ya había una para el servicio). En un contrato que no es borrador exige el
   * acuerdo `CambioCargo` de la misma fecha. Admin, Gerente, Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @AuditOperation('contract-charge-rule')
  @Post()
  async create(@Param('contractId') contractId: string, @Body() body: Record<string, any>) {
    return this.rules.create(contractId, body);
  }

  /**
   * PATCH /contracts/:contractId/charge-rules/:ruleId — Corrige una regla que
   * todavía no se usó para facturar. Admin, Gerente, Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @AuditOperation('contract-charge-rule')
  @Patch(':ruleId')
  async update(
    @Param('contractId') contractId: string,
    @Param('ruleId') ruleId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.rules.update(contractId, ruleId, body);
  }
}
