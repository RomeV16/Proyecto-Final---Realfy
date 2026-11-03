import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AnnulOwnerStatementSchema,
  FinancialAccountKind,
  GenerateOwnerStatementsSchema,
  LessorChargeTiming,
  OwnerLedgerEntryType,
  OwnerStatementListSchema,
  OwnerStatementStatus,
  computeStatement,
  personName,
  propertyLabel,
  statementPeriodRange,
} from '@realfy/shared';
import type { StatementResult } from '@realfy/shared';
import Decimal from 'decimal.js';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { CashService } from '../cash/cash.service';
import { auditJson } from '../cash/cash.errors';
import { pendingLessorCharges, postLessorCharges } from './lessor-charges';
import { byLedgerOrder } from './ledger-posting';
import type { LessorChargePosting } from './lessor-charges';
import { enqueueCreditNotes } from '../invoices/lessor-invoice-queue';
import { PROPERTY_LABEL } from './owner-ledger.service';
import { OwnerStatementPdfService } from './owner-statement-pdf.service';

type Db = any;

const ISSUED: string[] = [OwnerStatementStatus.Emitido, OwnerStatementStatus.Enviado];
const PERSON = { select: { id: true, firstName: true, lastName: true, cuit: true, dni: true } } as const;

const notFound = (error: string, message: string) => new NotFoundException({ error, message });
const conflict = (error: string, message: string) => new ConflictException({ error, message });

/** "YYYY-MM" -> primer día del mes, a medianoche UTC. */
const monthOf = (period: string) => new Date(`${period}-01T00:00:00.000Z`);
const money = (v: Decimal.Value) => new Decimal(v).toFixed(2);
const keyOf = (personId: string, currency: string) => `${personId}|${currency}`;

/** Un movimiento del estado tal como lo devuelve la API y lo imprime el PDF. */
export interface StatementLine {
  id: string;
  date: Date;
  type: OwnerLedgerEntryType;
  amount: string;
  description: string;
  propertyId: string | null;
  contractId: string | null;
  groupLabel: string | null;
  /** Cargo del centro de carga que todavía no se asentó (se asienta al emitir). */
  provisional?: boolean;
}

/**
 * Estados de cuenta mensuales del locador (ADR-0009): uno por locador, mes y
 * moneda, con todas sus unidades y el saldo arrastrado del último emitido.
 *
 * - Generar arma borradores para todos los locadores con movimientos sin
 *   emitir o con saldo; un borrador se recalcula cada vez que se genera.
 * - Emitir recalcula y bloquea los asientos (`statementId`); un asiento
 *   bloqueado no se toca hasta anular el estado.
 * - Anular libera los asientos; solo se anula el último emitido de cada
 *   locador y moneda, para no romper el arrastre.
 */
@Injectable()
export class OwnerStatementsService {
  private readonly logger = new Logger(OwnerStatementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly operationalDefaults: OperationalDefaultsService,
    private readonly cash: CashService,
    private readonly pdfs: OwnerStatementPdfService,
  ) {}

  // ─── Generar ────────────────────────────────────────

  async generate(data: unknown) {
    const input = parseOrThrow(GenerateOwnerStatementsSchema, data, 'Invalid statement generation');
    const period = monthOf(input.period);
    const tenantId = this.tenantContext.getTenantId()!;
    const { ownerAccounts } = await this.operationalDefaults.get(tenantId);
    const ctx = { tenantId, closeDay: ownerAccounts.statementCloseDay, userId: this.tenantContext.getUserId() ?? null };
    const atGeneration = ownerAccounts.lessorChargeTiming === LessorChargeTiming.AlGenerarEstado;

    return this.prisma.client.$transaction(
      async (tx: Db) => {
        // Con un solo locador, solo los cargos que él soporta (con todos sus locadores).
        const charges = (await pendingLessorCharges(tx, { period, closeDay: ctx.closeDay })).filter(
          (c) => !input.personId || c.personIds.includes(input.personId),
        );
        if (atGeneration) await postLessorCharges(tx, ctx, charges);
        const preview = atGeneration ? [] : charges;

        const personFilter = input.personId ? { personId: input.personId } : {};
        const unlocked: any[] = await tx.ownerLedgerEntry.groupBy({
          by: ['personId', 'currency'],
          where: { statementId: null, period: { lte: period }, ...personFilter },
        });
        const lastIssued = await this.lastIssuedByKey(tx, personFilter);
        const keys = new Set<string>(unlocked.map((u) => keyOf(u.personId, u.currency)));
        for (const [key, last] of lastIssued) if (!new Decimal(String(last.closing)).isZero()) keys.add(key);
        for (const p of preview) {
          for (const e of p.entries) if (!input.personId || e.personId === input.personId) keys.add(keyOf(e.personId, e.currency));
        }

        const created: string[] = [];
        const updated: string[] = [];
        const skipped: { personId: string; currency: string; reason: string }[] = [];
        const idByKey = new Map<string, string>();
        for (const key of [...keys].sort((a, b) => a.localeCompare(b))) {
          const [personId, currency] = key.split('|');
          const last = lastIssued.get(key) ?? null;
          const existing = await tx.ownerStatement.findFirst({ where: { personId, period, currency } });
          if (existing && ISSUED.includes(existing.status)) {
            skipped.push({ personId, currency, reason: 'STATEMENT_ALREADY_ISSUED' });
            continue;
          }
          if (last && last.period.getTime() >= period.getTime()) {
            skipped.push({ personId, currency, reason: 'STATEMENT_PERIOD_CLOSED' });
            continue;
          }
          const { result } = await this.compute(tx, { personId, currency, period, previous: last, preview });
          const totals = {
            status: OwnerStatementStatus.Borrador,
            opening: money(result.opening),
            credits: money(result.credits),
            debits: money(result.debits),
            payouts: money(result.payouts),
            closing: money(result.closing),
            issuedAt: null,
            annulledAt: null,
            annulReason: null,
          };
          const statement = existing
            ? await tx.ownerStatement.update({ where: { id: existing.id }, data: totals })
            : await tx.ownerStatement.create({
                data: { tenantId, personId, period, currency, ...totals, createdById: ctx.userId },
              });
          (existing ? updated : created).push(statement.id);
          idByKey.set(key, statement.id);
        }

        // Cada cargo asentado queda ligado al estado de su primer locador (contrato con 03-modelo-datos).
        if (atGeneration) await this.stampCharges(tx, charges, idByKey);

        await this.audit.record(tx, {
          action: 'CREATE',
          entity: 'OwnerStatement',
          entityId: null,
          after: { created, updated, skipped },
          metadata: { operation: 'owner-statements-generate', period: input.period, chargesPosted: atGeneration ? charges.length : 0 },
        });
        this.logger.log('Owner statements generated', { period: input.period, created: created.length, updated: updated.length });
        return { period: input.period, created: created.length, updated: updated.length, skipped, chargesPosted: atGeneration ? charges.length : 0 };
      },
      { timeout: 60_000 },
    );
  }

  // ─── Lecturas ───────────────────────────────────────

  async list(query: unknown) {
    const filters = parseOrThrow(OwnerStatementListSchema, query, 'Invalid filter parameters');
    const where: Record<string, unknown> = {};
    if (filters.period) where.period = monthOf(filters.period);
    if (filters.personId) where.personId = filters.personId;
    if (filters.status) where.status = filters.status;
    if (filters.currency) where.currency = filters.currency;
    const [rows, total] = await Promise.all([
      this.prisma.client.ownerStatement.findMany({
        where,
        include: { person: PERSON, _count: { select: { entries: true } } },
        orderBy: [{ period: 'desc' }, { person: { lastName: 'asc' } }, { person: { firstName: 'asc' } }, { currency: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.ownerStatement.count({ where }),
    ]);
    return {
      items: rows.map((r: any) => this.summary(r)),
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
    };
  }

  /**
   * Un estado con sus movimientos agrupados por unidad. Uno emitido muestra sus
   * asientos bloqueados; un borrador o uno anulado se recalcula con lo que hay
   * sin emitir (y, si los cargos se descuentan al emitir, los muestra como
   * previstos).
   */
  async findOne(id: string) {
    const statement = await this.requireStatement(this.prisma.client, id);
    const tenantId = this.tenantContext.getTenantId()!;
    const { ownerAccounts } = await this.operationalDefaults.get(tenantId);
    const issued = ISSUED.includes(statement.status);
    let result: StatementResult<StatementLine>;
    if (issued) {
      const previous = await this.previousIssued(this.prisma.client, statement);
      const entries = await this.lines(this.prisma.client, { statementId: statement.id });
      result = computeStatement({ previousClosing: previous?.closing?.toString() ?? 0, entries });
    } else {
      const preview =
        ownerAccounts.lessorChargeTiming === LessorChargeTiming.AlEmitirEstado
          ? await pendingLessorCharges(this.prisma.client, {
              period: statement.period,
              closeDay: ownerAccounts.statementCloseDay,
              currency: statement.currency,
            })
          : [];
      const last = (await this.lastIssuedByKey(this.prisma.client, { personId: statement.personId })).get(
        keyOf(statement.personId, statement.currency),
      );
      ({ result } = await this.compute(this.prisma.client, {
        personId: statement.personId,
        currency: statement.currency,
        period: statement.period,
        previous: last ?? null,
        preview,
      }));
    }
    const custody = await this.custodyBalance(statement.personId, statement.currency);
    const range = statementPeriodRange(statement.period, ownerAccounts.statementCloseDay);
    return {
      ...this.summary(statement),
      from: range.from,
      to: range.to,
      totals: {
        opening: money(result.opening),
        initial: money(result.initial),
        credits: money(result.credits),
        debits: money(result.debits),
        payouts: money(result.payouts),
        closing: money(result.closing),
      },
      custody: custody.toFixed(2),
      groups: result.groups.map((g) => ({
        propertyId: g.propertyId,
        label: g.label,
        credits: money(g.credits),
        debits: money(g.debits),
        payouts: money(g.payouts),
        net: money(g.net),
        entries: g.entries,
      })),
    };
  }

  async pdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const detail = await this.findOne(id);
    const tenant: any = await this.prisma.client.tenant.findFirst({ where: { id: this.tenantContext.getTenantId()! } });
    const buffer = await this.pdfs.render(detail, tenant);
    const period = detail.period.toISOString().slice(0, 7);
    const who = detail.person.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/(^-|-$)/g, '').toLowerCase() || detail.personId;
    return { buffer, filename: `estado-de-cuenta-${who}-${period}-${detail.currency}.pdf` };
  }

  // ─── Emitir y anular ────────────────────────────────

  /**
   * Emite un borrador: lo recalcula con lo que hay sin emitir hasta su mes
   * (asentando antes los cargos, si se descuentan al emitir) y bloquea esos
   * asientos con el id del estado. No se emite un mes anterior o igual al último
   * emitido del locador en esa moneda.
   */
  async issue(id: string) {
    const tenantId = this.tenantContext.getTenantId()!;
    const { ownerAccounts } = await this.operationalDefaults.get(tenantId);
    const ctx = { tenantId, closeDay: ownerAccounts.statementCloseDay, userId: this.tenantContext.getUserId() ?? null };
    return this.prisma.client.$transaction(
      async (tx: Db) => {
        await this.lock(tx, tenantId, id);
        const statement = await this.requireStatement(tx, id);
        if (statement.status !== OwnerStatementStatus.Borrador) {
          throw conflict('STATEMENT_NOT_DRAFT', `The statement is ${statement.status}`);
        }
        const last = (await this.lastIssuedByKey(tx, { personId: statement.personId })).get(
          keyOf(statement.personId, statement.currency),
        );
        if (last && last.period.getTime() >= statement.period.getTime()) {
          throw conflict('STATEMENT_PERIOD_CLOSED', 'A statement for this or a later month was already issued');
        }
        if (ownerAccounts.lessorChargeTiming === LessorChargeTiming.AlEmitirEstado) {
          const charges = (
            await pendingLessorCharges(tx, { period: statement.period, closeDay: ctx.closeDay, currency: statement.currency })
          ).filter((c) => c.personIds.includes(statement.personId));
          await postLessorCharges(tx, ctx, charges);
          await this.stampCharges(tx, charges, new Map(charges.map((c) => [keyOf(c.personIds[0], c.currency), id])));
        }
        const { result, ids } = await this.compute(tx, {
          personId: statement.personId,
          currency: statement.currency,
          period: statement.period,
          previous: last ?? null,
          preview: [],
        });
        if (ids.length > 0) {
          const locked = await tx.ownerLedgerEntry.updateMany({ where: { id: { in: ids }, statementId: null }, data: { statementId: id } });
          if (locked.count !== ids.length) throw conflict('STATEMENT_CHANGED', 'The ledger changed while issuing: try again');
        }
        const after = await tx.ownerStatement.update({
          where: { id },
          data: {
            status: OwnerStatementStatus.Emitido,
            issuedAt: new Date(),
            opening: money(result.opening),
            credits: money(result.credits),
            debits: money(result.debits),
            payouts: money(result.payouts),
            closing: money(result.closing),
          },
          include: { person: PERSON },
        });
        await this.audit.record(tx, {
          action: 'UPDATE',
          entity: 'OwnerStatement',
          entityId: id,
          before: auditJson(statement),
          after: auditJson(after),
          metadata: { operation: 'owner-statement-issue', entries: ids.length },
        });
        this.logger.log('Owner statement issued', { id, entries: ids.length });
        return this.summary(after);
      },
      { timeout: 60_000 },
    );
  }

  /**
   * Anula un estado y libera sus asientos (vuelven a entrar en el próximo).
   * Solo el último emitido de cada locador y moneda: anular uno anterior
   * rompería el saldo arrastrado de los siguientes. Los cargos asentados quedan
   * en la cuenta corriente: no vuelven a Pendiente.
   */
  async annul(id: string, data: unknown) {
    const input = parseOrThrow(AnnulOwnerStatementSchema, data, 'Invalid annulment');
    const tenantId = this.tenantContext.getTenantId()!;
    return this.prisma.client.$transaction(async (tx: Db) => {
      await this.lock(tx, tenantId, id);
      const statement = await this.requireStatement(tx, id);
      if (statement.status === OwnerStatementStatus.Anulado) {
        throw conflict('STATEMENT_ALREADY_ANNULLED', 'The statement is already annulled');
      }
      const later = await tx.ownerStatement.count({
        where: {
          personId: statement.personId,
          currency: statement.currency,
          status: { in: ISSUED },
          period: { gt: statement.period },
        },
      });
      if (later > 0) throw conflict('STATEMENT_NOT_LATEST', 'Annul the later statements of this lessor first');
      const released = await tx.ownerLedgerEntry.updateMany({ where: { statementId: id }, data: { statementId: null } });
      // Las facturas emitidas por cuenta del locador por este estado quedan en cola para su nota de crédito.
      const creditNotes = await enqueueCreditNotes(tx, tenantId, 'OwnerStatement', id);
      const after = await tx.ownerStatement.update({
        where: { id },
        data: { status: OwnerStatementStatus.Anulado, annulledAt: new Date(), annulReason: input.reason },
        include: { person: PERSON },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'OwnerStatement',
        entityId: id,
        before: auditJson(statement),
        after: auditJson(after),
        metadata: { operation: 'owner-statement-annul', reason: input.reason, released: released.count, creditNotes },
      });
      this.logger.log('Owner statement annulled', { id, released: released.count });
      return this.summary(after);
    });
  }

  // ─── Internos ───────────────────────────────────────

  /** Asientos sin emitir hasta el mes (más los cargos previstos) y el estado que dan. */
  private async compute(
    db: Db,
    input: { personId: string; currency: string; period: Date; previous: any; preview: LessorChargePosting[] },
  ): Promise<{ result: StatementResult<StatementLine>; ids: string[] }> {
    const entries = await this.lines(db, {
      personId: input.personId,
      currency: input.currency,
      statementId: null,
      period: { lte: input.period },
    });
    const ids = entries.map((e) => e.id);
    const provisional = await this.previewLines(db, input, entries.length);
    const result = computeStatement({
      previousClosing: input.previous?.closing?.toString() ?? 0,
      entries: [...entries, ...provisional],
    });
    return { result, ids };
  }

  private async previewLines(
    db: Db,
    input: { personId: string; currency: string; preview: LessorChargePosting[] },
    offset: number,
  ): Promise<StatementLine[]> {
    const raw = input.preview.flatMap((p) =>
      p.entries.filter((e) => e.personId === input.personId && e.currency === input.currency),
    );
    if (raw.length === 0) return [];
    const properties: any[] = await db.property.findMany({
      where: { id: { in: [...new Set(raw.map((e) => e.propertyId).filter(Boolean))] } },
      select: PROPERTY_LABEL,
    });
    return raw.map((e, i) => ({
      id: `prevision-${offset + i}`,
      date: e.date,
      type: e.type,
      amount: money(e.amount),
      description: e.description,
      propertyId: e.propertyId ?? null,
      contractId: e.contractId ?? null,
      groupLabel: propertyLabel(properties.find((p) => p.id === e.propertyId)) || null,
      provisional: true,
    }));
  }

  private async lines(db: Db, where: Record<string, unknown>): Promise<StatementLine[]> {
    const rows: any[] = await db.ownerLedgerEntry.findMany({
      where,
      include: { property: { select: PROPERTY_LABEL } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    rows.sort(byLedgerOrder);
    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      type: r.type,
      amount: money(String(r.amount)),
      description: r.description,
      propertyId: r.propertyId,
      contractId: r.contractId,
      groupLabel: r.property ? propertyLabel(r.property) || null : null,
    }));
  }

  /** Último estado emitido de cada locador y moneda. */
  private async lastIssuedByKey(db: Db, where: Record<string, unknown>): Promise<Map<string, any>> {
    const rows: any[] = await db.ownerStatement.findMany({
      where: { ...where, status: { in: ISSUED } },
      orderBy: { period: 'desc' },
    });
    const out = new Map<string, any>();
    for (const row of rows) {
      const key = keyOf(row.personId, row.currency);
      if (!out.has(key)) out.set(key, row);
    }
    return out;
  }

  private async previousIssued(db: Db, statement: any) {
    return db.ownerStatement.findFirst({
      where: {
        personId: statement.personId,
        currency: statement.currency,
        status: { in: ISSUED },
        period: { lt: statement.period },
      },
      orderBy: { period: 'desc' },
    });
  }

  private async stampCharges(tx: Db, charges: LessorChargePosting[], idByKey: Map<string, string>) {
    for (const charge of charges) {
      const statementId = idByKey.get(keyOf(charge.personIds[0], charge.currency));
      if (statementId) {
        await tx.pendingCharge.update({ where: { id: charge.chargeId }, data: { imputedStatementId: statementId } });
      }
    }
  }

  private async custodyBalance(personId: string, currency: string): Promise<Decimal> {
    const account = await this.prisma.client.financialAccount.findFirst({
      where: { kind: FinancialAccountKind.Custodia, ownerPersonId: personId, currency: currency as any },
      select: { id: true },
    });
    if (!account) return new Decimal(0);
    return (await this.cash.balances(this.prisma.client, [account.id])).get(account.id) ?? new Decimal(0);
  }

  private async requireStatement(db: Db, id: string) {
    const statement = await db.ownerStatement.findFirst({ where: { id }, include: { person: PERSON } });
    if (!statement) throw notFound('STATEMENT_NOT_FOUND', 'Owner statement not found');
    return statement;
  }

  /** Bloquea la fila del estado hasta el commit (SQL crudo: filtra por tenantId a mano, ADR-0006). */
  private async lock(tx: Db, tenantId: string, id: string) {
    const rows: { id: string }[] = await tx.$queryRaw(
      Prisma.sql`SELECT id FROM owner_statements WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`,
    );
    if (rows.length === 0) throw notFound('STATEMENT_NOT_FOUND', 'Owner statement not found');
  }

  private summary(s: any) {
    return {
      id: s.id,
      personId: s.personId,
      person: { id: s.person?.id ?? s.personId, name: personName(s.person), cuit: s.person?.cuit ?? null, dni: s.person?.dni ?? null },
      period: s.period,
      currency: s.currency,
      status: s.status,
      opening: money(String(s.opening)),
      credits: money(String(s.credits)),
      debits: money(String(s.debits)),
      payouts: money(String(s.payouts)),
      closing: money(String(s.closing)),
      entryCount: s._count?.entries ?? undefined,
      issuedAt: s.issuedAt ?? null,
      sentAt: s.sentAt ?? null,
      annulledAt: s.annulledAt ?? null,
      annulReason: s.annulReason ?? null,
      createdAt: s.createdAt,
    };
  }
}
