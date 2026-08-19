import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  buildMonthRange,
  buildBuckets,
  aggregateIntoBuckets,
  computeOccupancyPct,
  DateRange,
} from './dashboard-calculations';
import { DashboardCacheService } from './dashboard-cache.service';

const MONTHS_ES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

const PENDING_STATUSES = ['Aprobada', 'Enviada', 'Pendiente'];

export interface ProfitabilityRow {
  propertyId: string;
  label: string;
  revenue: number;
  expenses: number;
  net: number;
}

export interface CashFlowRow {
  period: string;
  inflow: number;
  outflow: number;
  net: number;
}

export interface DelinquencyResult {
  current: number;
  trend: Array<{ month: string; pct: number }>;
}

export interface FiscalStatsResult {
  emissionsLast30d: {
    count: number;
    byIssuer: Array<{
      issuerId: string;
      cuit: string;
      businessName: string;
      count: number;
      totalAmount: string;
    }>;
  };
  errorsLast30d: {
    count: number;
    rate: string;
    topErrors: Array<{ errorCode: string; count: number }>;
  };
  avgCaeLatencyMs: number;
  certificate: {
    exists: boolean;
    daysToExpiry?: number;
    isProduction?: boolean;
  };
  issuers: {
    active: number;
    pending: number;
    revoked: number;
  };
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: DashboardCacheService,
  ) {}

  async getStats() {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86400000);
    const in60 = new Date(now.getTime() + 60 * 86400000);
    const in90 = new Date(now.getTime() + 90 * 86400000);

    const [
      properties,
      activeContracts,
      liquidaciones,
      openTickets,
      totalServices,
    ] = await Promise.all([
      this.prisma.client.property.findMany({
        select: {
          id: true,
          title: true,
          type: true,
          operations: { select: { operationType: true, price: true, state: true } },
        },
      }),
      this.prisma.client.contract.findMany({
        where: { status: 'Activo' },
        select: {
          id: true,
          rentAmount: true,
          endDate: true,
          property: { select: { title: true } },
          persons: {
            select: { role: true, person: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
      this.prisma.client.liquidacion.findMany({
        select: {
          id: true,
          period: true,
          dueDate: true,
          total: true,
          status: true,
          contract: { select: { property: { select: { title: true } } } },
        },
      }),
      this.prisma.client.ticket.findMany({
        where: {
          status: { notIn: ['Resuelto', 'Cerrado', 'Cancelado'] },
        },
        select: {
          id: true,
          title: true,
          priority: true,
          status: true,
          createdAt: true,
          property: { select: { title: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.service.count(),
    ]);

    // ── Occupancy ──────────────────────────────────────────
    const totalProperties = properties.length;
    const occupiedUnits = properties.filter((p) =>
      p.operations.some((o) => ['Alquilado', 'Ocupado'].includes(o.state as string)),
    ).length;
    const vacantUnits = Math.max(0, totalProperties - occupiedUnits);
    const occupancyRate =
      totalProperties > 0 ? Math.round((occupiedUnits / totalProperties) * 100) : 0;

    // ── Portfolio composition by type ──────────────────────
    const typeCounts = new Map<string, number>();
    for (const p of properties) {
      typeCounts.set(p.type as string, (typeCounts.get(p.type as string) ?? 0) + 1);
    }
    const propertiesByType = [...typeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // Portfolio asset value — highest operation price per property (ARS)
    let portfolioValue = 0;
    for (const p of properties) {
      const prices = p.operations
        .map((o) => Number(o.price ?? 0))
        .filter((n) => n > 0);
      if (prices.length) portfolioValue += Math.max(...prices);
    }

    // ── Rent roll (monthly expected income from active leases) ──
    const monthlyRentRoll = activeContracts.reduce(
      (sum, c) => sum + Number(c.rentAmount ?? 0),
      0,
    );
    const avgRent =
      activeContracts.length > 0
        ? Math.round(monthlyRentRoll / activeContracts.length)
        : 0;

    // ── Contract expirations ───────────────────────────────
    const within = (from: Date, to: Date) =>
      activeContracts.filter((c) => c.endDate >= from && c.endDate <= to).length;
    const expiringContracts = {
      within30: within(now, in30),
      within60: within(in30, in60),
      within90: within(in60, in90),
    };

    const tenantName = (c: (typeof activeContracts)[number]) => {
      const inq = c.persons.find((p) => p.role === 'Inquilino')?.person;
      return inq ? `${inq.firstName} ${inq.lastName}` : '—';
    };
    const expiringAgenda = activeContracts
      .filter((c) => c.endDate >= now && c.endDate <= in90)
      .sort((a, b) => a.endDate.getTime() - b.endDate.getTime())
      .slice(0, 5)
      .map((c) => ({
        id: c.id,
        property: c.property?.title ?? '—',
        tenant: tenantName(c),
        endDate: c.endDate.toISOString(),
        daysLeft: Math.max(0, Math.round((c.endDate.getTime() - now.getTime()) / 86400000)),
      }));

    // ── Collections (current cycle) + delinquency (all outstanding) ──
    const curKey = `${now.getFullYear()}-${now.getMonth()}`;
    const periodKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
    let pagada = 0; // cobrado en el ciclo actual
    let pendiente = 0; // facturado sin cobrar del ciclo actual
    let vencida = 0; // deuda vencida acumulada (todos los ciclos)
    for (const l of liquidaciones) {
      const amount = Number(l.total);
      const inCurrent = periodKey(l.period) === curKey;
      if (l.status === 'Vencida') vencida += amount;
      else if (l.status === 'Pagada') {
        if (inCurrent) pagada += amount;
      } else if (PENDING_STATUSES.includes(l.status as string)) {
        if (inCurrent) pendiente += amount;
      }
    }
    const collectionsTotal = pagada + pendiente + vencida;
    const collectionRate =
      collectionsTotal > 0 ? Math.round((pagada / collectionsTotal) * 100) : 0;

    const pendingList = liquidaciones
      .filter((l) => l.status === 'Vencida' || PENDING_STATUSES.includes(l.status as string))
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
      .slice(0, 5)
      .map((l) => ({
        id: l.id,
        property: l.contract?.property?.title ?? '—',
        period: l.period.toISOString(),
        amount: Math.round(Number(l.total)),
        status: l.status,
      }));
    const pendingLiquidaciones = liquidaciones.filter(
      (l) => l.status === 'Vencida' || PENDING_STATUSES.includes(l.status as string),
    ).length;

    // ── Revenue trend — last 6 months (expected vs collected) ──
    const revenueTrend: { month: string; expected: number; collected: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      let expected = 0;
      let collected = 0;
      for (const l of liquidaciones) {
        const lp = l.period;
        if (`${lp.getFullYear()}-${lp.getMonth()}` === key) {
          const amt = Number(l.total);
          expected += amt;
          if (l.status === 'Pagada') collected += amt;
        }
      }
      revenueTrend.push({
        month: MONTHS_ES[d.getMonth()],
        expected: Math.round(expected),
        collected: Math.round(collected),
      });
    }

    // ── Tickets ────────────────────────────────────────────
    const urgentSet = ['Urgente', 'Alta'];
    const ticketsAgenda = openTickets
      .slice()
      .sort((a, b) => {
        const order = { Urgente: 0, Alta: 1, Media: 2, Baja: 3 } as Record<string, number>;
        return (order[a.priority as string] ?? 9) - (order[b.priority as string] ?? 9);
      })
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        property: t.property?.title ?? '—',
      }));

    return {
      currency: 'ARS',
      // headline financials
      monthlyRentRoll: Math.round(monthlyRentRoll),
      avgRent,
      portfolioValue: Math.round(portfolioValue),
      // occupancy
      totalProperties,
      occupiedUnits,
      vacantUnits,
      occupancyRate,
      activeContracts: activeContracts.length,
      // collections
      collections: {
        total: Math.round(collectionsTotal),
        pagada: Math.round(pagada),
        pendiente: Math.round(pendiente),
        vencida: Math.round(vencida),
        rate: collectionRate,
      },
      delinquency: {
        overdueAmount: Math.round(vencida),
        rate: collectionsTotal > 0 ? Math.round((vencida / collectionsTotal) * 100) : 0,
      },
      tickets: {
        open: openTickets.length,
        urgent: openTickets.filter((t) => urgentSet.includes(t.priority as string)).length,
      },
      pendingLiquidaciones,
      totalServices,
      expiringContracts,
      propertiesByType,
      revenueTrend,
      agenda: {
        expiring: expiringAgenda,
        collections: pendingList,
        tickets: ticketsAgenda,
      },
    };
  }

  /**
   * Occupancy trend: percentage of occupied properties at end-of-month for
   * each of the last `rangeMonths` months (inclusive of the current month).
   *
   * CAVEAT: No historical state snapshots exist in this schema (PropertyOperation
   * only stores the current `state`). The calculation therefore uses the current
   * state as a proxy for every month — it is accurate for the present but will
   * misrepresent past months when properties change state over time.
   * A future improvement would add a `PropertyStateHistory` table with
   * (propertyOperationId, state, changedAt) to reconstruct point-in-time views.
   *
   * Numerator:   PropertyOperation rows where operationType=Alquiler AND
   *              state IN [Alquilado, Ocupado] AND createdAt <= EoM,
   *              scoped to tenantId.
   * Denominator: PropertyOperation rows where operationType=Alquiler AND
   *              state != Archivado AND createdAt <= EoM,
   *              scoped to tenantId.
   */
  async getOccupancyTrend(
    tenantId: string,
    rangeMonths: number = 12,
  ): Promise<Array<{ month: string; occupancyPct: number }>> {
    const cacheKey = 'getOccupancyTrend';
    const args = [tenantId, rangeMonths];
    const cached = this.cache.get<Array<{ month: string; occupancyPct: number }>>(tenantId, cacheKey, args);
    if (cached) return cached;

    const months = buildMonthRange(rangeMonths);

    // La ocupación de un mes pasado se deriva de los contratos que estaban
    // vigentes ese mes, que es el único dato con historia que tiene el sistema.
    // Contar el estado actual de la operación filtrando por su fecha de alta no
    // describe el pasado: proyecta hacia atrás la foto de hoy, y una propiedad
    // alquilada esta semana apareceria como ocupada todos los meses anteriores.
    const results = await Promise.all(
      months.map(async ({ label, eom }) => {
        const [ocupadas, total] = await Promise.all([
          (this.prisma.client as any).contract.findMany({
            where: {
              tenantId,
              startDate: { lte: eom },
              OR: [
                { closedAt: { gte: eom } },
                { closedAt: null, endDate: { gte: eom } },
              ],
            },
            select: { propertyId: true },
            distinct: ['propertyId'],
          }),
          (this.prisma.client as any).propertyOperation.count({
            where: {
              tenantId,
              operationType: 'Alquiler',
              state: { not: 'Archivado' },
              createdAt: { lte: eom },
            },
          }),
        ]);

        return {
          month: label,
          occupancyPct: computeOccupancyPct(ocupadas.length, total),
        };
      }),
    );

    this.cache.set(tenantId, cacheKey, args, results);
    return results;
  }

  /**
   * Profitability by property over a date range.
   *
   * Revenue rule: sum of Payment.amount for Payments whose paidAt ∈ range and
   * whose Liquidacion belongs to a contract for this property AND the
   * Liquidacion status is Pagada.
   *
   * Expenses rule: sum of LiquidacionLineItem.amount for line items whose type
   * is NOT 'Alquiler' and NOT 'Descuento'. Rationale: the schema has no
   * `direction` field on LiquidacionLineItem. LineItemType values are:
   *   Alquiler  → main rent component (not an "extra" expense)
   *   Ajuste    → rent adjustment (outflow to tenant/cost of adjustment)
   *   Extra     → extra charge applied to the liquidación (outflow cost)
   *   Descuento → discount applied (reduces total, not a cost outflow)
   *   Multa     → penalty/fine (outflow cost)
   * Therefore, outflow = Ajuste + Extra + Multa (all non-Alquiler, non-Descuento).
   * Only items linked to Liquidaciones whose Payments fell within the range are
   * counted, scoped to tenantId.
   *
   * Returns results sorted by net descending.
   */
  async getProfitabilityByProperty(
    tenantId: string,
    range: DateRange,
  ): Promise<ProfitabilityRow[]> {
    const cacheKey = 'getProfitabilityByProperty';
    const args = [tenantId, range];
    const cached = this.cache.get<ProfitabilityRow[]>(tenantId, cacheKey, args);
    if (cached) return cached;

    // Fetch all payments in range with their liquidacion + contract + property
    const payments = await (this.prisma.client as any).payment.findMany({
      where: {
        tenantId,
        paidAt: { gte: range.from, lte: range.to },
      },
      select: {
        amount: true,
        liquidacion: {
          select: {
            id: true,
            status: true,
            contract: {
              select: {
                propertyId: true,
                property: {
                  select: { id: true, title: true, street: true, number: true, city: true },
                },
              },
            },
          },
        },
      },
    });

    // Collect liquidacion IDs for paid liquidaciones within range
    const liquidacionIds = new Set<string>();
    const propertyMap = new Map<string, { label: string }>();
    const revenueMap = new Map<string, number>();

    for (const p of payments) {
      if (p.liquidacion?.status !== 'Pagada') continue;
      const prop = p.liquidacion?.contract?.property;
      const propertyId = p.liquidacion?.contract?.propertyId;
      if (!propertyId) continue;

      liquidacionIds.add(p.liquidacion.id as string);

      if (!propertyMap.has(propertyId)) {
        const parts = [prop?.street, prop?.number, prop?.city].filter(Boolean);
        propertyMap.set(propertyId, {
          label: parts.length > 0 ? parts.join(' ') : (prop?.title ?? propertyId),
        });
      }
      revenueMap.set(propertyId, (revenueMap.get(propertyId) ?? 0) + Number(p.amount));
    }

    // Fetch expense line items for those liquidaciones
    const expenseMap = new Map<string, number>();
    if (liquidacionIds.size > 0) {
      const lineItems = await (this.prisma.client as any).liquidacionLineItem.findMany({
        where: {
          tenantId,
          liquidacionId: { in: Array.from(liquidacionIds) },
          // Outflow types: Ajuste, Extra, Multa (see docblock above)
          type: { in: ['Ajuste', 'Extra', 'Multa'] },
        },
        select: {
          amount: true,
          liquidacion: {
            select: { contract: { select: { propertyId: true } } },
          },
        },
      });

      for (const li of lineItems) {
        const propertyId = li.liquidacion?.contract?.propertyId;
        if (!propertyId) continue;
        expenseMap.set(propertyId, (expenseMap.get(propertyId) ?? 0) + Number(li.amount));
      }
    }

    // Build result set from all seen properties (union of revenue + expense maps)
    const allPropertyIds = new Set([...revenueMap.keys(), ...expenseMap.keys()]);
    const rows: ProfitabilityRow[] = [];

    for (const propertyId of allPropertyIds) {
      const revenue = revenueMap.get(propertyId) ?? 0;
      const expenses = expenseMap.get(propertyId) ?? 0;
      rows.push({
        propertyId,
        label: propertyMap.get(propertyId)?.label ?? propertyId,
        revenue,
        expenses,
        net: revenue - expenses,
      });
    }

    rows.sort((a, b) => b.net - a.net);
    this.cache.set(tenantId, cacheKey, args, rows);
    return rows;
  }

  /**
   * Cash flow aggregated by month or ISO week over a date range.
   *
   * Inflow:  sum of Payment.amount where paidAt falls in the bucket.
   * Outflow: sum of OwnerRendicion.netDeposit where depositedAt falls in the
   *          bucket (disbursements to property owners). The OwnerRendicion model
   *          tracks what was actually deposited to each owner after commission and
   *          fees, making it the best available proxy for cash outflows.
   *          If no rendiciones are deposited in a period, outflow = 0.
   *
   * Returns one row per bucket covering the range, with net = inflow - outflow.
   */
  async getCashFlow(
    tenantId: string,
    range: DateRange,
    granularity: 'month' | 'week' = 'month',
  ): Promise<CashFlowRow[]> {
    const cacheKey = 'getCashFlow';
    const args = [tenantId, range, granularity];
    const cached = this.cache.get<CashFlowRow[]>(tenantId, cacheKey, args);
    if (cached) return cached;

    const [payments, rendiciones] = await Promise.all([
      (this.prisma.client as any).payment.findMany({
        where: {
          tenantId,
          paidAt: { gte: range.from, lte: range.to },
        },
        select: { amount: true, paidAt: true },
      }),
      (this.prisma.client as any).ownerRendicion.findMany({
        where: {
          tenantId,
          depositedAt: { gte: range.from, lte: range.to },
        },
        select: { netDeposit: true, depositedAt: true },
      }),
    ]);

    const inflowByBucket = aggregateIntoBuckets(
      payments.map((p: any) => ({ date: new Date(p.paidAt), amount: Number(p.amount) })),
      granularity,
    );

    const outflowByBucket = aggregateIntoBuckets(
      rendiciones
        .filter((r: any) => r.depositedAt != null)
        .map((r: any) => ({ date: new Date(r.depositedAt), amount: Number(r.netDeposit) })),
      granularity,
    );

    const buckets = buildBuckets(range, granularity);
    const result: CashFlowRow[] = buckets.map((period) => {
      const inflow = inflowByBucket.get(period) ?? 0;
      const outflow = outflowByBucket.get(period) ?? 0;
      return { period, inflow, outflow, net: inflow - outflow };
    });

    this.cache.set(tenantId, cacheKey, args, result);
    return result;
  }

  /**
   * Delinquency rate: ratio of overdue-pending Liquidaciones to total active ones.
   *
   * `current`: Vencida Liquidaciones / (Vencida + Enviada + Aprobada + Borrador + Revision)
   *            as of today.  0 when denominator is 0.
   *
   * `trend`: same ratio computed at the end of each of the last 12 months.
   *          Uses Liquidacion.dueDate as the proxy for "overdue at EoM":
   *            overdue  = status=Vencida AND dueDate <= EoM
   *            active   = status NOT IN (Pagada, Anulada) AND period <= EoM
   *
   * CAVEAT: Like occupancy trend, this uses current Liquidacion status; there
   * is no historical status-change log in this schema. Rows whose status has
   * since been paid will undercount historical delinquency.
   */
  async getDelinquencyRate(tenantId: string): Promise<DelinquencyResult> {
    const cacheKey = 'getDelinquencyRate';
    const args = [tenantId];
    const cached = this.cache.get<DelinquencyResult>(tenantId, cacheKey, args);
    if (cached) return cached;

    const activeStatuses = ['Borrador', 'Revision', 'Aprobada', 'Enviada', 'Vencida'];

    // Current rate
    const [vencidaCount, activeCount] = await Promise.all([
      (this.prisma.client as any).liquidacion.count({
        where: { tenantId, status: 'Vencida' },
      }),
      (this.prisma.client as any).liquidacion.count({
        where: { tenantId, status: { in: activeStatuses } },
      }),
    ]);

    const current = activeCount === 0 ? 0 : Math.round((vencidaCount / activeCount) * 10000) / 100;

    // 12-month trend
    const months = buildMonthRange(12);
    const trend = await Promise.all(
      months.map(async ({ label, eom }) => {
        const [overdue, total] = await Promise.all([
          (this.prisma.client as any).liquidacion.count({
            where: {
              tenantId,
              status: 'Vencida',
              dueDate: { lte: eom },
            },
          }),
          (this.prisma.client as any).liquidacion.count({
            where: {
              tenantId,
              status: { in: activeStatuses },
              period: { lte: eom },
            },
          }),
        ]);
        const pct = total === 0 ? 0 : Math.round((overdue / total) * 10000) / 100;
        return { month: label, pct };
      }),
    );

    const result: DelinquencyResult = { current, trend };
    this.cache.set(tenantId, cacheKey, args, result);
    return result;
  }

  /**
   * Fiscal stats widget — aggregates AFIP emission metrics for the given tenant.
   *
   * All Decimal arithmetic is done with the Decimal library; results are
   * serialised as strings to avoid floating-point coercion.
   *
   * Queries:
   *  - ArcaRequestLog(operation='emit')  → count, error rate, latency, topErrors
   *  - Comprobante                        → per-issuer totals (last 30 days)
   *  - ArcaCertificate                    → cert presence, expiry, env
   *  - ArcaIssuer                         → delegation status counts
   */
  async getFiscalStats(tenantId: string): Promise<FiscalStatsResult> {
    const cacheKey = 'getFiscalStats';
    const args = [tenantId];
    const cached = this.cache.get<FiscalStatsResult>(tenantId, cacheKey, args);
    if (cached) return cached;

    const now = new Date();
    const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ── 1. Emission logs last 30 days ────────────────────────────────────────
    const [emitLogs, issuerRows, cert, issuerCounts] = await Promise.all([
      (this.prisma.baseClient as any).arcaRequestLog.findMany({
        where: {
          tenantId,
          operation: 'emit',
          createdAt: { gte: since30d },
        },
        select: {
          success: true,
          latencyMs: true,
          errorCode: true,
        },
      }),
      // ── 2. Comprobantes per issuer last 30 days ──────────────────────────
      (this.prisma.baseClient as any).comprobante.groupBy({
        by: ['issuerId'],
        where: {
          tenantId,
          status: 'Emitido',
          createdAt: { gte: since30d },
        },
        _count: { _all: true },
        _sum: { impTotal: true },
      }),
      // ── 3. Certificate ───────────────────────────────────────────────────
      (this.prisma.baseClient as any).arcaCertificate.findFirst({
        where: { tenantId },
        select: { notAfter: true, isProduction: true, isActive: true },
      }),
      // ── 4. Issuer delegation status counts ──────────────────────────────
      (this.prisma.baseClient as any).arcaIssuer.groupBy({
        by: ['delegationStatus'],
        where: { tenantId, isActive: true },
        _count: { _all: true },
      }),
    ]);

    // ── Resolve issuer details for byIssuer ─────────────────────────────────
    const issuerIds = (issuerRows as any[])
      .map((r: any) => r.issuerId)
      .filter(Boolean);

    const issuerDetails: any[] =
      issuerIds.length > 0
        ? await (this.prisma.baseClient as any).arcaIssuer.findMany({
            where: { tenantId, id: { in: issuerIds } },
            select: { id: true, cuit: true, businessName: true },
          })
        : [];

    const issuerMap = new Map(issuerDetails.map((i: any) => [i.id, i]));

    const byIssuer = (issuerRows as any[]).map((row: any) => {
      const info = issuerMap.get(row.issuerId) ?? { cuit: '', businessName: '' };
      // Keep as Decimal → stringify; never coerce to Number
      const totalAmount = new Decimal(row._sum?.impTotal?.toString() ?? '0');
      return {
        issuerId: row.issuerId as string,
        cuit: info.cuit as string,
        businessName: info.businessName as string,
        count: row._count._all as number,
        totalAmount: totalAmount.toFixed(2),
      };
    });

    // ── Aggregate emit log metrics ───────────────────────────────────────────
    const totalEmissions = (emitLogs as any[]).length;
    const failedEmissions = (emitLogs as any[]).filter((l: any) => !l.success).length;
    const errorRate =
      totalEmissions > 0
        ? new Decimal(failedEmissions)
            .div(totalEmissions)
            .mul(100)
            .toFixed(2)
        : '0.00';

    // Average latency (only successful emit calls)
    const successfulLogs = (emitLogs as any[]).filter((l: any) => l.success);
    const avgCaeLatencyMs =
      successfulLogs.length > 0
        ? Math.round(
            successfulLogs.reduce((sum: number, l: any) => sum + (l.latencyMs ?? 0), 0) /
              successfulLogs.length,
          )
        : 0;

    // Top errors by errorCode
    const errorCodeMap = new Map<string, number>();
    for (const log of emitLogs as any[]) {
      if (!log.success && log.errorCode) {
        errorCodeMap.set(log.errorCode, (errorCodeMap.get(log.errorCode) ?? 0) + 1);
      }
    }
    const topErrors = Array.from(errorCodeMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([errorCode, count]) => ({ errorCode, count }));

    // ── Certificate summary ──────────────────────────────────────────────────
    let certificate: FiscalStatsResult['certificate'];
    if (!cert) {
      certificate = { exists: false };
    } else {
      const daysToExpiry = Math.ceil(
        (new Date(cert.notAfter).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      certificate = {
        exists: true,
        daysToExpiry,
        isProduction: cert.isProduction as boolean,
      };
    }

    // ── Issuer delegation counts ─────────────────────────────────────────────
    const statusCount = (status: string) =>
      ((issuerCounts as any[]).find((r: any) => r.delegationStatus === status)?._count._all) ?? 0;

    const issuers = {
      active: statusCount('Active'),
      pending: statusCount('Pending'),
      revoked: statusCount('Revoked'),
    };

    const result: FiscalStatsResult = {
      emissionsLast30d: {
        count: totalEmissions,
        byIssuer,
      },
      errorsLast30d: {
        count: failedEmissions,
        rate: errorRate,
        topErrors,
      },
      avgCaeLatencyMs,
      certificate,
      issuers,
    };

    this.cache.set(tenantId, cacheKey, args, result);
    return result;
  }
}
