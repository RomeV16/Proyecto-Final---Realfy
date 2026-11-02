import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../common/auth/roles.decorator';
import { MANAGEMENT_ROLES, SALES_ROLES } from '../../common/auth/role-groups';
import { FollowUpsService } from './follow-ups.service';
import { ContractRenewalService } from './contract-renewal.service';
import { OralExtensionService } from './oral-extension.service';
import { RenewalAddendumPdfService } from './renewal-addendum-pdf.service';

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
  constructor(
    private readonly oralExtension: OralExtensionService,
    private readonly renewal: ContractRenewalService,
    private readonly addendum: RenewalAddendumPdfService,
  ) {}

  /**
   * POST /contracts/:id/oral-extension — prórroga de palabra: mueve el fin real
   * sin cambiar el fin pactado. Admin y Gerente.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/oral-extension')
  async extend(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.oralExtension.extend(id, body);
  }

  /**
   * POST /contracts/:id/renew — renovación como período del mismo contrato:
   * alquiler nuevo, regla de ajuste, garantes y honorarios. Admin y Gerente.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/renew')
  async renew(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.renewal.renew(id, body);
  }

  /** GET /contracts/:id/periods/:seq/addendum — PDF de la adenda corta de una renovación. */
  @Roles(...SALES_ROLES)
  @Get(':id/periods/:seq/addendum')
  async addendumPdf(@Param('id') id: string, @Param('seq', ParseIntPipe) seq: number, @Res() res: Response) {
    const { buffer, filename } = await this.addendum.pdf(id, seq);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
