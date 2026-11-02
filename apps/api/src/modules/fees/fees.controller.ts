import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/auth/roles.decorator';
import { BILLING_ROLES, BILLING_VIEW_ROLES, MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { FeesService } from './fees.service';
import { FeeProposalService } from './fee-proposal.service';
import { FeePaymentsService } from './fee-payments.service';

/** Honorarios (D10): alta de alquiler, renovación, venta, tasación; cuotas, coorretaje y comisiones del personal. */
@Controller('fees')
export class FeesController {
  constructor(
    private readonly fees: FeesService,
    private readonly proposal: FeeProposalService,
    private readonly payments: FeePaymentsService,
  ) {}

  /** GET /fees?kind=&status=&payerRole=&payerPersonId=&contractId=&propertyId=&period=YYYY-MM&page=&limit= */
  @Roles(...BILLING_VIEW_ROLES)
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return this.fees.findAll(query);
  }

  /**
   * GET /fees/preview?kind=&contractId=&contractPeriodId=&propertyId=&valuationId=&saleAsset=&baseAmount=&currency=
   * — Propuesta con los valores por defecto de la inmobiliaria (no guarda nada).
   */
  @Roles(...MANAGEMENT_ROLES)
  @Get('preview')
  async preview(@Query() query: Record<string, any>) {
    return this.proposal.preview(query);
  }

  /** GET /fees/installments?kind=&status=&payerRole=&contractId=&period=YYYY-MM — Cuotas con el importe a cobrar. */
  @Roles(...BILLING_VIEW_ROLES)
  @Get('installments')
  async installments(@Query() query: Record<string, any>) {
    return this.fees.findInstallments(query);
  }

  /** GET /fees/:id — Honorario con cuotas (importe a cobrar ajustado), coorretaje y comisiones. */
  @Roles(...BILLING_VIEW_ROLES)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.fees.findOne(id);
  }

  /** POST /fees — Crea el honorario (uno por cada persona que paga). Admin, Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @AuditOperation('fee-create')
  @Post()
  async create(@Body() body: unknown) {
    return this.fees.create(body);
  }

  /** PATCH /fees/:id — Cambia las notas. Admin, Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    return this.fees.update(id, body);
  }

  /** POST /fees/:id/cancel — Anula un honorario sin cobros ni comisiones pagadas. Admin, Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @AuditOperation('fee-cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Body() body: unknown) {
    return this.fees.cancel(id, body);
  }

  /**
   * POST /fees/:id/installments/:n/pay — Cobra una cuota: a una cuenta con recibo
   * (`Caja`) o descontada de la cuenta corriente del locador (`CuentaLocador`).
   * Admin, Gerente, Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @AuditOperation('fee-installment-pay')
  @Post(':id/installments/:n/pay')
  @HttpCode(200)
  async pay(@Param('id') id: string, @Param('n', ParseIntPipe) n: number, @Body() body: unknown) {
    return this.payments.payInstallment(id, n, body);
  }

  /** POST /fees/:id/shares — Coorretaje con otra inmobiliaria. Admin, Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/shares')
  async addShare(@Param('id') id: string, @Body() body: unknown) {
    return this.fees.addShare(id, body);
  }

  /** DELETE /fees/:id/shares/:shareId — Admin, Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @Delete(':id/shares/:shareId')
  async removeShare(@Param('id') id: string, @Param('shareId') shareId: string) {
    return this.fees.removeShare(id, shareId);
  }

  /** POST /fees/:id/staff-commissions — Comisión de una persona del personal. Admin, Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/staff-commissions')
  async addStaffCommission(@Param('id') id: string, @Body() body: unknown) {
    return this.fees.addStaffCommission(id, body);
  }

  /** DELETE /fees/:id/staff-commissions/:commissionId — Solo sin pagar. Admin, Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @Delete(':id/staff-commissions/:commissionId')
  async removeStaffCommission(@Param('id') id: string, @Param('commissionId') commissionId: string) {
    return this.fees.removeStaffCommission(id, commissionId);
  }
}

/** Comisiones del personal sobre los honorarios: lista y pago. Solo la gerencia. */
@Controller('staff-commissions')
export class StaffCommissionsController {
  constructor(private readonly payments: FeePaymentsService) {}

  /** GET /staff-commissions?paid=true|false&userId=&personId=&feeId=&page=&limit= */
  @Roles(...MANAGEMENT_ROLES)
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return this.payments.listStaffCommissions(query);
  }

  /** POST /staff-commissions/:id/pay — Paga la comisión desde una cuenta (ComisionEmpleado). Admin, Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @AuditOperation('staff-commission-pay')
  @Post(':id/pay')
  @HttpCode(200)
  async pay(@Param('id') id: string, @Body() body: unknown) {
    return this.payments.payStaffCommission(id, body);
  }
}
