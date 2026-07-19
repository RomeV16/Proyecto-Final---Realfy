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
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import { LiquidacionesService } from './liquidaciones.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('liquidaciones')
export class LiquidacionesController {
  constructor(
    private readonly liquidacionesService: LiquidacionesService,
  ) {}

  /**
   * GET /liquidaciones — List with filters + pagination.
   * Any authenticated user can read.
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    const coerced = { ...query };
    const numericFields = ['page', 'limit', 'month', 'year'];
    for (const field of numericFields) {
      if (coerced[field] !== undefined) {
        coerced[field] = Number(coerced[field]);
      }
    }
    return this.liquidacionesService.findAll(coerced);
  }

  /**
   * POST /liquidaciones/generate — Auto-generate liquidaciones for a month/year.
   * Admin, Gerente, Liquidaciones roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones)
  @Post('generate')
  async generate(@Body() body: Record<string, any>) {
    return this.liquidacionesService.generate(body);
  }

  /**
   * POST /liquidaciones/bulk-approve — Bulk approve liquidaciones.
   * Admin and Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post('bulk-approve')
  async bulkApprove(@Body() body: { ids: string[] }) {
    return this.liquidacionesService.bulkApprove(body.ids);
  }

  /**
   * POST /liquidaciones/bulk-send — Bulk send liquidaciones.
   * Admin and Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post('bulk-send')
  async bulkSend(@Body() body: { ids: string[] }) {
    return this.liquidacionesService.bulkSend(body.ids);
  }

  /**
   * GET /liquidaciones/:id — Full detail with line items, payments, contract.
   * Any authenticated user can read.
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.liquidacionesService.findOne(id);
  }

  /**
   * GET /liquidaciones/:id/pdf — Generate and return PDF inline.
   * Any authenticated user can read.
   */
  @Get(':id/pdf')
  async getPdf(@Param('id') id: string, @Res() res: Response) {
    const pdfBuffer = await this.liquidacionesService.generatePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="liquidacion-${id}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  /**
   * POST /liquidaciones/:id/line-items — Add a line item.
   * Admin, Gerente, Liquidaciones roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones)
  @Post(':id/line-items')
  async addLineItem(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.liquidacionesService.addLineItem(id, body);
  }

  /**
   * PATCH /liquidaciones/:id/line-items/:lineItemId — Update a line item.
   * Admin, Gerente, Liquidaciones roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones)
  @Patch(':id/line-items/:lineItemId')
  async updateLineItem(
    @Param('lineItemId') lineItemId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.liquidacionesService.updateLineItem(lineItemId, body);
  }

  /**
   * DELETE /liquidaciones/:id/line-items/:lineItemId — Remove a line item.
   * Admin, Gerente, Liquidaciones roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones)
  @Delete(':id/line-items/:lineItemId')
  async removeLineItem(@Param('lineItemId') lineItemId: string) {
    return this.liquidacionesService.removeLineItem(lineItemId);
  }

  /**
   * POST /liquidaciones/:id/transition — Transition liquidación status.
   * Admin, Gerente, Liquidaciones roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones)
  @Post(':id/transition')
  @HttpCode(200)
  async transition(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.liquidacionesService.transition(id, body);
  }

  /**
   * POST /liquidaciones/:id/payments — Register a payment.
   * Admin, Gerente, Liquidaciones roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones)
  @Post(':id/payments')
  @HttpCode(200)
  async registerPayment(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.liquidacionesService.registerPayment(id, body);
  }

  /**
   * GET /liquidaciones/:id/payments — List payments for a liquidación.
   * Any authenticated user can read.
   */
  @Get(':id/payments')
  async findPayments(@Param('id') id: string) {
    return this.liquidacionesService.findPayments(id);
  }

  /**
   * DELETE /liquidaciones/:id — Soft delete (annul) or hard delete.
   * Admin and Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.liquidacionesService.remove(id);
  }
}
