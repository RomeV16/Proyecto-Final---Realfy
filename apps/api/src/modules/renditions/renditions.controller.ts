import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RenditionsService } from './renditions.service';
import { Roles } from '../../common/auth/roles.decorator';
import { BILLING_ROLES, MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { ReadResource } from '../../common/read-policy/read-resource.decorator';

@Controller('renditions')
export class RenditionsController {
  constructor(private readonly renditionsService: RenditionsService) {}

  /**
   * POST /renditions/generate — Generate a rendition for a contract + period.
   */
  @Roles(...BILLING_ROLES)
  @Post('generate')
  async generate(@Body() body: Record<string, any>) {
    return this.renditionsService.generate(body);
  }

  /**
   * GET /renditions — List with filters + pagination.
   */
  @ReadResource('renditions')
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    const coerced = { ...query };
    const numericFields = ['page', 'limit', 'month', 'year'];
    for (const field of numericFields) {
      if (coerced[field] !== undefined) {
        coerced[field] = Number(coerced[field]);
      }
    }
    return this.renditionsService.findAll(coerced);
  }

  /**
   * GET /renditions/:id — Detail with line items, contract, owner.
   */
  @ReadResource('renditions')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.renditionsService.findOne(id);
  }

  /**
   * PATCH /renditions/:id/transition — State transition.
   */
  @Roles(...BILLING_ROLES)
  @Patch(':id/transition')
  async transition(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.renditionsService.transition(id, body);
  }

  /**
   * GET /renditions/:id/pdf — Download PDF.
   */
  @ReadResource('renditions')
  @Get(':id/pdf')
  async getPdf(@Param('id') id: string, @Res() res: Response) {
    const pdfBuffer = await this.renditionsService.generatePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="rendicion-${id}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  /**
   * POST /renditions/:id/send — Send rendition email with PDF.
   */
  @Roles(...BILLING_ROLES)
  @Post(':id/send')
  async sendEmail(@Param('id') id: string) {
    return this.renditionsService.sendEmail(id);
  }

  /**
   * POST /renditions/:id/line-items — Add a line item.
   */
  @Roles(...BILLING_ROLES)
  @Post(':id/line-items')
  async addLineItem(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.renditionsService.addLineItem(id, body);
  }

  /**
   * DELETE /renditions/:id/line-items/:itemId — Remove a line item.
   */
  @Roles(...BILLING_ROLES)
  @Delete(':id/line-items/:itemId')
  async removeLineItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.renditionsService.removeLineItem(id, itemId);
  }

  /**
   * PATCH /renditions/:id/notes — Update notes.
   */
  @Roles(...BILLING_ROLES)
  @Patch(':id/notes')
  async updateNotes(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.renditionsService.updateNotes(id, body);
  }
}

/**
 * Separate controller for commission endpoints under /contracts/:contractId/commission.
 */
@Controller('contracts')
export class CommissionsController {
  constructor(private readonly renditionsService: RenditionsService) {}

  /**
   * POST /contracts/:contractId/commission — Create/update commission config.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':contractId/commission')
  async createCommission(
    @Param('contractId') contractId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.renditionsService.createCommission(contractId, body);
  }

  /**
   * GET /contracts/:contractId/commission — Get commission config.
   */
  @ReadResource('contracts.commission')
  @Get(':contractId/commission')
  async getCommission(@Param('contractId') contractId: string) {
    return this.renditionsService.getCommission(contractId);
  }

  /**
   * DELETE /contracts/:contractId/commission — Delete commission config.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Delete(':contractId/commission')
  async deleteCommission(@Param('contractId') contractId: string) {
    return this.renditionsService.deleteCommission(contractId);
  }
}
