import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateKeySetSchema,
  KeyCheckInSchema,
  KeyCheckOutSchema,
  KeyHolder,
  KeysOutFilterSchema,
  UpdateKeySetSchema,
  todayInAR,
} from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { auditJson, badRequest, conflict, dayStart, notFound } from '../cash/cash.errors';

type Db = any;

const PERSON_SELECT = { select: { id: true, firstName: true, lastName: true } } as const;
const HOLDER_INCLUDE = { holderPerson: PERSON_SELECT, holderUser: PERSON_SELECT } as const;
const DAY_MS = 86_400_000;

/** Días de atraso de una salida abierta (0 si no vencía todavía o no tiene fecha de vuelta). */
export function daysOverdue(expectedReturnAt: Date | string | null | undefined, today: Date): number {
  if (!expectedReturnAt) return 0;
  const diff = Math.floor((today.getTime() - new Date(expectedReturnAt).getTime()) / DAY_MS);
  return Math.max(0, diff);
}

/** Campos de quien las tiene, tal como se guardan en el juego y en la salida. */
function holderData(v: { holder: KeyHolder; holderPersonId?: string | null; holderUserId?: string | null; holderName?: string | null }) {
  return {
    holder: v.holder,
    holderPersonId: v.holderPersonId ?? null,
    holderUserId: v.holderUserId ?? null,
    holderName: v.holderName ?? null,
  };
}

/**
 * Llaves de las propiedades (D14): juegos con quién los tiene hoy y dónde se guardan en la oficina, y
 * sus salidas y devoluciones (quién, cuándo, para qué, cuándo deberían volver). Siempre que el juego no
 * está en la oficina hay una salida abierta; devolverlo la cierra. Las atrasadas se ven en "llaves fuera".
 */
@Injectable()
export class KeysService {
  private readonly logger = new Logger(KeysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  /** Juegos de una propiedad con quién los tiene y las últimas salidas. */
  async listByProperty(propertyId: string) {
    await this.assertProperty(this.prisma.client, propertyId);
    const today = todayInAR();
    const sets: any[] = await this.prisma.client.keySet.findMany({
      where: { propertyId },
      include: {
        ...HOLDER_INCLUDE,
        movements: {
          include: HOLDER_INCLUDE,
          orderBy: [{ outAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
          take: 20,
        },
      },
      orderBy: [{ isActive: 'desc' }, { label: 'asc' }, { id: 'asc' }],
    });
    return { items: sets.map((set) => this.present(set, today)) };
  }

  /** "Llaves fuera": salidas abiertas, las que pasaron su fecha de vuelta primero. */
  async listOut(query: unknown) {
    const filters = parseOrThrow(KeysOutFilterSchema, query, 'Invalid filter parameters');
    const today = todayInAR();
    const where: Record<string, unknown> = { returnedAt: null };
    if (filters.holder) where.holder = filters.holder;
    if (filters.propertyId) where.keySet = { propertyId: filters.propertyId };
    if (filters.overdue) where.expectedReturnAt = { lt: today };
    const [rows, total] = await Promise.all([
      this.prisma.client.keyMovement.findMany({
        where,
        include: {
          ...HOLDER_INCLUDE,
          keySet: { select: { id: true, label: true, copies: true, propertyId: true, property: { select: { id: true, title: true, street: true, number: true } } } },
        },
        orderBy: [{ expectedReturnAt: 'asc' }, { outAt: 'asc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.keyMovement.count({ where }),
    ]);
    const items = rows.map((m: any) => ({ ...m, overdue: daysOverdue(m.expectedReturnAt, today) > 0, daysOverdue: daysOverdue(m.expectedReturnAt, today) }));
    return { items, total, page: filters.page, limit: filters.limit, totalPages: Math.ceil(total / filters.limit) };
  }

  /** Alta de un juego; si nace fuera de la oficina queda con su salida abierta. */
  async create(propertyId: string, data: unknown) {
    const input = parseOrThrow(CreateKeySetSchema, data, 'Invalid key set');
    const tenantId = this.tenantContext.getTenantId()!;
    const today = todayInAR();
    const id = await this.prisma.client.$transaction(async (tx: Db) => {
      await this.assertProperty(tx, propertyId);
      await this.assertHolder(tx, input);
      const set = await tx.keySet.create({
        data: {
          tenantId,
          propertyId,
          label: input.label,
          copies: input.copies,
          location: input.location ?? null,
          notes: input.notes ?? null,
          ...holderData(input),
        },
      });
      if (input.holder !== KeyHolder.Oficina) {
        await tx.keyMovement.create({
          data: { tenantId, keySetId: set.id, ...holderData(input), reason: 'Alta', outAt: today, outById: this.tenantContext.getUserId() ?? null },
        });
      }
      await this.audit.record(tx, { action: 'CREATE', entity: 'KeySet', entityId: set.id, after: auditJson(set), metadata: { operation: 'key-set-create' } });
      return set.id as string;
    });
    return this.findOne(id);
  }

  /** Cambia nombre, copias, lugar donde se guardan y notas, o da de baja el juego (si está en la oficina). */
  async update(id: string, data: unknown) {
    const input = parseOrThrow(UpdateKeySetSchema, data, 'Invalid key set');
    const tenantId = this.tenantContext.getTenantId()!;
    await this.prisma.client.$transaction(async (tx: Db) => {
      await this.lock(tx, tenantId, id);
      const current = await this.load(tx, id);
      if (input.isActive === false && current.holder !== KeyHolder.Oficina) {
        throw conflict('KEY_SET_OUT', 'Return the keys before deactivating the set');
      }
      const patch: Record<string, unknown> = {};
      for (const key of ['label', 'copies', 'location', 'notes', 'isActive'] as const) {
        if (input[key] !== undefined) patch[key] = input[key];
      }
      const updated = await tx.keySet.update({ where: { id }, data: patch });
      await this.audit.record(tx, { action: 'UPDATE', entity: 'KeySet', entityId: id, before: auditJson(current), after: auditJson(updated) });
    });
    return this.findOne(id);
  }

  /** Salida: a quién se entregan, para qué y cuándo deberían volver. Un juego sale una sola vez hasta que vuelve. */
  async checkOut(id: string, data: unknown) {
    const input = parseOrThrow(KeyCheckOutSchema, data, 'Invalid key check-out');
    const tenantId = this.tenantContext.getTenantId()!;
    const today = todayInAR();
    await this.prisma.client.$transaction(async (tx: Db) => {
      await this.lock(tx, tenantId, id);
      const set = await this.load(tx, id);
      if (!set.isActive) throw conflict('KEY_SET_INACTIVE', 'The key set is inactive');
      const open = await tx.keyMovement.count({ where: { keySetId: id, returnedAt: null } });
      if (open > 0) throw conflict('KEY_ALREADY_OUT', 'The keys are already out: check them in first');
      const outAt = input.outAt ? dayStart(input.outAt) : today;
      if (outAt.getTime() > today.getTime()) throw badRequest('DATE_IN_FUTURE', 'The check-out date cannot be in the future');
      const expected = input.expectedReturnAt ? dayStart(input.expectedReturnAt) : null;
      if (expected && expected.getTime() < outAt.getTime()) throw badRequest('RETURN_BEFORE_OUT', 'The expected return is before the check-out');
      await this.assertHolder(tx, input);
      const movement = await tx.keyMovement.create({
        data: {
          tenantId,
          keySetId: id,
          ...holderData(input),
          reason: input.reason ?? null,
          outAt,
          expectedReturnAt: expected,
          outById: this.tenantContext.getUserId() ?? null,
          notes: input.notes ?? null,
        },
      });
      await tx.keySet.update({ where: { id }, data: holderData(input) });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'KeySet',
        entityId: id,
        metadata: { operation: 'key-check-out', movementId: movement.id, holder: input.holder },
      });
    });
    this.logger.log('Keys checked out', { id });
    return this.findOne(id);
  }

  /** Devolución: cierra la salida abierta y el juego vuelve a la oficina. */
  async checkIn(id: string, data: unknown) {
    const input = parseOrThrow(KeyCheckInSchema, data, 'Invalid key check-in');
    const tenantId = this.tenantContext.getTenantId()!;
    const today = todayInAR();
    await this.prisma.client.$transaction(async (tx: Db) => {
      await this.lock(tx, tenantId, id);
      await this.load(tx, id);
      const open = await tx.keyMovement.findFirst({ where: { keySetId: id, returnedAt: null }, orderBy: [{ outAt: 'desc' }, { id: 'asc' }] });
      if (!open) throw conflict('KEY_NOT_OUT', 'The keys are already in the office');
      const returnedAt = input.returnedAt ? dayStart(input.returnedAt) : today;
      if (returnedAt.getTime() > today.getTime()) throw badRequest('DATE_IN_FUTURE', 'The return date cannot be in the future');
      if (returnedAt.getTime() < new Date(open.outAt).getTime()) throw badRequest('RETURN_BEFORE_OUT', 'The return is before the check-out');
      await tx.keyMovement.update({
        where: { id: open.id },
        data: {
          returnedAt,
          returnedById: this.tenantContext.getUserId() ?? null,
          notes: input.notes ? [open.notes, input.notes].filter(Boolean).join(' | ') : open.notes,
        },
      });
      await tx.keySet.update({
        where: { id },
        data: {
          ...holderData({ holder: KeyHolder.Oficina }),
          ...(input.location !== undefined ? { location: input.location } : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'KeySet',
        entityId: id,
        metadata: { operation: 'key-check-in', movementId: open.id },
      });
    });
    this.logger.log('Keys checked in', { id });
    return this.findOne(id);
  }

  async findOne(id: string) {
    const set: any = await this.prisma.client.keySet.findFirst({
      where: { id },
      include: {
        ...HOLDER_INCLUDE,
        movements: { include: HOLDER_INCLUDE, orderBy: [{ outAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }], take: 20 },
      },
    });
    if (!set) throw notFound('KEY_SET_NOT_FOUND', 'Key set not found');
    return this.present(set, todayInAR());
  }

  // ─── Internos ───────────────────────────────────────

  /** El juego con su salida abierta (si la hay) y el atraso. */
  private present(set: any, today: Date) {
    const openMovement = (set.movements ?? []).find((m: any) => !m.returnedAt) ?? null;
    return {
      ...set,
      openMovement,
      overdue: openMovement ? daysOverdue(openMovement.expectedReturnAt, today) > 0 : false,
      daysOverdue: openMovement ? daysOverdue(openMovement.expectedReturnAt, today) : 0,
    };
  }

  private async load(tx: Db, id: string) {
    const set = await tx.keySet.findFirst({ where: { id } });
    if (!set) throw notFound('KEY_SET_NOT_FOUND', 'Key set not found');
    return set;
  }

  /** Bloquea el juego hasta el commit: dos salidas simultáneas no abren dos salidas (SQL crudo, ADR-0006). */
  private async lock(tx: Db, tenantId: string, id: string) {
    const rows: { id: string }[] = await tx.$queryRaw(
      Prisma.sql`SELECT id FROM key_sets WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`,
    );
    if (rows.length === 0) throw notFound('KEY_SET_NOT_FOUND', 'Key set not found');
  }

  private async assertProperty(db: Db, propertyId: string) {
    const property = await db.property.findFirst({ where: { id: propertyId }, select: { id: true } });
    if (!property) throw notFound('PROPERTY_NOT_FOUND', 'Property not found');
  }

  private async assertHolder(tx: Db, v: { holderPersonId?: string | null; holderUserId?: string | null }) {
    if (v.holderPersonId && !(await tx.person.findFirst({ where: { id: v.holderPersonId }, select: { id: true } }))) {
      throw notFound('PERSON_NOT_FOUND', 'Person not found');
    }
    if (v.holderUserId && !(await tx.user.findFirst({ where: { id: v.holderUserId }, select: { id: true } }))) {
      throw notFound('USER_NOT_FOUND', 'User not found');
    }
  }
}
