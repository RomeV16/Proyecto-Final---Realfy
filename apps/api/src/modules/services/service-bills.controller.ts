import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
import { BILLING_ROLES } from '../../common/auth/role-groups';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { ServiceBillsService } from './service-bills.service';

@Controller('service-bills')
export class ServiceBillsController {
  constructor(private readonly bills: ServiceBillsService) {}

  /**
   * GET /service-bills?period=YYYY-MM&propertyId= — Boletas con filtros y paginación.
   * Cualquier usuario autenticado puede leer.
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return this.bills.findAll(query);
  }

  /**
   * GET /service-bills/sheet?period=YYYY-MM — Planilla del mes: un renglón por
   * servicio activo con su boleta del período y quién paga según las reglas.
   */
  @Get('sheet')
  async sheet(@Query('period') period: string, @Query('propertyId') propertyId?: string) {
    return this.bills.sheet(period, propertyId);
  }

  /** GET /service-bills/:id — Boleta con sus partes. */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.bills.findOne(id);
  }

  /**
   * GET /service-bills/:id/allocations — Partes guardadas de la boleta y el
   * reparto que da hoy con las reglas vigentes.
   */
  @Get(':id/allocations')
  async allocations(@Param('id') id: string) {
    return this.bills.allocations(id);
  }

  /**
   * POST /service-bills/bulk — Carga una planilla de boletas (arreglo, hasta 500).
   * Idempotente por (servicio, período, cuota); devuelve el resultado de cada fila.
   * Admin, Gerente, Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @AuditOperation('service-bills-bulk')
  @Post('bulk')
  @HttpCode(200)
  async bulk(@Body() body: unknown) {
    return this.bills.bulk(body);
  }

  /**
   * POST /service-bills/preview — Reparto que daría una boleta sin guardarla (mismos campos que una fila de la
   * carga masiva, con el consumo por unidad). Admin, Gerente, Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @Post('preview')
  @HttpCode(200)
  async preview(@Body() body: unknown) {
    return this.bills.preview(body);
  }

  /**
   * PATCH /service-bills/:id — Corrige importe, vencimiento, consumo o registra
   * el pago (quién pagó, cuándo, comprobante). Admin, Gerente, Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.bills.update(id, body);
  }
}
