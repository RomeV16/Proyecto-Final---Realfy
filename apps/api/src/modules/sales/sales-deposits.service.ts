import { Injectable, Logger } from '@nestjs/common';
import {
  CashCategory,
  CashDirection,
  CreateSalesDepositSchema,
  ForfeitSalesDepositSchema,
  ReceiveSalesDepositSchema,
  RefundSalesDepositSchema,
  SalesDepositHolder,
  SalesDepositKind,
  SalesDepositStatus,
  SalesOperationStatus,
  SalesPendingDepositsFilterSchema,
  UpdateSalesDepositSchema,
  hasUnresolvedMoney,
  isDepositExpired,
  reservationExpiry,
  todayInAR,
} from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { auditJson, badRequest, conflict, dayStart, notFound } from '../cash/cash.errors';
import { CashService } from '../cash/cash.service';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { Db, PERSON_SELECT, assertOpen, findOperation, lockOperation, presentDeposit } from './sales.helpers';

const { Pendiente, Recibida, Devuelta, Retenida, Vencida } = SalesDepositStatus;

/** Etapas en las que se puede cargar cada tipo: la reserva con la operación publicada o reservada; la seña, hasta recibirla. */
const STAGES: Record<SalesDepositKind, SalesOperationStatus[]> = {
  [SalesDepositKind.Reserva]: [SalesOperationStatus.Publicada, SalesOperationStatus.Reservada],
  [SalesDepositKind.Sena]: [SalesOperationStatus.Publicada, SalesOperationStatus.Reservada, SalesOperationStatus.SenaRecibida],
};

/**
 * Reservas y señas de una venta (D14). El dinero que guarda la inmobiliaria pasa por su caja con la
 * categoría `Sena` (entra al recibirse, sale al devolverse); el que guarda el vendedor o el escribano
 * solo se anota. Devolver o retener se registra a mano: el sistema nunca decide quién se queda con la
 * plata (las reglas de pérdida y de devolución en doble son de la inmobiliaria y su abogado). Las
 * reservas vencidas las marca el proceso diario y liberan la operación; si ya habían recibido dinero,
 * el dinero queda a la vista en las señas pendientes hasta que se resuelva.
 */
@Injectable()
export class SalesDepositsService {
  private readonly logger = new Logger(SalesDepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
    private readonly defaults: OperationalDefaultsService,
  ) {}

  /** Señas y reservas con plata en juego: pendientes de cobro, recibidas sin resolver y vencidas con dinero. */
  async pending(query: unknown) {
    const filters = parseOrThrow(SalesPendingDepositsFilterSchema, query, 'Invalid filter parameters');
    const open = {
      OR: [
        { status: { in: [Pendiente, Recibida] } },
        { status: Vencida, receivedAt: { not: null }, resolvedAt: null },
      ],
    };
    const where: Record<string, unknown> = { ...open };
    if (filters.holder) where.holder = filters.holder;
    if (filters.status) where.AND = [{ status: filters.status }];
    const [rows, total, held] = await Promise.all([
      this.prisma.client.salesDeposit.findMany({
        where,
        include: {
          payerPerson: PERSON_SELECT,
          holderPerson: PERSON_SELECT,
          salesOperation: { select: { id: true, status: true, property: { select: { id: true, title: true } } } },
        },
        orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.salesDeposit.count({ where }),
      this.prisma.client.salesDeposit.groupBy({
        by: ['currency', 'holder'],
        where: { receivedAt: { not: null }, resolvedAt: null, status: { in: [Recibida, Vencida] } },
        _sum: { amount: true },
        orderBy: [{ currency: 'asc' }, { holder: 'asc' }],
      }),
    ]);
    const today = todayInAR();
    return {
      items: rows.map((row: any) => presentDeposit(row, today)),
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
      /** Dinero recibido y sin resolver, por moneda y por quién lo guarda. */
      held: held.map((g: any) => ({ currency: g.currency, holder: g.holder, amount: String(g._sum.amount ?? '0') })),
    };
  }

  /** Alta de una reserva (con vencimiento) o de una seña. */
  async create(opId: string, data: unknown) {
    const input = parseOrThrow(CreateSalesDepositSchema, data, 'Invalid deposit');
    const tenantId = this.tenantContext.getTenantId()!;
    const today = todayInAR();
    const { sales } = await this.defaults.get(tenantId);
    return this.prisma.client.$transaction(async (tx: Db) => {
      await lockOperation(tx, tenantId, opId);
      const op = await findOperation(tx, opId, {});
      assertOpen(op);
      if (!STAGES[input.kind as SalesDepositKind].includes(op.status)) {
        throw conflict('INVALID_STAGE_FOR_DEPOSIT', `A ${input.kind} cannot be recorded when the operation is ${op.status}`);
      }
      await this.assertPeople(tx, [input.holderPersonId, input.payerPersonId]);
      const expiresAt =
        input.kind === SalesDepositKind.Reserva
          ? input.expiresAt
            ? dayStart(input.expiresAt)
            : reservationExpiry(today, sales.reservationDays)
          : input.expiresAt
            ? dayStart(input.expiresAt)
            : null;
      if (expiresAt && expiresAt.getTime() < today.getTime()) throw badRequest('EXPIRY_IN_PAST', 'The expiry date cannot be in the past');
      const deposit = await tx.salesDeposit.create({
        data: {
          tenantId,
          salesOpId: opId,
          kind: input.kind,
          amount: input.amount,
          currency: input.currency ?? op.currency,
          holder: input.holder ?? sales.defaultDepositHolder,
          holderPersonId: input.holderPersonId ?? null,
          payerPersonId: input.payerPersonId ?? null,
          expiresAt,
          notes: input.notes ?? null,
          createdById: this.tenantContext.getUserId() ?? null,
        },
      });
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'SalesDeposit',
        entityId: deposit.id,
        after: auditJson(deposit),
        metadata: { operation: 'sales-deposit-create', salesOpId: opId },
      });
      return presentDeposit(deposit, today);
    });
  }

  /** Cambia el vencimiento (se prorroga una reserva) o las notas de una reserva o seña viva. */
  async update(opId: string, depositId: string, data: unknown) {
    const input = parseOrThrow(UpdateSalesDepositSchema, data, 'Invalid deposit');
    const tenantId = this.tenantContext.getTenantId()!;
    const today = todayInAR();
    return this.prisma.client.$transaction(async (tx: Db) => {
      await lockOperation(tx, tenantId, opId);
      assertOpen(await findOperation(tx, opId, {}));
      const deposit = await this.load(tx, opId, depositId);
      if (deposit.status !== Pendiente && deposit.status !== Recibida) {
        throw conflict('DEPOSIT_CLOSED', 'The deposit is already closed');
      }
      const patch: Record<string, unknown> = {};
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.expiresAt !== undefined) {
        const expiresAt = input.expiresAt ? dayStart(input.expiresAt) : null;
        if (expiresAt && expiresAt.getTime() < today.getTime()) throw badRequest('EXPIRY_IN_PAST', 'The expiry date cannot be in the past');
        if (!expiresAt && deposit.kind === SalesDepositKind.Reserva) throw badRequest('EXPIRY_REQUIRED', 'A reservation needs an expiry date');
        patch.expiresAt = expiresAt;
      }
      const updated = await tx.salesDeposit.update({ where: { id: depositId }, data: patch });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'SalesDeposit',
        entityId: depositId,
        before: auditJson(deposit),
        after: auditJson(updated),
        metadata: { operation: 'sales-deposit-update', salesOpId: opId },
      });
      return presentDeposit(updated, today);
    });
  }

  /**
   * Registra que el dinero entró. Con la inmobiliaria como depositaria entra a la cuenta indicada (o a
   * la caja o el banco de la moneda) como movimiento de categoría Sena; con el vendedor o el escribano,
   * solo se anota. Se recibe una sola vez y no vencida.
   */
  async receive(opId: string, depositId: string, data: unknown) {
    const input = parseOrThrow(ReceiveSalesDepositSchema, data, 'Invalid deposit receipt');
    const tenantId = this.tenantContext.getTenantId()!;
    const today = todayInAR();
    return this.prisma.client.$transaction(async (tx: Db) => {
      await lockOperation(tx, tenantId, opId);
      assertOpen(await findOperation(tx, opId, {}));
      const deposit = await this.load(tx, opId, depositId);
      if (deposit.status !== Pendiente) throw conflict('DEPOSIT_NOT_PENDING', 'The deposit was already received or is closed');
      if (isDepositExpired(deposit, today)) throw conflict('DEPOSIT_EXPIRED', 'The reservation expired: extend it before receiving the money');
      const receivedAt = input.receivedAt ? dayStart(input.receivedAt) : today;
      if (receivedAt.getTime() > today.getTime()) throw badRequest('DATE_IN_FUTURE', 'The money cannot be received in the future');
      let movementId: string | null = null;
      if (deposit.holder === SalesDepositHolder.Inmobiliaria) {
        const account = await this.cash.resolveAgencyAccount(tx, tenantId, {
          accountId: input.accountId,
          currency: deposit.currency,
          method: input.method,
        });
        const movement = await this.cash.recordMovement(tx, {
          tenantId,
          accountId: account.id,
          date: receivedAt,
          direction: CashDirection.In,
          amount: String(deposit.amount),
          currency: deposit.currency,
          category: CashCategory.Sena,
          counterpartyId: deposit.payerPersonId,
          sourceType: 'SalesDeposit',
          sourceId: deposit.id,
          note: input.note ?? `${deposit.kind === SalesDepositKind.Reserva ? 'Reserva' : 'Seña'} de venta`,
        });
        movementId = movement.id;
      }
      const updated = await tx.salesDeposit.update({
        where: { id: depositId },
        data: { status: Recibida, receivedAt, receivedMovementId: movementId },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'SalesDeposit',
        entityId: depositId,
        metadata: { operation: 'sales-deposit-receive', salesOpId: opId, amount: String(deposit.amount), movementId },
      });
      this.logger.log('Sales deposit received', { depositId });
      return presentDeposit(updated, today);
    });
  }

  /**
   * Devolución al comprador (completa o parcial, nunca más de lo recibido). Si el dinero lo tiene la
   * inmobiliaria sale de la misma cuenta donde entró. La devolución en doble por culpa del vendedor no se
   * calcula: se arregla fuera del sistema.
   */
  async refund(opId: string, depositId: string, data: unknown) {
    const input = parseOrThrow(RefundSalesDepositSchema, data, 'Invalid refund');
    const tenantId = this.tenantContext.getTenantId()!;
    const today = todayInAR();
    return this.prisma.client.$transaction(async (tx: Db) => {
      await lockOperation(tx, tenantId, opId);
      const deposit = await this.loadWithMoney(tx, opId, depositId);
      const at = input.at ? dayStart(input.at) : today;
      if (at.getTime() > today.getTime()) throw badRequest('DATE_IN_FUTURE', 'The refund cannot be in the future');
      const amount = input.amount ?? String(deposit.amount);
      if (Number(amount) > Number(deposit.amount)) throw badRequest('REFUND_EXCEEDS_DEPOSIT', 'The refund cannot exceed the money received');
      let movementId: string | null = null;
      if (deposit.holder === SalesDepositHolder.Inmobiliaria) {
        const received = deposit.receivedMovementId
          ? await tx.cashMovement.findFirst({ where: { id: deposit.receivedMovementId }, select: { accountId: true } })
          : null;
        const account = await this.cash.resolveAgencyAccount(tx, tenantId, {
          accountId: input.accountId ?? received?.accountId,
          currency: deposit.currency,
          method: input.method,
        });
        const movement = await this.cash.recordMovement(tx, {
          tenantId,
          accountId: account.id,
          date: at,
          direction: CashDirection.Out,
          amount,
          currency: deposit.currency,
          category: CashCategory.Sena,
          counterpartyId: deposit.payerPersonId,
          sourceType: 'SalesDepositRefund',
          sourceId: deposit.id,
          note: input.note ?? 'Devolución de seña de venta',
        });
        movementId = movement.id;
      }
      return this.resolve(tx, deposit, opId, Devuelta, at, amount, movementId, input.note, 'sales-deposit-refund', today);
    });
  }

  /** Retención (pérdida de la seña): solo se registra con su motivo; no mueve la caja ni decide el destino del dinero. */
  async forfeit(opId: string, depositId: string, data: unknown) {
    const input = parseOrThrow(ForfeitSalesDepositSchema, data, 'Invalid forfeit');
    const tenantId = this.tenantContext.getTenantId()!;
    const today = todayInAR();
    return this.prisma.client.$transaction(async (tx: Db) => {
      await lockOperation(tx, tenantId, opId);
      const deposit = await this.loadWithMoney(tx, opId, depositId);
      const at = input.at ? dayStart(input.at) : today;
      if (at.getTime() > today.getTime()) throw badRequest('DATE_IN_FUTURE', 'The forfeit cannot be in the future');
      const amount = input.amount ?? String(deposit.amount);
      if (Number(amount) > Number(deposit.amount)) throw badRequest('FORFEIT_EXCEEDS_DEPOSIT', 'The forfeit cannot exceed the money received');
      return this.resolve(tx, deposit, opId, Retenida, at, amount, null, input.note, 'sales-deposit-forfeit', today);
    });
  }

  /**
   * Proceso diario: las reservas vivas con la fecha vencida pasan a Vencida y, si la operación estaba
   * Reservada y ya no le queda otra reserva o seña viva, vuelve a Publicada (se libera). No devuelve ni
   * retiene nada: el dinero ya recibido sigue en las señas pendientes. Idempotente. Devuelve cuántas venció.
   */
  async expireReservations(today: Date = todayInAR()): Promise<number> {
    const due: any[] = await this.prisma.client.salesDeposit.findMany({
      where: { kind: SalesDepositKind.Reserva, status: { in: [Pendiente, Recibida] }, expiresAt: { lt: today } },
      select: { id: true, salesOpId: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    });
    let expired = 0;
    for (const { id, salesOpId } of due) {
      await this.prisma.client.$transaction(async (tx: Db) => {
        const claimed = await tx.salesDeposit.updateMany({
          where: { id, kind: SalesDepositKind.Reserva, status: { in: [Pendiente, Recibida] }, expiresAt: { lt: today } },
          data: { status: Vencida },
        });
        if (claimed.count === 0) return;
        expired++;
        const op = await tx.salesOperation.findFirst({ where: { id: salesOpId }, include: { deposits: true } });
        const stillLive = op?.deposits.some((d: any) => d.status === Pendiente || d.status === Recibida);
        let released = false;
        if (op && op.status === SalesOperationStatus.Reservada && !stillLive) {
          await tx.salesOperation.update({ where: { id: salesOpId }, data: { status: SalesOperationStatus.Publicada } });
          released = true;
        }
        await this.audit.record(tx, {
          action: 'UPDATE',
          entity: 'SalesDeposit',
          entityId: id,
          metadata: { operation: 'sales-reservation-expire', salesOpId, released },
          userId: null,
        });
      });
    }
    this.logger.log(`Sales reservations expired: ${expired}`);
    return expired;
  }

  // ─── Internos ───────────────────────────────────────

  private async resolve(
    tx: Db,
    deposit: any,
    opId: string,
    status: SalesDepositStatus,
    at: Date,
    amount: string,
    movementId: string | null,
    note: string | undefined,
    operation: string,
    today: Date,
  ) {
    const updated = await tx.salesDeposit.update({
      where: { id: deposit.id },
      data: { status, resolvedAt: at, resolvedAmount: amount, resolutionMovementId: movementId, resolutionNote: note ?? null },
    });
    await this.audit.record(tx, {
      action: 'UPDATE',
      entity: 'SalesDeposit',
      entityId: deposit.id,
      before: auditJson(deposit),
      after: auditJson(updated),
      metadata: { operation, salesOpId: opId, amount, movementId },
    });
    return presentDeposit(updated, today);
  }

  private async load(tx: Db, opId: string, depositId: string) {
    const deposit = await tx.salesDeposit.findFirst({ where: { id: depositId, salesOpId: opId } });
    if (!deposit) throw notFound('DEPOSIT_NOT_FOUND', 'Deposit not found');
    return deposit;
  }

  /** La reserva o seña con dinero recibido y sin resolver (lo único que se puede devolver o retener). */
  private async loadWithMoney(tx: Db, opId: string, depositId: string) {
    const deposit = await this.load(tx, opId, depositId);
    if (!hasUnresolvedMoney(deposit)) {
      throw conflict('NO_MONEY_TO_RESOLVE', 'The deposit has no received money pending a refund or forfeit');
    }
    return deposit;
  }

  private async assertPeople(tx: Db, ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!unique.length) return;
    const found = await tx.person.count({ where: { id: { in: unique } } });
    if (found !== unique.length) throw notFound('PERSON_NOT_FOUND', 'Person not found');
  }
}
