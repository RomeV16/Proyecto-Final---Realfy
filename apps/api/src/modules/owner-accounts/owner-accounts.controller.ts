import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../common/auth/roles.decorator';
import { BILLING_READ_ROLES, BILLING_ROLES, MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { ReadResource } from '../../common/read-policy/read-resource.decorator';
import { OwnerLedgerService } from './owner-ledger.service';
import { OwnerStatementsService } from './owner-statements.service';

/**
 * Cuenta corriente de cada locador (ADR-0009). Lee la misma política de
 * lectura que las rendiciones, a las que reemplaza.
 */
@Controller('owners')
export class OwnersController {
  constructor(private readonly ledger: OwnerLedgerService) {}

  /** GET /owners/balances?currency= — Saldo de cada locador por moneda, custodia y lo que falta pagarle. */
  @Roles(...BILLING_READ_ROLES)
  @ReadResource('renditions')
  @Get('balances')
  async balances(@Query('currency') currency?: string) {
    return this.ledger.balances({ currency });
  }

  /** GET /owners/:personId/ledger?currency=&from=&to=&page=&limit= — Movimientos con saldo corrido. */
  @Roles(...BILLING_READ_ROLES)
  @ReadResource('renditions')
  @Get(':personId/ledger')
  async ledgerOf(@Param('personId') personId: string, @Query() query: Record<string, unknown>) {
    return this.ledger.ledger(personId, query);
  }

  /** POST /owners/:personId/opening-balance — Saldo inicial por moneda, con motivo. Admin, Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @AuditOperation('owner-opening-balance')
  @Post(':personId/opening-balance')
  @HttpCode(200)
  async openingBalance(@Param('personId') personId: string, @Body() body: unknown) {
    return this.ledger.setOpeningBalance(personId, body);
  }

  /** POST /owners/:personId/payouts — Pago al locador (transferencia o efectivo) desde una cuenta. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('owner-payout')
  @Post(':personId/payouts')
  async payout(@Param('personId') personId: string, @Body() body: unknown) {
    return this.ledger.payout(personId, body);
  }
}

/** Estados de cuenta mensuales consolidados por locador (ADR-0009). */
@Controller('owner-statements')
export class OwnerStatementsController {
  constructor(private readonly statements: OwnerStatementsService) {}

  /** POST /owner-statements/generate?period=YYYY-MM[&personId=] — Borradores del mes. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('owner-statements-generate')
  @Post('generate')
  @HttpCode(200)
  async generate(@Query() query: Record<string, unknown>, @Body() body: Record<string, unknown> | undefined) {
    return this.statements.generate({ ...(body ?? {}), ...query });
  }

  /** GET /owner-statements?period=&personId=&status=&currency=&page=&limit= */
  @Roles(...BILLING_READ_ROLES)
  @ReadResource('renditions')
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    return this.statements.list(query);
  }

  /** GET /owner-statements/:id — Detalle con los movimientos por unidad. */
  @Roles(...BILLING_READ_ROLES)
  @ReadResource('renditions')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.statements.findOne(id);
  }

  /** GET /owner-statements/:id/pdf — Para imprimir o compartir. */
  @Roles(...BILLING_READ_ROLES)
  @ReadResource('renditions')
  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.statements.pdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /** POST /owner-statements/:id/issue — Emite: bloquea los movimientos del mes. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('owner-statement-issue')
  @Post(':id/issue')
  @HttpCode(200)
  async issue(@Param('id') id: string) {
    return this.statements.issue(id);
  }

  /** POST /owner-statements/:id/annul — Anula y libera los movimientos. Admin, Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @AuditOperation('owner-statement-annul')
  @Post(':id/annul')
  @HttpCode(200)
  async annul(@Param('id') id: string, @Body() body: unknown) {
    return this.statements.annul(id, body);
  }
}
