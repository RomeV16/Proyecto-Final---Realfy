import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../common/auth/roles.decorator';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { BILLING_ROLES, BILLING_READ_ROLES, MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { DepositsService } from './deposits.service';
import { MoveOutPdfService } from './move-out-pdf.service';
import { MoveOutService } from './move-out.service';

/** Depósito de un contrato y su liquidación de egreso. */
@Controller('contracts')
export class ContractDepositsController {
  constructor(
    private readonly deposits: DepositsService,
    private readonly moveOut: MoveOutService,
  ) {}

  /** GET /contracts/:id/deposit — depósito con cuotas y valores por defecto. Lectura de cobranzas. */
  @Roles(...BILLING_READ_ROLES)
  @Get(':id/deposit')
  async getDeposit(@Param('id') id: string) {
    return this.deposits.get(id);
  }

  /** PUT /contracts/:id/deposit — alta o cambio del depósito. Admin y Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @Put(':id/deposit')
  async putDeposit(@Param('id') id: string, @Body() body: unknown) {
    return this.deposits.upsert(id, body);
  }

  /** POST /contracts/:id/deposit/installments/:number/collect — cobra una cuota. Admin, Gerente y Liquidaciones. */
  @Roles(...BILLING_ROLES)
  @Post(':id/deposit/installments/:number/collect')
  @AuditOperation('deposit-installment-collect')
  @HttpCode(200)
  async collect(@Param('id') id: string, @Param('number', ParseIntPipe) number: number, @Body() body: unknown) {
    return this.deposits.collectInstallment(id, number, body);
  }

  /** GET /contracts/:id/move-out — liquidación de egreso del contrato (o null). */
  @Roles(...BILLING_READ_ROLES)
  @Get(':id/move-out')
  async getMoveOut(@Param('id') id: string) {
    return this.moveOut.getForContract(id);
  }

  /** POST /contracts/:id/move-out/preview?date=&rate= — renglones y totales; no guarda nada. */
  @Roles(...BILLING_READ_ROLES)
  @Post(':id/move-out/preview')
  @HttpCode(200)
  async preview(@Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.moveOut.preview(id, query);
  }

  /** POST /contracts/:id/move-out — crea o reemplaza el borrador. Admin y Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/move-out')
  async createMoveOut(@Param('id') id: string, @Body() body: unknown) {
    return this.moveOut.create(id, body);
  }
}

/** Liquidaciones de egreso por id. */
@Controller('move-outs')
export class MoveOutsController {
  constructor(
    private readonly moveOut: MoveOutService,
    private readonly pdf: MoveOutPdfService,
  ) {}

  /** GET /move-outs/:id */
  @Roles(...BILLING_READ_ROLES)
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.moveOut.get(id);
  }

  /** POST /move-outs/:id/confirm — cierra la liquidación (una sola vez). Admin y Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/confirm')
  @AuditOperation('move-out-confirm')
  @HttpCode(200)
  async confirm(@Param('id') id: string, @Body() body: unknown) {
    return this.moveOut.confirm(id, body);
  }

  /** GET /move-outs/:id/pdf — liquidación de egreso en PDF. */
  @Roles(...BILLING_READ_ROLES)
  @Get(':id/pdf')
  async pdfOf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.pdf.pdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
