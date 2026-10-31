import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getParty } from '../contracts/contract-parties';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  OwnerStatementFilterSchema,
  PropertyProfitabilityFilterSchema,
  CashFlowFilterSchema,
  CommissionSummaryFilterSchema,
  PipelineAnalyticsFilterSchema,
  MorosidadFilterSchema,
  RendicionStatus,
  OVERDUE_STATUSES,
  LiquidacionStatus,
  LeadStatus,
  PersonRole,
  formatDateAR,
  monthStartUTC,
  periodKey,
  todayInAR,
  personName,
  propertyLabel,
} from '@realfy/shared';
import Decimal from 'decimal.js';
import { REPORT_REGISTRY } from './report-registry';
import { outstandingBalance } from '../liquidaciones/receivables';
import { parseOrThrow } from '../../common/validation/zod';

// ─── Row types for each report ──────────────────────────

export interface OwnerStatementRow {
  periodo: string;
  propiedad: string;
  cobrado: string;
  comision: string;
  honorarios: string;
  deducciones: string;
  depositoNeto: string;
}

export interface PropertyProfitabilityRow {
  propiedad: string;
  cobrado: string;
  facturado: string;
  comisiones: string;
  ingresoNeto: string;
}

export interface CashFlowRow {
  mes: string;
  ingresos: string;
  egresos: string;
  facturado: string;
  saldoNeto: string;
}

export interface CommissionSummaryRow {
  propiedad: string;
  propietario: string;
  periodo: string;
  tipoComision: string;
  comision: string;
  honorarios: string;
  total: string;
}

export interface PipelineAnalyticsRow {
  etapa: string;
  leadsActuales: string;
  convertidos: string;
  perdidos: string;
  tasaConversion: string;
  promedioConversionDias: string;
}

export interface MorosidadRow {
  propiedad: string;
  inquilino: string;
  periodo: string;
  vencimiento: string;
  diasVencidos: string;
  monto: string;
  moneda: string;
}

export interface ReportResult<T> {
  type: string;
  title: string;
  columns: string[];
  rows: T[];
  summary?: Record<string, string>;
  generatedAt: string;
  filters: Record<string, any>;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── Owner Statement ──────────────────────────────────

  async getOwnerStatement(query: unknown): Promise<ReportResult<OwnerStatementRow>> {
    const filters: any = parseOrThrow(OwnerStatementFilterSchema, query, 'Invalid owner statement filters');

    const tenantId = this.tenantContext.getTenantId()!;
    const where: any = { tenantId, ownerId: filters.ownerId };

    if (filters.from || filters.to) {
      where.period = {};
      if (filters.from) where.period.gte = new Date(filters.from);
      if (filters.to) where.period.lte = new Date(filters.to);
    }

    const rendiciones = await this.prisma.client.ownerRendicion.findMany({
      where,
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        contract: { include: { property: true } },
      },
      orderBy: { period: 'asc' },
    });

    const rows: OwnerStatementRow[] = rendiciones.map((r: any) => {
      const rentCollected = new Decimal(r.rentCollected.toString());
      const commissionAmount = new Decimal(r.commissionAmount.toString());
      const adminFeeAmount = new Decimal(r.adminFeeAmount.toString());
      const deductionTotal = new Decimal(r.deductionTotal.toString());
      const netDeposit = new Decimal(r.netDeposit.toString());

      return {
        periodo: new Date(r.period).toLocaleDateString('es-AR', {
          month: '2-digit',
          year: 'numeric',
          timeZone: 'UTC',
        }),
        propiedad: propertyLabel(r.contract?.property) || '—',
        cobrado: rentCollected.toFixed(2),
        comision: commissionAmount.toFixed(2),
        honorarios: adminFeeAmount.toFixed(2),
        deducciones: deductionTotal.toFixed(2),
        depositoNeto: netDeposit.toFixed(2),
      };
    });

    // Summary row
    const summary = rows.reduce(
      (acc, row) => ({
        cobrado: new Decimal(acc.cobrado).plus(row.cobrado).toFixed(2),
        comision: new Decimal(acc.comision).plus(row.comision).toFixed(2),
        honorarios: new Decimal(acc.honorarios).plus(row.honorarios).toFixed(2),
        deducciones: new Decimal(acc.deducciones).plus(row.deducciones).toFixed(2),
        depositoNeto: new Decimal(acc.depositoNeto).plus(row.depositoNeto).toFixed(2),
      }),
      { cobrado: '0', comision: '0', honorarios: '0', deducciones: '0', depositoNeto: '0' },
    );

    this.logger.log('Report generated', {
      tenantId,
      reportType: 'ownerStatement',
      dateRange: { from: filters.from, to: filters.to },
      rowCount: rows.length,
    });

    return {
      type: 'ownerStatement',
      title: REPORT_REGISTRY.ownerStatement.title,
      columns: ['Período', 'Propiedad', 'Cobrado', 'Comisión', 'Honorarios', 'Deducciones', 'Depósito Neto'],
      rows,
      summary,
      generatedAt: new Date().toISOString(),
      filters,
    };
  }

  // ─── Property Profitability ───────────────────────────

  async getPropertyProfitability(query: unknown): Promise<ReportResult<PropertyProfitabilityRow>> {
    const filters: any = parseOrThrow(PropertyProfitabilityFilterSchema, query, 'Invalid property profitability filters');

    const tenantId = this.tenantContext.getTenantId()!;

    // Build date filter for payments
    const paymentWhere: any = {
      liquidacion: {
        contract: { tenantId },
        status: LiquidacionStatus.Pagada,
      },
    };

    if (filters.from || filters.to) {
      paymentWhere.paidAt = {};
      if (filters.from) paymentWhere.paidAt.gte = new Date(filters.from);
      if (filters.to) paymentWhere.paidAt.lte = new Date(filters.to);
    }

    if (filters.propertyId) {
      paymentWhere.liquidacion.contract.propertyId = filters.propertyId;
    }

    const payments = await this.prisma.client.payment.findMany({
      where: paymentWhere,
      include: {
        liquidacion: {
          include: {
            contract: {
              include: {
                property: true,
                commission: true,
              },
            },
          },
        },
        comprobantes: true,
      },
    });

    // Aggregate by property
    const propertyMap = new Map<string, {
      title: string;
      cobrado: Decimal;
      facturado: Decimal;
      comisiones: Decimal;
    }>();

    for (const payment of payments) {
      const property = payment.liquidacion?.contract?.property;
      if (!property) continue;

      const existing = propertyMap.get(property.id) ?? {
        title: propertyLabel(property) || '—',
        cobrado: new Decimal(0),
        facturado: new Decimal(0),
        comisiones: new Decimal(0),
      };

      existing.cobrado = existing.cobrado.plus(payment.amount.toString());

      // Sum invoiced amounts from comprobantes
      for (const comp of payment.comprobantes ?? []) {
        existing.facturado = existing.facturado.plus(comp.impTotal.toString());
      }

      // Commission amounts from contract commission config
      const commission = payment.liquidacion?.contract?.commission;
      if (commission) {
        const paymentAmt = new Decimal(payment.amount.toString());
        if (commission.percentage) {
          existing.comisiones = existing.comisiones.plus(
            paymentAmt.times(commission.percentage.toString()).dividedBy(100).toDecimalPlaces(2),
          );
        } else if (commission.fixedAmount) {
          existing.comisiones = existing.comisiones.plus(commission.fixedAmount.toString());
        }
      }

      propertyMap.set(property.id, existing);
    }

    const rows: PropertyProfitabilityRow[] = Array.from(propertyMap.values()).map((p: any) => ({
      propiedad: p.title,
      cobrado: p.cobrado.toFixed(2),
      facturado: p.facturado.toFixed(2),
      comisiones: p.comisiones.toFixed(2),
      ingresoNeto: p.cobrado.minus(p.comisiones).toFixed(2),
    }));

    const summary = rows.reduce(
      (acc, row) => ({
        cobrado: new Decimal(acc.cobrado).plus(row.cobrado).toFixed(2),
        facturado: new Decimal(acc.facturado).plus(row.facturado).toFixed(2),
        comisiones: new Decimal(acc.comisiones).plus(row.comisiones).toFixed(2),
        ingresoNeto: new Decimal(acc.ingresoNeto).plus(row.ingresoNeto).toFixed(2),
      }),
      { cobrado: '0', facturado: '0', comisiones: '0', ingresoNeto: '0' },
    );

    this.logger.log('Report generated', {
      tenantId,
      reportType: 'propertyProfitability',
      dateRange: { from: filters.from, to: filters.to },
      rowCount: rows.length,
    });

    return {
      type: 'propertyProfitability',
      title: REPORT_REGISTRY.propertyProfitability.title,
      columns: ['Propiedad', 'Cobrado', 'Facturado', 'Comisiones', 'Ingreso Neto'],
      rows,
      summary,
      generatedAt: new Date().toISOString(),
      filters,
    };
  }

  // ─── Monthly Cash Flow ────────────────────────────────

  async getCashFlow(query: unknown): Promise<ReportResult<CashFlowRow>> {
    const filters: any = parseOrThrow(CashFlowFilterSchema, query, 'Invalid cash flow filters');

    const tenantId = this.tenantContext.getTenantId()!;

    // Default to current year if no dates specified
    const currentYear = todayInAR().getUTCFullYear();
    const fromDate = filters.from
      ? new Date(filters.from)
      : new Date(Date.UTC(currentYear, 0, 1));
    const toDate = filters.to
      ? new Date(filters.to)
      : new Date(Date.UTC(currentYear, 11, 31));

    // Inflow: Payments within date range
    const payments = await this.prisma.client.payment.findMany({
      where: {
        liquidacion: { contract: { tenantId } },
        paidAt: { gte: fromDate, lte: toDate },
      },
      include: {
        comprobantes: true,
      },
    });

    // Outflow: OwnerRendicion with status=Depositada
    const rendiciones = await this.prisma.client.ownerRendicion.findMany({
      where: {
        tenantId,
        status: RendicionStatus.Depositada,
        depositedAt: { gte: fromDate, lte: toDate },
      },
    });

    // Aggregate by month
    const monthMap = new Map<string, {
      ingresos: Decimal;
      egresos: Decimal;
      facturado: Decimal;
    }>();

    // Initialize months in range
    const startMonth = monthStartUTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth() + 1);
    const endMonth = monthStartUTC(toDate.getUTCFullYear(), toDate.getUTCMonth() + 1);
    const current = new Date(startMonth);
    while (current <= endMonth) {
      monthMap.set(periodKey(current), { ingresos: new Decimal(0), egresos: new Decimal(0), facturado: new Decimal(0) });
      current.setUTCMonth(current.getUTCMonth() + 1);
    }

    // Inflow by month
    for (const payment of payments) {
      const paidAt = new Date(payment.paidAt);
      const key = periodKey(paidAt);
      const entry = monthMap.get(key);
      if (entry) {
        entry.ingresos = entry.ingresos.plus(payment.amount.toString());
        for (const comp of payment.comprobantes ?? []) {
          entry.facturado = entry.facturado.plus(comp.impTotal.toString());
        }
      }
    }

    // Outflow by month
    for (const rend of rendiciones) {
      const depositedAt = rend.depositedAt ? new Date(rend.depositedAt) : new Date(rend.period);
      const key = periodKey(depositedAt);
      const entry = monthMap.get(key);
      if (entry) {
        entry.egresos = entry.egresos.plus(rend.netDeposit.toString());
      }
    }

    const rows: CashFlowRow[] = Array.from(monthMap.entries())
      .sort(([a]: any, [b]: any) => a.localeCompare(b))
      .map(([key, data]) => {
        const [year, month] = key.split('-');
        const date = monthStartUTC(Number(year), Number(month));
        const label = date.toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        return {
          mes: label,
          ingresos: data.ingresos.toFixed(2),
          egresos: data.egresos.toFixed(2),
          facturado: data.facturado.toFixed(2),
          saldoNeto: data.ingresos.minus(data.egresos).toFixed(2),
        };
      });

    const summary = rows.reduce(
      (acc, row) => ({
        ingresos: new Decimal(acc.ingresos).plus(row.ingresos).toFixed(2),
        egresos: new Decimal(acc.egresos).plus(row.egresos).toFixed(2),
        facturado: new Decimal(acc.facturado).plus(row.facturado).toFixed(2),
        saldoNeto: new Decimal(acc.saldoNeto).plus(row.saldoNeto).toFixed(2),
      }),
      { ingresos: '0', egresos: '0', facturado: '0', saldoNeto: '0' },
    );

    this.logger.log('Report generated', {
      tenantId,
      reportType: 'cashFlow',
      dateRange: { from: filters.from ?? fromDate.toISOString(), to: filters.to ?? toDate.toISOString() },
      rowCount: rows.length,
    });

    return {
      type: 'cashFlow',
      title: REPORT_REGISTRY.cashFlow.title,
      columns: ['Mes', 'Ingresos', 'Egresos', 'Facturado', 'Saldo Neto'],
      rows,
      summary,
      generatedAt: new Date().toISOString(),
      filters,
    };
  }

  // ─── Commission Summary ───────────────────────────────

  async getCommissionSummary(query: unknown): Promise<ReportResult<CommissionSummaryRow>> {
    const filters: any = parseOrThrow(CommissionSummaryFilterSchema, query, 'Invalid commission summary filters');

    const tenantId = this.tenantContext.getTenantId()!;
    const where: any = { tenantId };

    if (filters.from || filters.to) {
      where.period = {};
      if (filters.from) where.period.gte = new Date(filters.from);
      if (filters.to) where.period.lte = new Date(filters.to);
    }

    if (filters.contractId) {
      where.contractId = filters.contractId;
    }

    const rendiciones = await this.prisma.client.ownerRendicion.findMany({
      where,
      include: {
        contract: {
          include: {
            property: true,
            commission: true,
          },
        },
        owner: true,
      },
      orderBy: { period: 'asc' },
    });

    const rows: CommissionSummaryRow[] = rendiciones.map((r: any) => {
      const commissionAmount = new Decimal(r.commissionAmount.toString());
      const adminFeeAmount = new Decimal(r.adminFeeAmount.toString());
      const total = commissionAmount.plus(adminFeeAmount);

      return {
        propiedad: propertyLabel(r.contract?.property) || '—',
        propietario: personName(r.owner) || '—',
        periodo: new Date(r.period).toLocaleDateString('es-AR', {
          month: '2-digit',
          year: 'numeric',
          timeZone: 'UTC',
        }),
        tipoComision: r.contract?.commission?.type ?? '—',
        comision: commissionAmount.toFixed(2),
        honorarios: adminFeeAmount.toFixed(2),
        total: total.toFixed(2),
      };
    });

    const summary = rows.reduce(
      (acc, row) => ({
        comision: new Decimal(acc.comision).plus(row.comision).toFixed(2),
        honorarios: new Decimal(acc.honorarios).plus(row.honorarios).toFixed(2),
        total: new Decimal(acc.total).plus(row.total).toFixed(2),
      }),
      { comision: '0', honorarios: '0', total: '0' },
    );

    this.logger.log('Report generated', {
      tenantId,
      reportType: 'commissionSummary',
      dateRange: { from: filters.from, to: filters.to },
      rowCount: rows.length,
    });

    return {
      type: 'commissionSummary',
      title: REPORT_REGISTRY.commissionSummary.title,
      columns: ['Propiedad', 'Propietario', 'Período', 'Tipo Comisión', 'Comisión', 'Honorarios', 'Total'],
      rows,
      summary,
      generatedAt: new Date().toISOString(),
      filters,
    };
  }

  // ─── Pipeline Analytics ───────────────────────────────

  async getPipelineAnalytics(query: unknown): Promise<ReportResult<PipelineAnalyticsRow>> {
    const filters: any = parseOrThrow(PipelineAnalyticsFilterSchema, query, 'Invalid pipeline analytics filters');

    const tenantId = this.tenantContext.getTenantId()!;

    // Find pipelines for this tenant, optionally filtered
    const pipelineWhere: any = { tenantId };
    if (filters.pipelineId) pipelineWhere.id = filters.pipelineId;

    const pipelines = await this.prisma.client.pipeline.findMany({
      where: pipelineWhere,
      include: {
        stages: {
          orderBy: { sortOrder: 'asc' },
          include: {
            leads: {
              where: {
                tenantId,
                ...(filters.from || filters.to
                  ? {
                      createdAt: {
                        ...(filters.from ? { gte: new Date(filters.from) } : {}),
                        ...(filters.to ? { lte: new Date(filters.to) } : {}),
                      },
                    }
                  : {}),
              },
            },
          },
        },
      },
    });

    let totalLeads = 0;
    let totalConvertidos = 0;
    const rows: PipelineAnalyticsRow[] = [];

    for (const pipeline of pipelines) {
      for (const stage of pipeline.stages) {
        const leads = stage.leads;
        const leadsActuales = leads.length;
        const convertidos = leads.filter(
          (l: any) => l.status === LeadStatus.Convertido,
        ).length;
        const perdidos = leads.filter(
          (l: any) => l.status === LeadStatus.Perdido,
        ).length;

        // Average days to convert for converted leads in this stage
        const convertedLeads = leads.filter(
          (l: any) => l.status === LeadStatus.Convertido && l.convertedAt,
        );
        const avgDays =
          convertedLeads.length > 0
            ? Math.round(
                convertedLeads.reduce((sum: any, l: any) => {
                  const diff =
                    new Date(l.convertedAt!).getTime() -
                    new Date(l.createdAt).getTime();
                  return sum + diff / 86400000;
                }, 0) / convertedLeads.length,
              )
            : 0;

        const tasaConversion =
          leadsActuales > 0
            ? ((convertidos / leadsActuales) * 100).toFixed(1)
            : '0.0';

        totalLeads += leadsActuales;
        totalConvertidos += convertidos;

        rows.push({
          etapa: `${pipeline.name} — ${stage.name}`,
          leadsActuales: String(leadsActuales),
          convertidos: String(convertidos),
          perdidos: String(perdidos),
          tasaConversion: `${tasaConversion}%`,
          promedioConversionDias: String(avgDays),
        });
      }
    }

    const tasaConversionGeneral =
      totalLeads > 0
        ? ((totalConvertidos / totalLeads) * 100).toFixed(1)
        : '0.0';

    const summary: Record<string, string> = {
      totalLeads: String(totalLeads),
      totalConvertidos: String(totalConvertidos),
      tasaConversionGeneral: `${tasaConversionGeneral}%`,
    };

    this.logger.log('Report generated', {
      tenantId,
      reportType: 'pipelineAnalytics',
      rowCount: rows.length,
    });

    return {
      type: 'pipelineAnalytics',
      title: REPORT_REGISTRY.pipelineAnalytics.title,
      columns: [
        'Etapa',
        'Leads Actuales',
        'Convertidos',
        'Perdidos',
        'Tasa Conversión',
        'Promedio Conversión (días)',
      ],
      rows,
      summary,
      generatedAt: new Date().toISOString(),
      filters,
    };
  }

  // ─── Morosidad ────────────────────────────────────────

  async getMorosidad(query: unknown): Promise<ReportResult<MorosidadRow>> {
    const filters: any = parseOrThrow(MorosidadFilterSchema, query, 'Invalid morosidad filters');

    const tenantId = this.tenantContext.getTenantId()!;
    const now = new Date();

    const where: any = {
      contract: { tenantId },
      status: { in: [...OVERDUE_STATUSES] },
      dueDate: { lt: now },
    };

    if (filters.from || filters.to) {
      where.dueDate = {
        ...where.dueDate,
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
      };
      if (filters.to) {
        where.dueDate.lte = new Date(filters.to);
      }
    }

    if (filters.propertyId) {
      where.contract.propertyId = filters.propertyId;
    }
    if (filters.contractId) {
      where.contractId = filters.contractId;
    }

    const withPayments = await this.prisma.client.liquidacion.findMany({
      where,
      include: {
        payments: { select: { amount: true } },
        contract: {
          include: {
            property: true,
            persons: {
              where: { role: PersonRole.Inquilino },
              include: { person: true },
            },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });
    // La deuda es el saldo pendiente; una liquidación saldada no es morosa.
    const liquidaciones = withPayments.filter((liq: any) => outstandingBalance(liq).gt(0));

    let totalVencido = new Decimal(0);
    const rows: MorosidadRow[] = liquidaciones.map((liq: any) => {
      const diasVencidos = Math.floor(
        (now.getTime() - new Date(liq.dueDate).getTime()) / 86400000,
      );
      const monto = new Decimal(outstandingBalance(liq).toString());
      totalVencido = totalVencido.plus(monto);

      const inquilinoPerson = liq.contract ? getParty<any>(liq.contract, 'Inquilino')?.person : undefined;
      const inquilino = personName(inquilinoPerson) || '—';

      return {
        propiedad:
          liq.contract?.property?.title ??
          liq.contract?.property?.street ??
          '—',
        inquilino,
        periodo: new Date(liq.period).toLocaleDateString('es-AR', {
          month: '2-digit',
          year: 'numeric',
          timeZone: 'UTC',
        }),
        vencimiento: formatDateAR(liq.dueDate),
        diasVencidos: String(diasVencidos),
        monto: monto.toFixed(2),
        moneda: liq.currency,
      };
    });

    const summary: Record<string, string> = {
      totalVencido: totalVencido.toFixed(2),
      cantidadVencidas: String(rows.length),
    };

    this.logger.log('Report generated', {
      tenantId,
      reportType: 'morosidad',
      rowCount: rows.length,
    });

    return {
      type: 'morosidad',
      title: REPORT_REGISTRY.morosidad.title,
      columns: [
        'Propiedad',
        'Inquilino',
        'Período',
        'Vencimiento',
        'Días Vencidos',
        'Monto',
        'Moneda',
      ],
      rows,
      summary,
      generatedAt: new Date().toISOString(),
      filters,
    };
  }
}
