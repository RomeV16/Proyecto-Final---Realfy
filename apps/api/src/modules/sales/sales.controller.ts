import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { UserRole } from '@realfy/shared';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { MANAGEMENT_ROLES, SALES_ROLES } from '../../common/auth/role-groups';
import { Roles } from '../../common/auth/roles.decorator';
import { SalesDepositsService } from './sales-deposits.service';
import { SalesFeesService } from './sales-fees.service';
import { SalesService } from './sales.service';

/** Lectura de ventas: comercial, administración y solo lectura. */
const SALES_READ_ROLES: readonly UserRole[] = [...SALES_ROLES, UserRole.Lectura];

/** Ventas por propiedad. */
@Controller('properties/:propertyId/sales-operations')
export class PropertySalesController {
  constructor(private readonly sales: SalesService) {}

  /** GET /properties/:propertyId/sales-operations — la operación abierta (si hay) y el historial. */
  @Roles(...SALES_READ_ROLES)
  @Get()
  async list(@Param('propertyId') propertyId: string) {
    return this.sales.findByProperty(propertyId);
  }
}

/** Operaciones de venta: embudo, partes, reservas y señas, documentación y honorario. */
@Controller('sales-operations')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly deposits: SalesDepositsService,
    private readonly fees: SalesFeesService,
  ) {}

  /** GET /sales-operations?status=&open=&propertyId=&personId=&exclusive=&page=&limit= */
  @Roles(...SALES_READ_ROLES)
  @Get()
  async findAll(@Query() query: Record<string, unknown>) {
    return this.sales.findAll(query);
  }

  /** GET /sales-operations/deposits/pending?holder=&status= — señas y reservas con dinero en juego. */
  @Roles(...SALES_READ_ROLES)
  @Get('deposits/pending')
  async pendingDeposits(@Query() query: Record<string, unknown>) {
    return this.deposits.pending(query);
  }

  /** GET /sales-operations/:id */
  @Roles(...SALES_READ_ROLES)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.sales.findOne(id);
  }

  /** POST /sales-operations — alta (una operación abierta por propiedad). */
  @Roles(...SALES_ROLES)
  @Post()
  @AuditOperation('sales-create')
  async create(@Body() body: unknown) {
    return this.sales.create(body);
  }

  /** PATCH /sales-operations/:id — exclusividad, precios, responsable, notas. */
  @Roles(...SALES_ROLES)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    return this.sales.update(id, body);
  }

  /** PUT /sales-operations/:id/parties — reemplaza compradores y vendedores. */
  @Roles(...SALES_ROLES)
  @Put(':id/parties')
  @AuditOperation('sales-parties')
  async setParties(@Param('id') id: string, @Body() body: unknown) {
    return this.sales.setParties(id, body);
  }

  /** PATCH /sales-operations/:id/docs/:code — tilda un renglón de la documentación. */
  @Roles(...SALES_ROLES)
  @Patch(':id/docs/:code')
  @AuditOperation('sales-doc-check')
  async updateDoc(@Param('id') id: string, @Param('code') code: string, @Body() body: unknown) {
    return this.sales.updateDoc(id, code, body);
  }

  /** POST /sales-operations/:id/transition — cambio de etapa. */
  @Roles(...SALES_ROLES)
  @Post(':id/transition')
  @AuditOperation('sales-transition')
  @HttpCode(200)
  async transition(@Param('id') id: string, @Body() body: unknown) {
    return this.sales.transition(id, body);
  }

  /** POST /sales-operations/:id/deposits — alta de una reserva o seña. */
  @Roles(...SALES_ROLES)
  @Post(':id/deposits')
  @AuditOperation('sales-deposit-create')
  async createDeposit(@Param('id') id: string, @Body() body: unknown) {
    return this.deposits.create(id, body);
  }

  /** PATCH /sales-operations/:id/deposits/:depositId — vencimiento (prórroga) y notas. */
  @Roles(...SALES_ROLES)
  @Patch(':id/deposits/:depositId')
  async updateDeposit(@Param('id') id: string, @Param('depositId') depositId: string, @Body() body: unknown) {
    return this.deposits.update(id, depositId, body);
  }

  /** POST /sales-operations/:id/deposits/:depositId/receive — el dinero entró (a caja si lo guarda la inmobiliaria). */
  @Roles(...SALES_ROLES)
  @Post(':id/deposits/:depositId/receive')
  @AuditOperation('sales-deposit-receive')
  @HttpCode(200)
  async receive(@Param('id') id: string, @Param('depositId') depositId: string, @Body() body: unknown) {
    return this.deposits.receive(id, depositId, body);
  }

  /** POST /sales-operations/:id/deposits/:depositId/refund — devolución al comprador. Admin y Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/deposits/:depositId/refund')
  @AuditOperation('sales-deposit-refund')
  @HttpCode(200)
  async refund(@Param('id') id: string, @Param('depositId') depositId: string, @Body() body: unknown) {
    return this.deposits.refund(id, depositId, body);
  }

  /** POST /sales-operations/:id/deposits/:depositId/forfeit — retención (se registra; no mueve la caja). Admin y Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/deposits/:depositId/forfeit')
  @AuditOperation('sales-deposit-forfeit')
  @HttpCode(200)
  async forfeit(@Param('id') id: string, @Param('depositId') depositId: string, @Body() body: unknown) {
    return this.deposits.forfeit(id, depositId, body);
  }

  /** GET /sales-operations/:id/fee-proposal — honorario sugerido con los valores por defecto. */
  @Roles(...MANAGEMENT_ROLES)
  @Get(':id/fee-proposal')
  async feeProposal(@Param('id') id: string) {
    return this.fees.preview(id);
  }

  /** POST /sales-operations/:id/fee — crea el honorario de la venta. Admin y Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/fee')
  @AuditOperation('sales-fee-create')
  async createFee(@Param('id') id: string, @Body() body: unknown) {
    return this.fees.create(id, body);
  }
}
