import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  Delete,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TicketsService } from './tickets.service';
import { Roles } from '../../common/auth/roles.decorator';
import { BILLING_ROLES, SUPPORT_ROLES } from '../../common/auth/role-groups';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { TicketQuotesService } from './ticket-quotes.service';
import { TicketRepairsService } from './ticket-repairs.service';

@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly quotes: TicketQuotesService,
    private readonly repairs: TicketRepairsService,
  ) {}

  /**
   * POST /tickets — Create a ticket.
   * Admin, Gerente, Soporte can create.
   */
  @Roles(...SUPPORT_ROLES)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.ticketsService.create(body);
  }

  /**
   * GET /tickets — List with filters + pagination.
   * Any authenticated user can read (Lectura included via ticket:read).
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    // Coerce numeric query params from strings
    const coerced = { ...query };
    if (coerced.page !== undefined) coerced.page = Number(coerced.page);
    if (coerced.limit !== undefined) coerced.limit = Number(coerced.limit);
    return this.ticketsService.findAll(coerced);
  }

  /**
   * GET /tickets/:id — Full detail with comments, attachments, valid transitions.
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.ticketsService.findOne(id);
  }

  /**
   * PATCH /tickets/:id — Update ticket fields.
   * Admin, Gerente, Soporte.
   */
  @Roles(...SUPPORT_ROLES)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.ticketsService.update(id, body);
  }

  /**
   * POST /tickets/:id/transition — Validate and apply state transition.
   * Admin, Gerente, Soporte.
   */
  @Roles(...SUPPORT_ROLES)
  @Post(':id/transition')
  @HttpCode(200)
  async transition(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.ticketsService.transition(id, body);
  }

  /**
   * POST /tickets/:id/assign-provider — Assign a provider to a ticket.
   * Admin, Gerente, Soporte.
   */
  @Roles(...SUPPORT_ROLES)
  @Post(':id/assign-provider')
  @HttpCode(200)
  async assignProvider(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.ticketsService.assignProvider(id, body);
  }

  /**
   * PATCH /tickets/:id/cost — Update cost tracking fields.
   * Admin, Gerente, Soporte.
   */
  @Roles(...SUPPORT_ROLES)
  @Patch(':id/cost')
  async updateCost(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.ticketsService.updateCost(id, body);
  }

  /**
   * POST /tickets/:id/comments — Add comment with optional photo.
   * Admin, Gerente, Soporte.
   */
  @Roles(...SUPPORT_ROLES)
  @Post(':id/comments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
      fileFilter: (_req: any, file: any, cb: any) => {
        if (!file.mimetype.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
        } else {
          cb(null, true);
        }
      },
    }),
  )
  async addComment(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.ticketsService.addComment(id, body, file);
  }

  /**
   * GET /tickets/:id/comments — List comments with attachments.
   */
  @Get(':id/comments')
  async listComments(@Param('id') id: string) {
    return this.ticketsService.listComments(id);
  }

  // ─── Incidencias y reparaciones ─────────────────────

  /**
   * POST /tickets/:id/estimate — Anota el costo estimado; si supera el límite sin
   * preautorización pasa a PendienteAutorizacion. Admin, Gerente, Soporte.
   */
  @Roles(...SUPPORT_ROLES)
  @AuditOperation('ticket-estimate')
  @Post(':id/estimate')
  @HttpCode(200)
  async estimate(@Param('id') id: string, @Body() body: unknown) {
    return this.quotes.estimate(id, body);
  }

  /**
   * POST /tickets/:id/preauthorize — Registra la preautorización del locador (tope,
   * quién, canal) y pasa a Presupuestado. Admin, Gerente, Soporte.
   */
  @Roles(...SUPPORT_ROLES)
  @AuditOperation('ticket-preauthorize')
  @Post(':id/preauthorize')
  @HttpCode(200)
  async preauthorize(@Param('id') id: string, @Body() body: unknown) {
    return this.quotes.preauthorize(id, body);
  }

  /** GET /tickets/:id/quotes — Presupuestos del ticket. */
  @Get(':id/quotes')
  async listQuotes(@Param('id') id: string) {
    return this.quotes.listQuotes(id);
  }

  /** POST /tickets/:id/quotes — Carga un presupuesto de un proveedor. Admin, Gerente, Soporte. */
  @Roles(...SUPPORT_ROLES)
  @Post(':id/quotes')
  async createQuote(@Param('id') id: string, @Body() body: unknown) {
    return this.quotes.createQuote(id, body);
  }

  /** PATCH /tickets/:id/quotes/:quoteId — Corrige un presupuesto pendiente. Admin, Gerente, Soporte. */
  @Roles(...SUPPORT_ROLES)
  @Patch(':id/quotes/:quoteId')
  async updateQuote(@Param('id') id: string, @Param('quoteId') quoteId: string, @Body() body: unknown) {
    return this.quotes.updateQuote(id, quoteId, body);
  }

  /** DELETE /tickets/:id/quotes/:quoteId — Quita un presupuesto pendiente. Admin, Gerente, Soporte. */
  @Roles(...SUPPORT_ROLES)
  @Delete(':id/quotes/:quoteId')
  async removeQuote(@Param('id') id: string, @Param('quoteId') quoteId: string) {
    return this.quotes.removeQuote(id, quoteId);
  }

  /** POST /tickets/:id/quotes/:quoteId/reject — Descarta un presupuesto pendiente. Admin, Gerente, Soporte. */
  @Roles(...SUPPORT_ROLES)
  @Post(':id/quotes/:quoteId/reject')
  @HttpCode(200)
  async rejectQuote(@Param('id') id: string, @Param('quoteId') quoteId: string) {
    return this.quotes.rejectQuote(id, quoteId);
  }

  /**
   * POST /tickets/:id/quotes/:quoteId/approve — Aprueba un presupuesto: quién lo
   * aprobó y por qué canal. Admin, Gerente, Soporte.
   */
  @Roles(...SUPPORT_ROLES)
  @Post(':id/quotes/:quoteId/approve')
  @HttpCode(200)
  async approveQuote(@Param('id') id: string, @Param('quoteId') quoteId: string, @Body() body: unknown) {
    return this.quotes.approveQuote(id, quoteId, body);
  }

  /** GET /tickets/:id/provider-payments — Pagos al proveedor del ticket (movimientos del libro). */
  @Get(':id/provider-payments')
  async listPayments(@Param('id') id: string) {
    return this.repairs.listPayments(id);
  }

  /**
   * POST /tickets/:id/provider-payments — Paga al proveedor desde una cuenta de la
   * inmobiliaria (movimiento PagoProveedor). Admin, Gerente, Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @Post(':id/provider-payments')
  async registerPayment(@Param('id') id: string, @Body() body: unknown) {
    return this.repairs.registerPayment(id, body);
  }

  /**
   * POST /tickets/:id/impute — Imputa lo pagado a quien lo soporta (una sola vez) y,
   * si se pide, el honorario por gestión. Admin, Gerente, Liquidaciones.
   */
  @Roles(...BILLING_ROLES)
  @AuditOperation('ticket-impute')
  @Post(':id/impute')
  @HttpCode(200)
  async impute(@Param('id') id: string, @Body() body: unknown) {
    return this.repairs.impute(id, body);
  }
}
