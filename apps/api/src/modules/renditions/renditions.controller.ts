import { Controller, Get, Post, Delete, Param, Body, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RenditionsService } from './renditions.service';
import { Roles } from '../../common/auth/roles.decorator';
import { MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { ReadResource } from '../../common/read-policy/read-resource.decorator';

/**
 * Rendiciones históricas (solo lectura): la cuenta corriente del locador y su
 * estado de cuenta las reemplazan (ADR-0009). No se generan, no cambian de
 * estado, no se editan ni se envían: solo se consultan y se imprimen.
 */
@Controller('renditions')
export class RenditionsController {
  constructor(private readonly renditionsService: RenditionsService) {}

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
