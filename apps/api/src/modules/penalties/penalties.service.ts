import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IndexType,
  LiquidacionStatus,
  LineItemType,
  LineBeneficiary,
  OVERDUE_STATUSES,
  PenaltyConfigSchema,
  Money,
  accruePenalty,
  splitPayments,
  todayInAR,
} from '@realfy/shared';
import type { AccruedPenalty, BnaRate, LiquidationExtraLine, PenaltyConfig, PenaltyRule } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { TenantsService } from '../tenants/tenants.service';
import { IndexDataService } from '../index-data/index-data.service';
import { getTermsAt } from '../contracts/contract-terms';
import { outstandingBalance } from '../liquidaciones/receivables';

/** Cliente o transacción de Prisma (la API usa `any` en los puntos que reciben `tx`). */
type Db = any;

export type PenaltySource = 'cron' | 'generation' | 'payment';

/** La regla en vigor para un contrato y la tasa BNA que necesita (si el modo la usa). */
export interface PenaltyContext {
  rule: PenaltyRule;
  /** De dónde sale la regla: el contrato la fijó o rige el valor por defecto de la inmobiliaria. */
  source: 'contract' | 'tenant';
  bnaRates: BnaRate[];
}

export interface PenaltyLiquidacion {
  id: string;
  tenantId: string;
  total: unknown;
  dueDate: Date;
  payments: ReadonlyArray<{ amount: unknown; paidAt: Date }>;
  /** Renglones de la liquidación: los Multa cobrados en ella misma no devengan punitorio. */
  lineItems?: ReadonlyArray<{ type: string; amount: unknown; sourceType?: string | null; sourceId?: string | null }>;
}

const OPEN_STATUSES: readonly string[] = [...OVERDUE_STATUSES];
/** Liquidaciones cuyo punitorio todavía se puede cobrar (se excluye la anulada y los borradores). */
const BILLED_STATUSES = [LiquidacionStatus.Enviada, LiquidacionStatus.Vencida, LiquidacionStatus.Pagada];

const conflict = (error: string, message: string) => new ConflictException({ error, message });

function sumAmounts(rows: ReadonlyArray<{ amount: unknown }>): Money {
  return rows.reduce((acc, r) => acc.plus(String(r.amount)), new Money(0));
}

function monthLabel(period: Date): string {
  return `${String(period.getUTCMonth() + 1).padStart(2, '0')}/${period.getUTCFullYear()}`;
}

/** Fecha `YYYY-MM-DD` como medianoche UTC. */
export function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

@Injectable()
export class PenaltiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly indexData: IndexDataService,
    private readonly audit: AuditService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── Regla en vigor ─────────────────────────────────

  /**
   * Regla de punitorios de un contrato a una fecha: la de la versión de reglas
   * vigente si fija una; si no, la de la inmobiliaria. Con el modo
   * `max_bna_or_daily` trae también la tasa activa del BNA cargada hasta esa fecha.
   */
  async loadContext(tenantId: string, contractId: string, asOf: Date): Promise<PenaltyContext> {
    const terms = await getTermsAt(this.prisma.baseClient as any, { id: contractId, tenantId }, asOf);
    const own = terms?.penaltyConfig == null ? null : PenaltyConfigSchema.safeParse(terms.penaltyConfig);
    let config: PenaltyConfig;
    let source: PenaltyContext['source'];
    if (own?.success) {
      config = own.data;
      source = 'contract';
    } else {
      config = await this.tenants.getPenaltyConfig(tenantId);
      source = 'tenant';
    }
    let bnaRates: BnaRate[] = [];
    if (config.mode === 'max_bna_or_daily') {
      const rows = await this.indexData.getForPeriod(IndexType.TasaActivaBNA, new Date('2000-01-01T00:00:00.000Z'), asOf, {
        tenantId,
        includeEstimates: true,
      });
      bnaRates = rows.map((r: any) => ({ from: r.period as Date, annualPct: r.value.toString() }));
    }
    return { rule: config, source, bnaRates };
  }

  // ─── Devengo ────────────────────────────────────────

  /** Lo devengado por una liquidación a `asOf`, sobre el saldo de cada día. */
  compute(liq: PenaltyLiquidacion, ctx: PenaltyContext, asOf: Date): AccruedPenalty {
    // El punitorio ya cobrado en esta misma liquidación (renglón Multa propio) no devenga punitorio:
    // se calcula sobre el alquiler impago, con los pagos imputados según `partialPaymentAllocation`.
    const own = (liq.lineItems ?? []).filter(
      (l) => l.type === LineItemType.Multa && l.sourceType === 'Penalty' && l.sourceId === liq.id,
    );
    const { rentTotal, rentPayments } = splitPayments({
      total: String(liq.total),
      billedPenalty: sumAmounts(own),
      payments: liq.payments.map((p) => ({ date: p.paidAt, amount: String(p.amount) })),
      allocation: ctx.rule.partialPaymentAllocation,
    });
    return accruePenalty({
      dueDate: liq.dueDate,
      asOf,
      total: rentTotal,
      payments: rentPayments,
      rule: ctx.rule,
      bnaRates: ctx.bnaRates,
    });
  }

  /**
   * Agrega la fila de punitorio que falta para llegar a lo devengado a `asOf`:
   * lo ya registrado (activo, condonado o cobrado) se descuenta, así cada fila
   * es el devengo de un tramo y correr dos veces el mismo día no duplica.
   * Quien llama sostiene el bloqueo de la liquidación (ver `accrueLocked`).
   */
  async accrue(
    db: Db,
    liq: PenaltyLiquidacion,
    ctx: PenaltyContext,
    asOf: Date,
    source: PenaltySource,
  ): Promise<{ result: AccruedPenalty; created: { id: string; amount: Money } | null }> {
    const result = this.compute(liq, ctx, asOf);
    const existing = await db.penalty.aggregate({ where: { liquidacionId: liq.id }, _sum: { amount: true } });
    const delta = result.amount.minus(String(existing._sum.amount ?? 0));
    if (delta.lte(0)) return { result, created: null };

    const row = await db.penalty.create({
      data: {
        tenantId: liq.tenantId,
        liquidacionId: liq.id,
        amount: delta.toFixed(2),
        compoundBase: result.baseAtStart.toFixed(2),
        appliedOn: asOf,
        daysOverdue: result.daysOverdue,
        status: 'active',
      },
    });
    // Un punitorio cambia lo que debe el inquilino: queda auditado aunque no haya un usuario detrás.
    await this.audit.record(db, {
      action: 'CREATE',
      entity: 'Penalty',
      entityId: row?.id,
      tenantId: liq.tenantId,
      ...(source === 'cron' ? { userId: null } : {}),
      after: { liquidacionId: liq.id, amount: delta.toFixed(2), daysOverdue: result.daysOverdue },
      metadata: { source, mode: ctx.rule.mode },
    });
    return { result, created: { id: row?.id, amount: delta } };
  }

  /** `accrue` dentro de su propia transacción, con la liquidación bloqueada (SELECT ... FOR UPDATE). */
  async accrueLocked(
    tenantId: string,
    liquidacionId: string,
    ctx: PenaltyContext,
    asOf: Date,
    source: PenaltySource,
  ): Promise<{ created: Money | null; skipped: 'NO_BALANCE' | 'NOT_OVERDUE' | null }> {
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM liquidaciones WHERE id = ${liquidacionId} AND "tenantId" = ${tenantId} FOR UPDATE`,
      );
      const liq = await tx.liquidacion.findFirst({
        where: { id: liquidacionId },
        select: {
          id: true,
          tenantId: true,
          total: true,
          dueDate: true,
          status: true,
          payments: { select: { amount: true, paidAt: true } },
          lineItems: { select: { type: true, amount: true, sourceType: true, sourceId: true } },
        },
      });
      if (!liq) throw new NotFoundException({ error: 'LIQUIDACION_NOT_FOUND', message: 'Liquidación not found' });
      if (outstandingBalance({ total: liq.total.toString(), payments: liq.payments }).lte(0)) {
        return { created: null, skipped: 'NO_BALANCE' as const };
      }
      const { created } = await this.accrue(tx, liq, ctx, asOf, source);
      return { created: created?.amount ?? null, skipped: null };
    });
  }

  // ─── Monto a pagar ──────────────────────────────────

  /**
   * Lo que debe una liquidación en `asOf`: el saldo más los punitorios
   * devengados a esa fecha que no se condonaron ni se cobraron ya en otra
   * liquidación. No guarda nada.
   */
  async payoffOf(db: Db, liq: PenaltyLiquidacion, ctx: PenaltyContext, asOf: Date) {
    const result = this.compute(liq, ctx, asOf);
    const rows = await db.penalty.findMany({
      where: { liquidacionId: liq.id },
      select: { amount: true, status: true, settledLiquidacionId: true },
    });
    const waived = sumAmounts(rows.filter((r: any) => r.status === 'waived'));
    const settled = sumAmounts(rows.filter((r: any) => r.status === 'active' && r.settledLiquidacionId));
    const due = Money.max(result.amount.minus(waived).minus(settled), new Money(0));
    return { result, waived, settled, due };
  }

  /** `GET /liquidaciones/:id/payoff?date=`. */
  async payoff(liquidacionId: string, day?: string) {
    const tenantId = this.tenantIdOrThrow();
    const asOf = day ? parseDay(day) : todayInAR();
    const liq = await this.prisma.client.liquidacion.findFirst({
      where: { id: liquidacionId },
      select: {
        id: true,
        tenantId: true,
        contractId: true,
        total: true,
        dueDate: true,
        status: true,
        currency: true,
        payments: { select: { amount: true, paidAt: true } },
        lineItems: { select: { type: true, amount: true, sourceType: true, sourceId: true } },
      },
    });
    if (!liq) throw new NotFoundException({ error: 'LIQUIDACION_NOT_FOUND', message: 'Liquidación not found' });
    if (!OPEN_STATUSES.includes(liq.status)) {
      return { liquidacionId, date: asOf.toISOString().slice(0, 10), currency: liq.currency, balance: '0.00', penalty: null, total: '0.00' };
    }
    const ctx = await this.loadContext(tenantId, liq.contractId, asOf);
    const { result, waived, settled, due } = await this.payoffOf(this.prisma.client, liq, ctx, asOf);
    const balance = outstandingBalance({ total: liq.total.toString(), payments: liq.payments });
    return {
      liquidacionId,
      date: asOf.toISOString().slice(0, 10),
      currency: liq.currency,
      balance: balance.toFixed(2),
      penalty: {
        accrued: result.amount.toFixed(2),
        waived: waived.toFixed(2),
        alreadyBilled: settled.toFixed(2),
        due: due.toFixed(2),
        daysOverdue: result.daysOverdue,
        accruingDays: result.accruingDays,
        graceDays: ctx.rule.graceDays,
        capHit: result.capHit,
        rule: {
          source: ctx.source,
          mode: ctx.rule.mode,
          value: String(ctx.rule.value),
          maxMultiplier: String(ctx.rule.maxMultiplier),
          ...(ctx.rule.mode === 'max_bna_or_daily'
            ? {
                bnaMultiplier: String(ctx.rule.bnaMultiplier ?? '2'),
                yearDays: ctx.rule.yearDays ?? 365,
                bnaRateKind: ctx.rule.bnaRateKind ?? 'Nominal',
                bnaDays: result.bnaDays,
                floorDays: result.floorDays,
                daysWithoutRate: result.daysWithoutRate,
                blockedDays: result.blockedDays,
              }
            : {}),
          partialPaymentAllocation: ctx.rule.partialPaymentAllocation ?? 'RentaPrimero',
          roundingMode: ctx.rule.roundingMode ?? 'Total',
          capBase: ctx.rule.capBase ?? 'SaldoInicioMora',
        },
      },
      total: balance.plus(due).toFixed(2),
    };
  }

  // ─── Cobro en la liquidación siguiente ──────────────

  /**
   * Renglones Multa para la liquidación de `period` de un contrato: los
   * punitorios devengados en liquidaciones anteriores que todavía no se
   * cobraron ni se condonaron, uno por liquidación de origen (`sourceId` es el
   * id de esa liquidación). Antes de armarlos pone al día el devengo de las
   * vencidas hasta `today`. `rowIds` son las filas a marcar con
   * `markSettled` en la misma transacción que crea la liquidación.
   */
  async pendingLines(
    tenantId: string,
    contractId: string,
    period: Date,
    today: Date,
  ): Promise<{ lines: LiquidationExtraLine[]; rowIds: string[] }> {
    const sources = await this.prisma.client.liquidacion.findMany({
      where: { contractId, period: { lt: period }, status: { in: BILLED_STATUSES as any } },
      select: { id: true, period: true, dueDate: true, status: true },
      orderBy: { period: 'asc' },
    });
    if (sources.length === 0) return { lines: [], rowIds: [] };

    const overdue = sources.filter((s: any) => OPEN_STATUSES.includes(s.status) && s.dueDate.getTime() < today.getTime());
    if (overdue.length > 0) {
      const ctx = await this.loadContext(tenantId, contractId, today);
      for (const s of overdue) await this.accrueLocked(tenantId, s.id, ctx, today, 'generation');
    }

    const rows = await this.prisma.client.penalty.findMany({
      where: { liquidacionId: { in: sources.map((s: any) => s.id) }, status: 'active', settledLiquidacionId: null },
      orderBy: { appliedOn: 'asc' },
      select: { id: true, liquidacionId: true, amount: true, daysOverdue: true },
    });
    const lines: LiquidationExtraLine[] = [];
    const rowIds: string[] = [];
    for (const source of sources as any[]) {
      const mine = rows.filter((r: any) => r.liquidacionId === source.id);
      const amount = sumAmounts(mine);
      if (amount.lte(0)) continue;
      const days = Math.max(...mine.map((r: any) => r.daysOverdue as number));
      lines.push({
        type: LineItemType.Multa,
        description: `Punitorios por mora, alquiler ${monthLabel(source.period)} (${days} días)`,
        amount: amount.toFixed(2),
        commissionable: true,
        beneficiary: LineBeneficiary.Locador,
        sourceType: 'Penalty',
        sourceId: source.id,
      });
      rowIds.push(...mine.map((r: any) => r.id as string));
    }
    return { lines, rowIds };
  }

  /** Marca cada punitorio como cobrado en `liquidacionId`, una sola vez. */
  async markSettled(tx: Db, rowIds: string[], liquidacionId: string): Promise<number> {
    if (rowIds.length === 0) return 0;
    const result = await tx.penalty.updateMany({
      where: { id: { in: rowIds }, status: 'active', settledLiquidacionId: null },
      data: { settledLiquidacionId: liquidacionId },
    });
    if (result.count !== rowIds.length) {
      throw conflict('PENALTY_ALREADY_SETTLED', 'A penalty was already included in another liquidación');
    }
    return result.count;
  }

  /**
   * Libera los punitorios cobrados en una liquidación que se borra o se anula,
   * o los de un renglón Multa que se quita (`sourceLiquidacionId`).
   */
  async release(tx: Db, liquidacionId: string, sourceLiquidacionId?: string): Promise<number> {
    const result = await tx.penalty.updateMany({
      where: {
        settledLiquidacionId: liquidacionId,
        ...(sourceLiquidacionId ? { liquidacionId: sourceLiquidacionId } : {}),
      },
      data: { settledLiquidacionId: null },
    });
    return result.count;
  }

  // ─── Condonación ────────────────────────────────────

  /** Condona un punitorio con motivo. Queda en el registro de auditoría. */
  async waive(id: string, reason: string) {
    const penalty = await this.prisma.client.penalty.findFirst({ where: { id } });
    if (!penalty) throw new NotFoundException({ error: 'PENALTY_NOT_FOUND', message: `Penalty ${id} not found` });
    if (penalty.status === 'waived') throw conflict('PENALTY_ALREADY_WAIVED', 'The penalty is already waived');
    if (penalty.settledLiquidacionId) {
      throw conflict('PENALTY_ALREADY_SETTLED', 'The penalty was already billed in a liquidación');
    }
    const userId = this.userId();
    return this.prisma.client.$transaction(async (tx: any) => {
      const result = await tx.penalty.updateMany({
        where: { id, status: 'active', settledLiquidacionId: null },
        data: { status: 'waived', waivedAt: new Date(), waivedBy: userId, waiveReason: reason },
      });
      if (result.count === 0) throw conflict('PENALTY_ALREADY_SETTLED', 'The penalty was already billed or waived');
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Penalty',
        entityId: id,
        before: { status: 'active', amount: penalty.amount.toString() },
        after: { status: 'waived' },
        metadata: { source: 'waive', reason, liquidacionId: penalty.liquidacionId },
      });
      return tx.penalty.findFirst({ where: { id } });
    });
  }

  /** Condona todos los punitorios activos y sin cobrar de un contrato hasta `upTo` (inclusive). */
  async waiveAll(contractId: string, upTo: Date, reason: string) {
    const contract = await this.prisma.client.contract.findFirst({ where: { id: contractId }, select: { id: true } });
    if (!contract) throw new NotFoundException({ error: 'CONTRACT_NOT_FOUND', message: 'Contract not found' });
    const userId = this.userId();
    return this.prisma.client.$transaction(async (tx: any) => {
      const rows = await tx.penalty.findMany({
        where: {
          liquidacion: { contractId },
          status: 'active',
          settledLiquidacionId: null,
          appliedOn: { lte: upTo },
        },
        select: { id: true, amount: true },
      });
      if (rows.length > 0) {
        await tx.penalty.updateMany({
          where: { id: { in: rows.map((r: any) => r.id) }, status: 'active', settledLiquidacionId: null },
          data: { status: 'waived', waivedAt: new Date(), waivedBy: userId, waiveReason: reason },
        });
      }
      const total = sumAmounts(rows);
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Contract',
        entityId: contractId,
        after: { penaltiesWaived: rows.length, amount: total.toFixed(2) },
        metadata: {
          source: 'waive-all',
          reason,
          upTo: upTo.toISOString().slice(0, 10),
          penaltyIds: rows.map((r: any) => r.id),
        },
      });
      return { waived: rows.length, total: total.toFixed(2), upTo: upTo.toISOString().slice(0, 10) };
    });
  }

  private tenantIdOrThrow(): string {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) throw new Error('Penalties need a tenant context');
    return tenantId;
  }

  private userId(): string | null {
    return this.tenantContext.getUserId() ?? null;
  }
}
