import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';

const MONTHS_ES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

const PENDING_STATUSES = ['Aprobada', 'Enviada', 'Pendiente'];

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
  constructor(private readonly prisma: PrismaService) {}

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
            where: { id: { in: issuerIds } },
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

    return {
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
  }
}
