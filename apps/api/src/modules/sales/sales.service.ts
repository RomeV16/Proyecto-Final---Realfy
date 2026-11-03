import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateSalesOperationSchema,
  OPEN_SALES_STATUSES,
  SALES_DOC_TEMPLATE,
  SalesDepositStatus,
  SalesFilterSchema,
  SalesOperationStatus,
  SalesPartyRole,
  SetSalesPartiesSchema,
  TransitionSalesSchema,
  UpdateSalesDocCheckSchema,
  UpdateSalesOperationSchema,
  blocksLeavingStage,
  salesMachine,
  todayInAR,
} from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { assertTransition } from '../../common/errors/assert-transition';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { auditJson, badRequest, conflict, dayStart, notFound } from '../cash/cash.errors';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { Db, OPERATION_INCLUDE, assertOpen, findOperation, lockOperation, presentOperation } from './sales.helpers';

/**
 * Ventas (D14): de la captación a la escritura. La escritura se registra como estado final y
 * fecha; no se gestiona. Reservas y señas están en `SalesDepositsService` y el honorario, en
 * `SalesFeesService`. Cada cambio de etapa se audita.
 */
@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly defaults: OperationalDefaultsService,
  ) {}

  /** Embudo: filtros por etapa, propiedad, persona y exclusividad; las más nuevas primero. */
  async findAll(query: unknown) {
    const filters = parseOrThrow(SalesFilterSchema, query, 'Invalid filter parameters');
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    else if (filters.open !== undefined) where.status = filters.open ? { in: OPEN_SALES_STATUSES } : { notIn: OPEN_SALES_STATUSES };
    if (filters.propertyId) where.propertyId = filters.propertyId;
    if (filters.exclusive !== undefined) where.exclusive = filters.exclusive;
    if (filters.personId) where.parties = { some: { personId: filters.personId } };
    const [rows, total] = await Promise.all([
      this.prisma.client.salesOperation.findMany({
        where,
        include: OPERATION_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.salesOperation.count({ where }),
    ]);
    const today = todayInAR();
    return {
      items: rows.map((row: any) => presentOperation(row, today)),
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  async findOne(id: string) {
    const op = await findOperation(this.prisma.client, id);
    return presentOperation(op, todayInAR());
  }

  /** Operaciones de venta de una propiedad (la abierta, si hay, y el historial). */
  async findByProperty(propertyId: string) {
    const rows = await this.prisma.client.salesOperation.findMany({
      where: { propertyId },
      include: OPERATION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const today = todayInAR();
    return { items: rows.map((row: any) => presentOperation(row, today)) };
  }

  /** Alta: una propiedad tiene a lo sumo una operación abierta. Crea también la lista de documentación. */
  async create(data: unknown) {
    const input = parseOrThrow(CreateSalesOperationSchema, data, 'Invalid sales operation');
    const tenantId = this.tenantContext.getTenantId()!;
    const id = await this.prisma.client.$transaction(async (tx: Db) => {
      await this.lockProperty(tx, tenantId, input.propertyId);
      const open = await tx.salesOperation.count({
        where: { propertyId: input.propertyId, status: { in: OPEN_SALES_STATUSES } },
      });
      if (open > 0) throw conflict('SALES_OPERATION_EXISTS', 'The property already has an open sales operation');
      await this.assertPeople(tx, input.parties.map((p) => p.personId));
      await this.assertUser(tx, input.agentUserId);
      const op = await tx.salesOperation.create({
        data: {
          tenantId,
          propertyId: input.propertyId,
          status: input.status,
          exclusive: input.exclusive,
          price: input.price ?? null,
          currency: input.currency,
          agentUserId: input.agentUserId ?? null,
          notes: input.notes ?? null,
          createdById: this.tenantContext.getUserId() ?? null,
        },
      });
      if (input.parties.length) {
        await tx.salesParty.createMany({
          data: input.parties.map((p) => ({ tenantId, salesOpId: op.id, role: p.role, personId: p.personId, sharePct: p.sharePct })),
        });
      }
      await tx.salesDocCheck.createMany({
        data: SALES_DOC_TEMPLATE.map((item) => ({ tenantId, salesOpId: op.id, code: item.code, required: item.required })),
      });
      await this.audit.record(tx, { action: 'CREATE', entity: 'SalesOperation', entityId: op.id, after: auditJson(op), metadata: { operation: 'sales-create' } });
      return op.id as string;
    });
    this.logger.log('Sales operation created', { id });
    return this.findOne(id);
  }

  /** Cambia exclusividad, precios, moneda, responsable y notas (mientras esté abierta). */
  async update(id: string, data: unknown) {
    const input = parseOrThrow(UpdateSalesOperationSchema, data, 'Invalid sales operation');
    const tenantId = this.tenantContext.getTenantId()!;
    await this.prisma.client.$transaction(async (tx: Db) => {
      await lockOperation(tx, tenantId, id);
      const current = await findOperation(tx, id, {});
      assertOpen(current);
      await this.assertUser(tx, input.agentUserId);
      const patch: Record<string, unknown> = {};
      for (const key of ['exclusive', 'price', 'agreedPrice', 'currency', 'agentUserId', 'notes'] as const) {
        if (input[key] !== undefined) patch[key] = input[key];
      }
      const updated = await tx.salesOperation.update({ where: { id }, data: patch });
      await this.audit.record(tx, { action: 'UPDATE', entity: 'SalesOperation', entityId: id, before: auditJson(current), after: auditJson(updated) });
    });
    return this.findOne(id);
  }

  /** Reemplaza las partes (compradores y vendedores con su porcentaje). */
  async setParties(id: string, data: unknown) {
    const input = parseOrThrow(SetSalesPartiesSchema, data, 'Invalid parties');
    const tenantId = this.tenantContext.getTenantId()!;
    await this.prisma.client.$transaction(async (tx: Db) => {
      await lockOperation(tx, tenantId, id);
      assertOpen(await findOperation(tx, id, {}));
      await this.assertPeople(tx, input.parties.map((p) => p.personId));
      const before = await tx.salesParty.findMany({ where: { salesOpId: id }, orderBy: [{ role: 'asc' }, { id: 'asc' }] });
      await tx.salesParty.deleteMany({ where: { salesOpId: id } });
      if (input.parties.length) {
        await tx.salesParty.createMany({
          data: input.parties.map((p) => ({ tenantId, salesOpId: id, role: p.role, personId: p.personId, sharePct: p.sharePct })),
        });
      }
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'SalesOperation',
        entityId: id,
        before: auditJson({ parties: before }),
        after: auditJson({ parties: input.parties }),
        metadata: { operation: 'sales-parties' },
      });
    });
    return this.findOne(id);
  }

  /** Tilda (o destilda) un renglón de la documentación del inmueble, o le deja una observación. */
  async updateDoc(id: string, code: string, data: unknown) {
    const input = parseOrThrow(UpdateSalesDocCheckSchema, data, 'Invalid documentation check');
    const tenantId = this.tenantContext.getTenantId()!;
    await this.prisma.client.$transaction(async (tx: Db) => {
      await lockOperation(tx, tenantId, id);
      assertOpen(await findOperation(tx, id, {}));
      const doc = await tx.salesDocCheck.findFirst({ where: { salesOpId: id, code } });
      if (!doc) throw notFound('DOC_CHECK_NOT_FOUND', 'Documentation item not found');
      const patch: Record<string, unknown> = {};
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.done !== undefined) {
        patch.done = input.done;
        patch.doneAt = input.done ? new Date() : null;
        patch.doneById = input.done ? (this.tenantContext.getUserId() ?? null) : null;
      }
      const updated = await tx.salesDocCheck.update({ where: { id: doc.id }, data: patch });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'SalesDocCheck',
        entityId: doc.id,
        before: auditJson(doc),
        after: auditJson(updated),
        metadata: { operation: 'sales-doc-check', code },
      });
    });
    return this.findOne(id);
  }

  /**
   * Cambio de etapa. Reservada pide un comprador y una reserva viva; SenaRecibida, una seña recibida;
   * Boleto, su fecha y la documentación obligatoria (o el motivo de seguir sin ella); Escriturada, su
   * fecha (no futura). Volver a Publicada o cancelar con dinero recibido sin resolver se rechaza:
   * primero se registra la devolución o la retención. Las señas pendientes de cobro que quedan se
   * marcan vencidas y las recibidas se aplican al precio al escriturar.
   */
  async transition(id: string, data: unknown) {
    const input = parseOrThrow(TransitionSalesSchema, data, 'Invalid transition');
    const tenantId = this.tenantContext.getTenantId()!;
    const today = todayInAR();
    const { requireDocsForBoleto } = (await this.defaults.get(tenantId)).sales;
    await this.prisma.client.$transaction(async (tx: Db) => {
      await lockOperation(tx, tenantId, id);
      const op = await findOperation(tx, id, { parties: true, deposits: true, docs: true });
      assertTransition(salesMachine, op.status as SalesOperationStatus, input.to);
      const patch: Record<string, unknown> = { status: input.to };
      if (input.agreedPrice) patch.agreedPrice = input.agreedPrice;
      const live = op.deposits.filter((d: any) => d.status === SalesDepositStatus.Pendiente || d.status === SalesDepositStatus.Recibida);

      switch (input.to) {
        case SalesOperationStatus.Reservada:
          if (!op.parties.some((p: any) => p.role === SalesPartyRole.Comprador)) {
            throw conflict('BUYER_REQUIRED', 'A reservation needs at least one buyer');
          }
          if (!live.some((d: any) => d.kind === 'Reserva')) throw conflict('RESERVATION_REQUIRED', 'Record the reservation before moving the operation to Reservada');
          break;
        case SalesOperationStatus.SenaRecibida:
          if (!op.deposits.some((d: any) => d.kind === 'Sena' && d.status === SalesDepositStatus.Recibida)) {
            throw conflict('DEPOSIT_NOT_RECEIVED', 'Record the received deposit before moving the operation to SenaRecibida');
          }
          break;
        case SalesOperationStatus.Boleto: {
          const missing = op.docs.filter((d: any) => d.required && !d.done).map((d: any) => d.code);
          if (requireDocsForBoleto && missing.length && !input.docsOverrideReason) {
            throw conflict('DOCS_PENDING', `Required documentation is missing: ${missing.join(', ')}`);
          }
          patch.boletoDate = dayStart(input.boletoDate!);
          break;
        }
        case SalesOperationStatus.Escriturada: {
          const date = dayStart(input.escrituraDate!);
          if (date.getTime() > today.getTime()) throw badRequest('ESCRITURA_IN_FUTURE', 'The escritura date cannot be in the future');
          patch.escrituraDate = date;
          patch.closedAt = new Date();
          break;
        }
        case SalesOperationStatus.Publicada:
        case SalesOperationStatus.Cancelada:
          this.assertNoUnresolvedMoney(op.deposits);
          if (input.to === SalesOperationStatus.Cancelada) {
            patch.cancelReason = input.reason;
            patch.closedAt = new Date();
          }
          break;
        default:
          break;
      }

      await this.closeDeposits(tx, op, input.to, patch.escrituraDate as Date | undefined);
      const updated = await tx.salesOperation.update({ where: { id }, data: patch });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'SalesOperation',
        entityId: id,
        before: auditJson({ status: op.status }),
        after: auditJson(updated),
        metadata: {
          operation: 'sales-transition',
          from: op.status,
          to: input.to,
          reason: input.reason ?? null,
          docsOverrideReason: input.docsOverrideReason ?? null,
        },
      });
    });
    this.logger.log('Sales operation moved', { id, to: input.to });
    return this.findOne(id);
  }

  /** Dinero recibido sin devolver ni retener: hay que resolverlo antes de liberar o cancelar. */
  private assertNoUnresolvedMoney(deposits: any[]): void {
    const unresolved = deposits.filter((d) => blocksLeavingStage(d));
    if (unresolved.length) {
      throw conflict('DEPOSITS_UNRESOLVED', 'Refund or forfeit the received deposits before releasing or cancelling the operation');
    }
  }

  /** Al salir de la etapa: las pendientes de cobro vencen; al escriturar, las recibidas se aplican al precio. */
  private async closeDeposits(tx: Db, op: any, to: SalesOperationStatus, escrituraDate?: Date) {
    const toVoid = op.deposits.filter((d: any) => d.status === SalesDepositStatus.Pendiente);
    const closing = [SalesOperationStatus.Publicada, SalesOperationStatus.Cancelada, SalesOperationStatus.Escriturada].includes(to);
    if (closing && toVoid.length) {
      await tx.salesDeposit.updateMany({
        where: { id: { in: toVoid.map((d: any) => d.id) }, status: SalesDepositStatus.Pendiente },
        data: { status: SalesDepositStatus.Vencida },
      });
    }
    if (to === SalesOperationStatus.Escriturada) {
      for (const d of op.deposits.filter((x: any) => x.status === SalesDepositStatus.Recibida)) {
        await tx.salesDeposit.update({
          where: { id: d.id },
          data: { status: SalesDepositStatus.Aplicada, resolvedAt: escrituraDate ?? null, resolvedAmount: d.amount },
        });
      }
    }
  }

  private async lockProperty(tx: Db, tenantId: string, propertyId: string) {
    const rows: { id: string }[] = await tx.$queryRaw(
      Prisma.sql`SELECT id FROM properties WHERE id = ${propertyId} AND "tenantId" = ${tenantId} FOR UPDATE`,
    );
    if (rows.length === 0) throw notFound('PROPERTY_NOT_FOUND', 'Property not found');
  }

  private async assertPeople(tx: Db, personIds: string[]) {
    const unique = [...new Set(personIds)];
    if (!unique.length) return;
    const found = await tx.person.count({ where: { id: { in: unique } } });
    if (found !== unique.length) throw notFound('PERSON_NOT_FOUND', 'Person not found');
  }

  private async assertUser(tx: Db, userId?: string | null) {
    if (!userId) return;
    const user = await tx.user.findFirst({ where: { id: userId }, select: { id: true } });
    if (!user) throw notFound('USER_NOT_FOUND', 'User not found');
  }
}
