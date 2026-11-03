import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { BILLING_READ_ROLES, BILLING_ROLES, MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { Roles } from '../../common/auth/roles.decorator';
import { LessorInvoicingService } from './lessor-invoicing.service';

/**
 * Facturación por cuenta del locador (ADR-0017). Las rutas de `/invoices/pending` van antes que
 * las de `InvoicesController` (`GET /invoices/:id`) para no confundirse con un id.
 */
@Controller()
export class LessorInvoicingController {
  constructor(private readonly lessorInvoicing: LessorInvoicingService) {}

  /** GET /persons/:id/invoicing-settings — Emisor delegado, lo que definió el locador y lo que rige. */
  @Roles(...BILLING_READ_ROLES)
  @Get('persons/:id/invoicing-settings')
  settings(@Param('id', ParseUUIDPipe) id: string) {
    return this.lessorInvoicing.getSettings(id);
  }

  /** PUT /persons/:id/invoicing-settings — Qué, cuándo y con qué IVA se factura por este locador. */
  @Roles(...MANAGEMENT_ROLES)
  @AuditOperation('lessor-invoicing-settings')
  @Put('persons/:id/invoicing-settings')
  saveSettings(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.lessorInvoicing.saveSettings(id, body);
  }

  /** POST /persons/:id/invoicing-issuer — Alta del emisor delegado del locador (con su CUIT y condición). */
  @Roles(...MANAGEMENT_ROLES)
  @AuditOperation('lessor-issuer-create')
  @Post('persons/:id/invoicing-issuer')
  createIssuer(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.lessorInvoicing.createIssuer(id, body);
  }

  /** GET /payments/:id/invoices — Comprobantes y trabajos de facturación de un cobro. */
  @Roles(...BILLING_READ_ROLES)
  @Get('payments/:id/invoices')
  paymentInvoices(@Param('id', ParseUUIDPipe) id: string) {
    return this.lessorInvoicing.listForSource('Payment', id);
  }

  /** POST /payments/:id/invoices — Factura el cobro por cuenta de cada locador (o del indicado). */
  @Roles(...BILLING_ROLES)
  @AuditOperation('lessor-invoice-payment')
  @Post('payments/:id/invoices')
  @HttpCode(200)
  invoicePayment(@Param('id', ParseUUIDPipe) id: string, @Body() body: { personId?: string } | undefined) {
    return this.lessorInvoicing.invoicePayment(id, body ?? {});
  }

  /** GET /owner-statements/:id/invoices — Comprobantes y trabajos de facturación de un estado de cuenta. */
  @Roles(...BILLING_READ_ROLES)
  @Get('owner-statements/:id/invoices')
  statementInvoices(@Param('id', ParseUUIDPipe) id: string) {
    return this.lessorInvoicing.listForSource('OwnerStatement', id);
  }

  /** POST /owner-statements/:id/invoices — Factura un estado de cuenta emitido por cuenta de su locador. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('lessor-invoice-statement')
  @Post('owner-statements/:id/invoices')
  @HttpCode(200)
  invoiceStatement(@Param('id', ParseUUIDPipe) id: string) {
    return this.lessorInvoicing.invoiceStatement(id);
  }

  /** GET /invoices/pending?status=&personId=&page=&limit= — Cola de emisión (pendientes y fallidas por defecto). */
  @Roles(...BILLING_READ_ROLES)
  @Get('invoices/pending')
  pending(@Query() query: Record<string, unknown>) {
    return this.lessorInvoicing.listJobs(query);
  }

  /** POST /invoices/pending/run — Pone en cola lo automático y emite lo pendiente. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('lessor-invoices-run')
  @Post('invoices/pending/run')
  @HttpCode(200)
  run(@Body() body: { retryAll?: boolean; personId?: string } | undefined) {
    return this.lessorInvoicing.runPending({ retryAll: body?.retryAll === true, personId: body?.personId });
  }
}
