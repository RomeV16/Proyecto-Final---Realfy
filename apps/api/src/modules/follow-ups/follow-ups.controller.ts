import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
import { MANAGEMENT_ROLES, SALES_ROLES } from '../../common/auth/role-groups';
import { FollowUpsService } from './follow-ups.service';
import { OralExtensionService } from './oral-extension.service';

/** Seguimiento de los vencimientos de contratos: semáforo y checklist. */
@Controller('follow-ups')
export class FollowUpsController {
  constructor(private readonly followUps: FollowUpsService) {}

  /** GET /follow-ups?light=&kind=&status=&assigneeId=&contractId=&page=&limit= — cualquier usuario autenticado. */
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    return this.followUps.list(query);
  }

  /** GET /follow-ups/:id */
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.followUps.get(id);
  }

  /** PATCH /follow-ups/:id — responsable, tipo, notas o resultado. Admin, Gerente y Ventas. */
  @Roles(...SALES_ROLES)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.followUps.update(id, body);
  }

  /** PATCH /follow-ups/:id/tasks/:taskId — marca o desmarca un paso del checklist. Admin, Gerente y Ventas. */
  @Roles(...SALES_ROLES)
  @Patch(':id/tasks/:taskId')
  async toggleTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.followUps.toggleTask(id, taskId, body);
  }
}

/** Acciones de vencimiento sobre un contrato. */
@Controller('contracts')
export class ContractExpirationsController {
  constructor(private readonly oralExtension: OralExtensionService) {}

  /**
   * POST /contracts/:id/oral-extension — prórroga de palabra: mueve el fin real
   * sin cambiar el fin pactado. Admin y Gerente.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/oral-extension')
  async extend(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.oralExtension.extend(id, body);
  }
}
