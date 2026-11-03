import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { ADMIN_ONLY, INBOX_ROLES, MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { Public } from '../../common/auth/public.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { MessagingConfigService } from '../../common/messaging/messaging-config.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { InboxEmailService } from './inbox-email.service';
import { assertEmailIngestSignature } from './inbox-signature';
import { InboxSlaScheduler } from './inbox-sla.scheduler';
import { InboxService } from './inbox.service';

/**
 * Bandeja de consultas: WhatsApp, mail, formulario del micrositio y llamadas de la
 * inmobiliaria con responsable y plazo de primera respuesta (ADR-0013). La usa quien
 * atiende a clientes; la configuración la cambia la administración.
 */
@Roles(...INBOX_ROLES)
@Controller('conversations')
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly sla: InboxSlaScheduler,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** GET /conversations?status=&open=&channel=&assignee=&slaBreached=&search=&page=&limit= */
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    return this.inbox.list(query);
  }

  /** GET /conversations/summary — Contadores del menú (sin leer, plazo vencido, sin responsable). */
  @Get('summary')
  async summary() {
    return this.inbox.summary();
  }

  /** GET /conversations/settings — SLA, horario de atención, autorrespuesta y respuestas rápidas. */
  @Get('settings')
  async getSettings() {
    return this.inbox.getSettings();
  }

  /** PUT /conversations/settings — Reemplaza la configuración de la bandeja (Admin y Gerente). */
  @Roles(...MANAGEMENT_ROLES)
  @AuditOperation('inbox-update-settings')
  @Put('settings')
  async updateSettings(@Body() body: unknown) {
    return this.inbox.updateSettings(body);
  }

  /** POST /conversations/calls — Registrar llamada: anota un llamado como consulta de canal Telefono. */
  @AuditOperation('inbox-register-call')
  @Post('calls')
  async registerCall(@Body() body: unknown) {
    return this.inbox.registerCall(body);
  }

  /**
   * POST /conversations/_run-sla — Una vuelta del control de plazos para la inmobiliaria
   * del pedido. Solo Admin, y solo con NODE_ENV=test o E2E_TEST_MODE=1.
   */
  @Roles(...ADMIN_ONLY)
  @Post('_run-sla')
  @HttpCode(200)
  async runSla() {
    if (process.env.NODE_ENV !== 'test' && process.env.E2E_TEST_MODE !== '1') {
      throw new ForbiddenException({ error: 'TEST_ONLY', message: 'Only available in test mode' });
    }
    return { flagged: await this.sla.flagTenant(this.tenantContext.getTenantId()!, new Date()) };
  }

  /** GET /conversations/:id — El hilo, la contraparte, el plazo y por dónde saldría una respuesta. */
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.get(id);
  }

  /** POST /conversations/:id/read — Marca como leídos los mensajes del cliente. */
  @Post(':id/read')
  @HttpCode(200)
  async markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.inbox.markRead(id);
  }

  /** POST /conversations/:id/reply — Responde por el mismo canal (o por mail), encolando en la bandeja de salida. */
  @AuditOperation('inbox-reply')
  @Post(':id/reply')
  @HttpCode(200)
  async reply(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.inbox.reply(id, body);
  }

  /** PUT /conversations/:id/assignee — Asigna o desasigna al responsable. */
  @AuditOperation('inbox-assign')
  @Put(':id/assignee')
  async assign(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.inbox.assign(id, body);
  }

  /** PUT /conversations/:id/status — Cambia el estado de la consulta. */
  @AuditOperation('inbox-change-status')
  @Put(':id/status')
  async changeStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.inbox.changeStatus(id, body);
  }

  /** PUT /conversations/:id/links — Vincula la consulta con una persona, un interés, una propiedad o un contrato. */
  @AuditOperation('inbox-link')
  @Put(':id/links')
  async link(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.inbox.link(id, body);
  }
}

/**
 * Entrada del mail reenviado a la bandeja. Es una ruta pública, pero cada pedido se
 * rechaza si la firma (`X-Realfy-Signature: sha256=<hex>`, HMAC-SHA256 del cuerpo crudo
 * con INBOX_EMAIL_INGEST_SECRET) no coincide; sin secreto configurado se rechazan todos.
 */
@Public()
@SkipThrottle()
@Controller('inbox')
export class InboxEmailController {
  private readonly logger = new Logger(InboxEmailController.name);

  constructor(
    private readonly config: MessagingConfigService,
    private readonly email: InboxEmailService,
  ) {}

  /** POST /inbox/email-ingest — Un mail recibido en la casilla de consultas. */
  @Post('email-ingest')
  @HttpCode(200)
  async emailIngest(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-realfy-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    // Mismo esquema de firma que Meta (sha256=<hex> sobre el cuerpo crudo), con otro secreto.
    assertEmailIngestSignature(this.config, req, signature, this.logger);
    return this.email.ingestEmail(body);
  }
}
