import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AddCollectionNoteSchema,
  AssignCollectionCaseSchema,
  CloseCollectionCaseSchema,
  CollectionActionKind,
  CollectionActionStatus,
  CollectionAgreementSchema,
  CollectionCaseFilterSchema,
  CollectionNoteBodySchema,
  CollectionStage,
  ConfirmLetterSentSchema,
  DeriveToLawyerSchema,
  Money,
  UpdateLetterSchema,
  addDays,
  collectionCaseMachine,
  collectionPolicyOf,
  daysOverdue,
  personName,
  propertyLabel,
  todayInAR,
  type CollectionActionItem,
  type CollectionCaseDetail,
  type CollectionCaseItem,
  type CollectionCasePage,
  type CollectionPolicy,
  type LetterFields,
} from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { assertTransition } from '../../common/errors/assert-transition';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { getParties } from '../contracts/contract-parties';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { CollectionDebtService, type ContractDebt } from './collection-debt.service';
import { CollectionStateService, type CaseRow } from './collection-state.service';

type Db = any;

const conflict = (error: string, message: string) => new ConflictException({ error, message });
const parseDay = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const CONTRACT_SELECT = {
  id: true,
  property: { select: { title: true, street: true, number: true, floor: true, apartment: true } },
  persons: {
    where: { role: 'Inquilino' },
    select: { role: true, person: { select: { id: true, firstName: true, lastName: true } } },
  },
} as const;

/** Lectura y acciones manuales de los casos de cobranza (ADR-0013). */
@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly defaults: OperationalDefaultsService,
    private readonly debt: CollectionDebtService,
    private readonly state: CollectionStateService,
    private readonly audit: AuditService,
  ) {}

  currentTenantId(): string {
    return this.tenantContext.getTenantId()!;
  }

  // ─── Lectura ────────────────────────────────────────

  /** `GET /collection-cases`: sin `stage`, solo los abiertos; del más viejo al más nuevo. */
  async list(query: unknown): Promise<CollectionCasePage> {
    const q = parseOrThrow(CollectionCaseFilterSchema, query, 'Invalid collection filter');
    const today = todayInAR();
    const where: Prisma.CollectionCaseWhereInput = {
      ...(q.stage ? { stage: q.stage } : { stage: { not: CollectionStage.Cerrado } }),
      ...(q.contractId ? { contractId: q.contractId } : {}),
      ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}),
      ...(q.minDays !== undefined ? { overdueSince: { lte: addDays(today, -q.minDays) } } : {}),
    };
    const db = this.prisma.client as Db;
    const [rows, total]: [CaseRow[], number] = await Promise.all([
      db.collectionCase.findMany({
        where,
        orderBy: [{ overdueSince: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      db.collectionCase.count({ where }),
    ]);
    const items: CollectionCaseItem[] = [];
    for (const row of rows) items.push((await this.present(db, row, today)).item);
    return { items, total, page: q.page, limit: q.limit, totalPages: Math.max(1, Math.ceil(total / q.limit)) };
  }

  /** `GET /collection-cases/:id`: el caso con su deuda de hoy y su línea de tiempo. */
  async get(id: string): Promise<CollectionCaseDetail> {
    const db = this.prisma.client as Db;
    const row = await this.findCase(db, id);
    return this.detail(db, row, todayInAR());
  }

  // ─── Acciones manuales ──────────────────────────────

  /** `POST /collection-cases/:id/notes`. */
  async addNote(id: string, body: unknown): Promise<CollectionCaseDetail> {
    const input = parseOrThrow(AddCollectionNoteSchema, body, 'Invalid note');
    return this.mutate(id, 'collection-note', async (tx, row) => {
      await this.createAction(tx, row, { kind: CollectionActionKind.Nota, note: input.note });
    });
  }

  /** `POST /collection-cases/:id/agreement`: promesa de pago; no se avisa hasta el día siguiente. */
  async agree(id: string, body: unknown): Promise<CollectionCaseDetail> {
    const input = parseOrThrow(CollectionAgreementSchema, body, 'Invalid agreement');
    const today = todayInAR();
    const payOn = parseDay(input.payOn);
    if (payOn.getTime() < today.getTime() || payOn.getTime() > addDays(today, 365).getTime()) {
      throw new BadRequestException({
        error: 'AGREEMENT_DATE_OUT_OF_RANGE',
        message: 'The agreed payment date must be today or later, within a year',
      });
    }
    return this.mutate(id, 'collection-agreement', async (tx, row) => {
      await this.createAction(tx, row, {
        kind: CollectionActionKind.Acuerdo,
        onDate: payOn,
        amount: input.amount ? new Money(input.amount) : undefined,
        note: input.note ?? null,
      });
      await tx.collectionCase.update({ where: { id: row.id }, data: { pausedUntil: payOn } });
      return { pausedUntil: input.payOn };
    });
  }

  /** `PATCH /collection-cases/:id/actions/:actionId`: edita los campos del borrador de la carta documento. */
  async updateLetter(id: string, actionId: string, body: unknown): Promise<CollectionCaseDetail> {
    const input = parseOrThrow(UpdateLetterSchema, body, 'Invalid letter');
    return this.mutate(id, 'collection-letter-edit', async (tx, row) => {
      const action = await this.findLetter(tx, row, actionId);
      if (action.status !== CollectionActionStatus.Preparada) {
        throw conflict('LETTER_ALREADY_SENT', 'The letter was already sent: it can no longer be edited');
      }
      const fields = { ...(action.data as LetterFields), ...input };
      await tx.collectionAction.update({ where: { id: action.id }, data: { data: fields as unknown as Prisma.InputJsonValue } });
    });
  }

  /** `POST /collection-cases/:id/actions/:actionId/sent`: alguien confirma que la carta se mandó en papel. */
  async confirmLetterSent(id: string, actionId: string, body: unknown): Promise<CollectionCaseDetail> {
    const input = parseOrThrow(ConfirmLetterSentSchema, body, 'Invalid letter confirmation');
    const today = todayInAR();
    const sentOn = parseDay(input.sentOn);
    return this.mutate(id, 'collection-letter-sent', async (tx, row) => {
      const action = await this.findLetter(tx, row, actionId);
      if (action.status !== CollectionActionStatus.Preparada) {
        throw conflict('LETTER_ALREADY_SENT', 'The letter was already confirmed as sent');
      }
      const preparedOn =
        row.letterPreparedOn ?? new Date(Date.UTC(action.at.getUTCFullYear(), action.at.getUTCMonth(), action.at.getUTCDate()));
      if (sentOn.getTime() > today.getTime() || sentOn.getTime() < preparedOn.getTime()) {
        throw new BadRequestException({
          error: 'LETTER_SENT_DATE_INVALID',
          message: 'The sending date cannot be in the future nor before the draft was prepared',
        });
      }
      await tx.collectionAction.update({
        where: { id: action.id },
        data: {
          status: CollectionActionStatus.Realizada,
          onDate: sentOn,
          ...(input.note ? { note: input.note } : {}),
        },
      });
      await tx.collectionCase.update({ where: { id: row.id }, data: { letterSentOn: sentOn } });
    });
  }

  /** `POST /collection-cases/:id/derive`: decisión de una persona; nada la dispara sola. */
  async derive(id: string, body: unknown): Promise<CollectionCaseDetail> {
    const input = parseOrThrow(DeriveToLawyerSchema, body, 'Invalid derivation');
    return this.mutate(id, 'collection-derive', async (tx, row) => {
      assertTransition(collectionCaseMachine, row.stage, CollectionStage.Abogado);
      await this.createAction(tx, row, {
        kind: CollectionActionKind.DerivacionAbogado,
        note: input.note ?? null,
        data: input.lawyer ? { lawyer: input.lawyer } : undefined,
      });
      await tx.collectionCase.update({ where: { id: row.id }, data: { stage: CollectionStage.Abogado } });
      return { stage: CollectionStage.Abogado };
    });
  }

  /** `POST /collection-cases/:id/judicial`: pasa a la vía judicial o de desalojo. */
  async judicialize(id: string, body: unknown): Promise<CollectionCaseDetail> {
    const input = parseOrThrow(CollectionNoteBodySchema, body ?? {}, 'Invalid note');
    return this.mutate(id, 'collection-judicial', async (tx, row) => {
      assertTransition(collectionCaseMachine, row.stage, CollectionStage.Judicial);
      await this.createAction(tx, row, {
        kind: CollectionActionKind.Nota,
        note: `Pasó a la vía judicial.${input.note ? ` ${input.note}` : ''}`,
      });
      await tx.collectionCase.update({ where: { id: row.id }, data: { stage: CollectionStage.Judicial } });
      return { stage: CollectionStage.Judicial };
    });
  }

  /** `POST /collection-cases/:id/close`: cierre a mano (un arreglo fuera del sistema, un error). */
  async close(id: string, body: unknown): Promise<CollectionCaseDetail> {
    const input = parseOrThrow(CloseCollectionCaseSchema, body, 'Invalid close');
    const userId = this.tenantContext.getUserId() ?? null;
    return this.mutate(id, null, async (tx, row) => {
      await this.state.close(tx, row, {
        reason: 'Manual',
        kind: CollectionActionKind.Nota,
        note: `Caso cerrado: ${input.note}`,
        userId,
      });
    });
  }

  /** `PATCH /collection-cases/:id`: quién lleva el caso. */
  async assign(id: string, body: unknown): Promise<CollectionCaseDetail> {
    const input = parseOrThrow(AssignCollectionCaseSchema, body, 'Invalid assignee');
    return this.mutate(id, 'collection-assign', async (tx, row) => {
      if (input.assigneeId) {
        const user = await tx.user.findFirst({ where: { id: input.assigneeId, isActive: true }, select: { id: true } });
        if (!user) throw new BadRequestException({ error: 'ASSIGNEE_NOT_FOUND', message: 'The assignee does not exist or is inactive' });
      }
      await tx.collectionCase.update({ where: { id: row.id }, data: { assigneeId: input.assigneeId } });
      return { assigneeId: input.assigneeId };
    });
  }

  /** Campos del borrador de la carta y el contrato de un caso, para el PDF. */
  async letterFor(id: string, actionId: string): Promise<{ fields: LetterFields; status: CollectionActionStatus; sentOn: Date | null }> {
    const db = this.prisma.client as Db;
    const row = await this.findCase(db, id);
    const action = await this.findLetter(db, row, actionId);
    return { fields: action.data as LetterFields, status: action.status, sentOn: action.onDate };
  }

  // ─── Internos ───────────────────────────────────────

  /**
   * Ejecuta una acción manual con el caso bloqueado, la audita, vuelve a calcular
   * qué toca y devuelve el caso actualizado. Un caso cerrado no admite acciones.
   */
  private async mutate(
    id: string,
    operation: string | null,
    run: (tx: Db, row: CaseRow) => Promise<Record<string, unknown> | void>,
  ): Promise<CollectionCaseDetail> {
    const tenantId = this.tenantContext.getTenantId()!;
    const policy = await this.policy(tenantId);
    const today = todayInAR();
    await (this.prisma.client as Db).$transaction(async (tx: Db) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM collection_cases WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`,
      );
      const row = await this.findCase(tx, id);
      if (row.stage === CollectionStage.Cerrado) throw conflict('CASE_CLOSED', 'The collection case is closed');
      const after = await run(tx, row);
      if (operation) {
        await this.audit.record(tx, {
          action: 'UPDATE',
          entity: 'CollectionCase',
          entityId: id,
          tenantId,
          after: after ?? {},
          metadata: { operation },
        });
      }
      const fresh = await this.findCase(tx, id);
      if (fresh.stage !== CollectionStage.Cerrado) await this.state.refresh(tx, fresh, today, policy);
    });
    return this.get(id);
  }

  private async policy(tenantId: string): Promise<CollectionPolicy> {
    return collectionPolicyOf(await this.defaults.get(tenantId));
  }

  private async findCase(db: Db, id: string): Promise<CaseRow> {
    const row: CaseRow | null = await db.collectionCase.findFirst({ where: { id } });
    if (!row) throw new NotFoundException({ error: 'COLLECTION_CASE_NOT_FOUND', message: 'Collection case not found' });
    return row;
  }

  private async findLetter(db: Db, row: CaseRow, actionId: string) {
    const action = await db.collectionAction.findFirst({
      where: { id: actionId, caseId: row.id, kind: CollectionActionKind.CartaDocumento },
    });
    if (!action) throw new NotFoundException({ error: 'LETTER_NOT_FOUND', message: 'Letter not found in this case' });
    return action;
  }

  private async createAction(
    tx: Db,
    row: CaseRow,
    input: { kind: CollectionActionKind; note?: string | null; onDate?: Date; amount?: Money; data?: Record<string, unknown> },
  ) {
    return tx.collectionAction.create({
      data: {
        tenantId: row.tenantId,
        caseId: row.id,
        kind: input.kind,
        status: CollectionActionStatus.Realizada,
        note: input.note ?? null,
        onDate: input.onDate ?? null,
        amount: input.amount ? input.amount.toFixed(2) : null,
        data: input.data as Prisma.InputJsonValue | undefined,
        createdByUserId: this.tenantContext.getUserId() ?? null,
      },
    });
  }

  private async present(db: Db, row: CaseRow, today: Date): Promise<{ item: CollectionCaseItem; debt: ContractDebt; manual: boolean }> {
    const contract = await db.contract.findFirst({ where: { id: row.contractId }, select: CONTRACT_SELECT });
    const debt = await this.debt.loadDebt(db, row.tenantId, row.contractId, today);
    const assignee = row.assigneeId
      ? await db.user.findFirst({ where: { id: row.assigneeId }, select: { firstName: true, lastName: true } })
      : null;
    const manual =
      row.nextActionKind === CollectionActionKind.DerivacionAbogado ||
      (row.nextActionKind === CollectionActionKind.CartaDocumento && row.letterPreparedOn !== null);
    const open = row.stage !== CollectionStage.Cerrado;
    const item: CollectionCaseItem = {
      id: row.id,
      contractId: row.contractId,
      propertyLabel: propertyLabel(contract?.property),
      tenantNames: getParties<any>(contract ?? {}, 'Inquilino').map((p) => personName(p.person)).join(', '),
      stage: row.stage,
      currency: (debt.overdue.length > 0 ? debt.currency : row.currency) as CollectionCaseItem['currency'],
      overdueSince: iso(debt.oldestDue ?? row.overdueSince)!,
      daysOverdue: daysOverdue(debt.oldestDue ?? row.overdueSince, today),
      balance: debt.balance.toFixed(2),
      payoffToday: debt.payoff.toFixed(2),
      nextAction: open ? row.nextActionKind : null,
      nextActionAt: open ? iso(row.nextActionAt) : null,
      planStatus: this.planStatus(row, debt, today),
      pausedUntil: row.pausedUntil && row.pausedUntil.getTime() >= today.getTime() ? iso(row.pausedUntil) : null,
      assigneeId: row.assigneeId,
      assigneeName: assignee ? personName(assignee) : null,
      openedAt: iso(row.createdAt)!,
      closedAt: iso(row.closedAt),
    };
    return { item, debt, manual };
  }

  /** Estado de la política tal como quedó en la última pasada (sin recalcular). */
  private planStatus(row: CaseRow, debt: ContractDebt, today: Date): CollectionCaseItem['planStatus'] {
    if (row.stage === CollectionStage.Cerrado) return 'Close';
    if (row.stage === CollectionStage.Abogado || row.stage === CollectionStage.Judicial) return 'Manual';
    if (row.pausedUntil && row.pausedUntil.getTime() >= today.getTime()) return 'Paused';
    if (row.letterPreparedOn && !row.letterSentOn) return 'AwaitingLetterConfirmation';
    return debt.overdue.length === 0 ? 'Close' : 'Scheduled';
  }

  private async detail(db: Db, row: CaseRow, today: Date): Promise<CollectionCaseDetail> {
    const { item, debt, manual } = await this.present(db, row, today);
    const actions: any[] = await db.collectionAction.findMany({
      where: { caseId: row.id },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
    });
    const messageIds = actions.map((a) => a.outboxMessageId).filter((m): m is string => !!m);
    const messages: Array<{ id: string; status: any; statusReason: string | null }> = messageIds.length
      ? await db.messageOutbox.findMany({ where: { id: { in: messageIds } }, select: { id: true, status: true, statusReason: true } })
      : [];
    const userIds = [...new Set(actions.map((a) => a.createdByUserId).filter((u): u is string => !!u))];
    const users: Array<{ id: string; firstName: string; lastName: string }> = userIds.length
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];

    const timeline: CollectionActionItem[] = actions.map((a) => {
      const msg = messages.find((m) => m.id === a.outboxMessageId);
      const user = users.find((u) => u.id === a.createdByUserId);
      return {
        id: a.id,
        kind: a.kind,
        status: a.status,
        level: a.level,
        channel: a.channel,
        outboxMessageId: a.outboxMessageId,
        messageStatus: msg?.status ?? null,
        messageStatusReason: msg?.statusReason ?? null,
        amount: a.amount ? new Money(a.amount.toString()).toFixed(2) : null,
        onDate: iso(a.onDate),
        note: a.note,
        letter: a.kind === CollectionActionKind.CartaDocumento ? ((a.data as LetterFields | null) ?? null) : null,
        createdByName: user ? personName(user) : null,
        at: a.at.toISOString(),
      };
    });

    return {
      ...item,
      debt: debt.overdue.map((l) => ({
        liquidacionId: l.id,
        period: l.period.toISOString(),
        dueDate: l.dueDate.toISOString(),
        daysOverdue: daysOverdue(l.dueDate, today),
        balance: l.balance.toFixed(2),
        penalty: l.penalty.toFixed(2),
        total: l.total.toFixed(2),
      })),
      actions: timeline,
      nextActionManual: manual,
      closeReason: row.closeReason,
    };
  }
}
