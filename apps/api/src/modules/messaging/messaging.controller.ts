import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { UserRole } from '@realfy/shared';
import { Roles } from '../../common/auth/roles.decorator';
import { ADMIN_ONLY, BILLING_ROLES, BILLING_VIEW_ROLES, MANAGEMENT_ROLES, SALES_ROLES } from '../../common/auth/role-groups';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { ConsentsService } from './consents.service';
import { DocumentMessagesService } from './document-messages.service';
import { OutboxAdminService } from './outbox-admin.service';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

/** Quien atiende a la cartera registra el alta o la baja: comercial y liquidaciones. */
const CONSENT_EDIT_ROLES: readonly UserRole[] = [...SALES_ROLES, UserRole.Liquidaciones];

/** Bandeja de salida (ADR-0013). */
@Controller('outbox')
export class OutboxController {
  constructor(
    private readonly admin: OutboxAdminService,
    private readonly documents: DocumentMessagesService,
    private readonly dispatcher: OutboxDispatcherService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** GET /outbox?status=&channel=&personId=&relatedType=&relatedId=&page=&limit= */
  @Roles(...BILLING_VIEW_ROLES)
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    return this.admin.list(query);
  }

  /** POST /outbox/send — Encola un recibo o un estado de cuenta para su destinatario. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('outbox-send-document')
  @Post('send')
  @HttpCode(200)
  async send(@Body() body: unknown) {
    return this.documents.send(body);
  }

  /** POST /outbox/:id/retry — Vuelve a encolar un mensaje fallido, bloqueado o cancelado. */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/retry')
  @HttpCode(200)
  async retry(@Param('id') id: string) {
    return this.admin.retry(id);
  }

  /** POST /outbox/:id/cancel — Cancela un mensaje que todavía no salió. */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string) {
    return this.admin.cancel(id);
  }

  /**
   * POST /outbox/_run-now — Una vuelta del despacho para la inmobiliaria del
   * pedido. Solo Admin, y solo con NODE_ENV=test o E2E_TEST_MODE=1.
   */
  @Roles(...ADMIN_ONLY)
  @Post('_run-now')
  @HttpCode(200)
  async runNow() {
    if (process.env.NODE_ENV !== 'test' && process.env.E2E_TEST_MODE !== '1') {
      throw new ForbiddenException({ error: 'TEST_ONLY', message: 'Only available in test mode' });
    }
    return this.dispatcher.dispatchTenant(this.tenantContext.getTenantId()!);
  }
}

/** Configuración → Mensajería. */
@Controller('messaging')
export class MessagingSettingsController {
  constructor(private readonly admin: OutboxAdminService) {}

  /** GET /messaging/settings — Modo del ambiente, proveedores, horario y plantillas. */
  @Roles(...MANAGEMENT_ROLES)
  @Get('settings')
  async settings() {
    return this.admin.settings();
  }
}

/** Consentimiento de una persona por canal (Ley 25.326). */
@Controller('persons')
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  /** GET /persons/:id/consents — Vigente por canal, con el historial. */
  @Roles(...BILLING_VIEW_ROLES)
  @Get(':id/consents')
  async list(@Param('id') id: string) {
    return this.consents.forPerson(id);
  }

  /** PUT /persons/:id/consents — Registra un alta o una baja { channel, status, note? }. */
  @Roles(...CONSENT_EDIT_ROLES)
  @Put(':id/consents')
  async set(@Param('id') id: string, @Body() body: unknown) {
    return this.consents.set(id, body);
  }
}
