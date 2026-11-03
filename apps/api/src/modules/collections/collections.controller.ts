import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { ADMIN_ONLY, BILLING_READ_ROLES, BILLING_ROLES, MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { Roles } from '../../common/auth/roles.decorator';
import { CollectionLetterService } from './collection-letter.service';
import { CollectionsProcessService } from './collections-process.service';
import { CollectionsService } from './collections.service';

/** Cobranza escalonada (ADR-0013): casos por contrato, su línea de tiempo y las acciones manuales. */
@Controller('collection-cases')
export class CollectionsController {
  constructor(
    private readonly collections: CollectionsService,
    private readonly letters: CollectionLetterService,
    private readonly process: CollectionsProcessService,
  ) {}

  /** GET /collection-cases?stage=&minDays=&assigneeId=&contractId=&page=&limit= — sin `stage`, solo los abiertos. */
  @Roles(...BILLING_READ_ROLES)
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    return this.collections.list(query);
  }

  /**
   * POST /collection-cases/_run-now — Una vuelta del proceso diario para la inmobiliaria del
   * pedido, opcionalmente a otro día `{ today: 'YYYY-MM-DD' }`. Solo Admin, y solo con
   * NODE_ENV=test o E2E_TEST_MODE=1.
   */
  @Roles(...ADMIN_ONLY)
  @Post('_run-now')
  @HttpCode(200)
  async runNow(@Body() body: { today?: string } = {}) {
    if (process.env.NODE_ENV !== 'test' && process.env.E2E_TEST_MODE !== '1') {
      throw new ForbiddenException({ error: 'TEST_ONLY', message: 'Only available in test mode' });
    }
    const today = body?.today ? new Date(`${body.today}T00:00:00.000Z`) : undefined;
    return this.process.runTenant(this.collections.currentTenantId(), today);
  }

  /** GET /collection-cases/:id — El caso con su deuda de hoy y su línea de tiempo. */
  @Roles(...BILLING_READ_ROLES)
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.collections.get(id);
  }

  /** PATCH /collection-cases/:id — Quién lleva el caso { assigneeId | null }. */
  @Roles(...BILLING_ROLES)
  @Patch(':id')
  async assign(@Param('id') id: string, @Body() body: unknown) {
    return this.collections.assign(id, body);
  }

  /** POST /collection-cases/:id/notes — Agrega una nota { note }. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('collection-note')
  @Post(':id/notes')
  @HttpCode(200)
  async note(@Param('id') id: string, @Body() body: unknown) {
    return this.collections.addNote(id, body);
  }

  /** POST /collection-cases/:id/agreement — Acuerdo de pago { payOn, amount?, note? }: pausa los avisos hasta esa fecha. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('collection-agreement')
  @Post(':id/agreement')
  @HttpCode(200)
  async agreement(@Param('id') id: string, @Body() body: unknown) {
    return this.collections.agree(id, body);
  }

  /** PATCH /collection-cases/:id/actions/:actionId — Edita el borrador de la carta documento. */
  @Roles(...BILLING_ROLES)
  @Patch(':id/actions/:actionId')
  async editLetter(@Param('id') id: string, @Param('actionId') actionId: string, @Body() body: unknown) {
    return this.collections.updateLetter(id, actionId, body);
  }

  /** GET /collection-cases/:id/actions/:actionId/letter.pdf — Borrador de la carta documento en PDF. */
  @Roles(...BILLING_READ_ROLES)
  @Get(':id/actions/:actionId/letter.pdf')
  async letterPdf(@Param('id') id: string, @Param('actionId') actionId: string, @Res() res: Response) {
    const { buffer, filename } = await this.letters.pdf(id, actionId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  /** POST /collection-cases/:id/actions/:actionId/sent — Confirma que la carta se mandó en papel { sentOn, note? }. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('collection-letter-sent')
  @Post(':id/actions/:actionId/sent')
  @HttpCode(200)
  async letterSent(@Param('id') id: string, @Param('actionId') actionId: string, @Body() body: unknown) {
    return this.collections.confirmLetterSent(id, actionId, body);
  }

  /** POST /collection-cases/:id/derive — Deriva a un abogado { lawyer?, note? }. Admin y Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @AuditOperation('collection-derive')
  @Post(':id/derive')
  @HttpCode(200)
  async derive(@Param('id') id: string, @Body() body: unknown) {
    return this.collections.derive(id, body);
  }

  /** POST /collection-cases/:id/judicial — Pasa a la vía judicial { note? }. Admin y Gerente. */
  @Roles(...MANAGEMENT_ROLES)
  @AuditOperation('collection-judicial')
  @Post(':id/judicial')
  @HttpCode(200)
  async judicial(@Param('id') id: string, @Body() body: unknown) {
    return this.collections.judicialize(id, body);
  }

  /** POST /collection-cases/:id/close — Cierra el caso a mano { note }. */
  @Roles(...BILLING_ROLES)
  @AuditOperation('collection-close')
  @Post(':id/close')
  @HttpCode(200)
  async close(@Param('id') id: string, @Body() body: unknown) {
    return this.collections.close(id, body);
  }
}
