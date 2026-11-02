import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../common/auth/roles.decorator';
import { BILLING_READ_ROLES, BILLING_ROLES, MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { CashService } from './cash.service';
import { CompensationsService } from './compensations.service';
import { ReceiptsService } from './receipts.service';

/** Cuentas de la inmobiliaria: caja, banco y custodia de cada locador (ADR-0012). */
@Controller('financial-accounts')
export class FinancialAccountsController {
  constructor(private readonly cash: CashService) {}

  /** GET /financial-accounts?kind=&currency=&ownerPersonId=&includeInactive= — Cuentas con saldo y totales por moneda. */
  @Roles(...BILLING_READ_ROLES)
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    return this.cash.listAccounts(query);
  }

  /** POST /financial-accounts — Alta de una cuenta. Admin, Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @Post()
  async create(@Body() body: unknown) {
    return this.cash.createAccount(body);
  }

  /** PATCH /financial-accounts/:id — Nombre o estado (no se desactiva con saldo). Admin, Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    return this.cash.updateAccount(id, body);
  }
}

/** Libro de movimientos de la inmobiliaria. */
@Controller('cash-movements')
export class CashMovementsController {
  constructor(private readonly cash: CashService) {}

  /** GET /cash-movements?accountId=&from=&to=&category=&contractId=&page=&limit= */
  @Roles(...BILLING_READ_ROLES)
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    return this.cash.listMovements(query);
  }

  /** POST /cash-movements — Movimiento manual (gasto, honorario, pagos, seña). Admin, Gerente, Liquidaciones. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('cash-movement-create')
  @Post()
  async create(@Body() body: unknown) {
    return this.cash.createMovement(body);
  }

  /** POST /cash-movements/conversion — Conversión de moneda con tipo de cambio explícito. Admin, Gerente, Liquidaciones. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('cash-conversion')
  @Post('conversion')
  async conversion(@Body() body: unknown) {
    return this.cash.createConversion(body);
  }
}

/** Efectivo que la inmobiliaria guarda para un locador. */
@Controller('custody')
export class CustodyController {
  constructor(private readonly cash: CashService) {}

  /** POST /custody/:accountId/deliver — Entrega al locador (todo o parte). Admin, Gerente, Liquidaciones. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('custody-deliver')
  @Post(':accountId/deliver')
  @HttpCode(200)
  async deliver(@Param('accountId') accountId: string, @Body() body: unknown) {
    return this.cash.deliverCustody(accountId, body);
  }
}

/** Compensaciones entre locadores. */
@Controller('compensations')
export class CompensationsController {
  constructor(private readonly compensations: CompensationsService) {}

  /** GET /compensations?paymentId=&personId= */
  @Roles(...BILLING_READ_ROLES)
  @Get()
  async list(@Query('paymentId') paymentId?: string, @Query('personId') personId?: string) {
    return this.compensations.list({ paymentId, personId });
  }

  /** POST /compensations — Registra una compensación (y, si se pide, la paga con la custodia). Admin, Gerente, Liquidaciones. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('compensation-create')
  @Post()
  async create(@Body() body: unknown) {
    return this.compensations.create(body);
  }
}

/** Recibos de cobro numerados. */
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  /** GET /receipts?from=&to=&contractId=&page=&limit= */
  @Roles(...BILLING_READ_ROLES)
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    return this.receipts.list(query);
  }

  /** GET /receipts/:id/pdf — PDF del recibo con su número. */
  @Roles(...BILLING_READ_ROLES)
  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.receipts.pdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
