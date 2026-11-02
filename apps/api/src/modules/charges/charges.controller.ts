import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
import { BILLING_ROLES } from '../../common/auth/role-groups';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { ChargesService } from './charges.service';

@Controller('charges')
export class ChargesController {
  constructor(private readonly charges: ChargesService) {}

  /**
   * GET /charges?contractId=&propertyId=&status=&chargedTo=&period=YYYY-MM&requiresUpfront=
   * — Cargos pendientes con filtros y paginación. Cualquier usuario autenticado puede leer.
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return this.charges.findAll(query);
  }

  /** GET /charges/:id — Un cargo con su propiedad, contrato y locador. */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.charges.findOne(id);
  }

  /**
   * POST /charges — Carga un gasto o cargo del mes (con `installments` crea una
   * cuota por mes). Devuelve `{ items }`. Admin, Gerente, Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @AuditOperation('pending-charge-create')
  @Post()
  async create(@Body() body: unknown) {
    return this.charges.create(body);
  }

  /**
   * POST /charges/bulk — Carga una planilla de cargos (hasta 200 filas); cada
   * fila se valida por separado. Admin, Gerente, Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @AuditOperation('pending-charge-bulk')
  @Post('bulk')
  @HttpCode(200)
  async bulk(@Body() body: unknown) {
    return this.charges.bulk(body);
  }

  /**
   * PATCH /charges/:id — Corrige un cargo Pendiente; `requiresUpfront: false`
   * lo fuerza a imputarse en la liquidación. Admin, Gerente, Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    return this.charges.update(id, body);
  }

  /** POST /charges/:id/cancel — Anula un cargo Pendiente. Admin, Gerente, Liquidaciones. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('pending-charge-cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string) {
    return this.charges.cancel(id);
  }

  /**
   * POST /charges/:id/mark-paid-upfront — El inquilino pagó el cargo por
   * adelantado: pasa a CobradoAnticipado y no entra en la liquidación.
   * Admin, Gerente, Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @AuditOperation('pending-charge-paid-upfront')
  @Post(':id/mark-paid-upfront')
  @HttpCode(200)
  async markPaidUpfront(@Param('id') id: string) {
    return this.charges.markPaidUpfront(id);
  }

  /**
   * POST /charges/:id/release — Devuelve a Pendiente un cargo imputado en una
   * liquidación anulada. Admin, Gerente, Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @AuditOperation('pending-charge-release')
  @Post(':id/release')
  @HttpCode(200)
  async release(@Param('id') id: string) {
    return this.charges.release(id);
  }
}
