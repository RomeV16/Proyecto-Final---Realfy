import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  OwnerStatementFilterSchema,
  PropertyProfitabilityFilterSchema,
  CommissionSummaryFilterSchema,
  PipelineAnalyticsFilterSchema,
  MorosidadFilterSchema,
  LiquidacionStatus,
  LeadStatus,
  PersonRole,
} from '@realfy/shared';
import Decimal from 'decimal.js';

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

/**
 * Checks if an error is a Zod validation error (K006 pattern — no direct zod import).
 */
function isZodError(err: unknown): err is { errors: any[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as any).name === 'ZodError' &&
    'errors' in err
  );
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
    let filters: any;
    try {
      filters = OwnerStatementFilterSchema.parse(query);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid owner statement filters',
          details: err.errors,
        });
      }
      throw err;
    }

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
        }),
        propiedad:
          r.contract?.property?.title ??
          r.contract?.property?.street ??
          '—',
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
      title: 'Estado de Cuenta del Propietario',
      columns: ['Período', 'Propiedad', 'Cobrado', 'Comisión', 'Honorarios', 'Deducciones', 'Depósito Neto'],
      rows,
      summary,
      generatedAt: new Date().toISOString(),
      filters,
    };
  }

  // ─── Property Profitability ───────────────────────────

  async getPropertyProfitability(query: unknown): Promise<ReportResult<PropertyProfitabilityRow>> {
    let filters: any;
    try {
      filters = PropertyProfitabilityFilterSchema.parse(query);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid property profitability filters',
          details: err.errors,
        });
      }
      throw err;
    }

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
        title: property.title ?? property.street ?? '—',
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
      title: 'Rentabilidad por Propiedad',
      columns: ['Propiedad', 'Cobrado', 'Facturado', 'Comisiones', 'Ingreso Neto'],
      rows,
      summary,
      generatedAt: new Date().toISOString(),
      filters,
    };
  }

  // ─── Commission Summary ───────────────────────────────

  async getCommissionSummary(query: unknown): Promise<ReportResult<CommissionSummaryRow>> {
    let filters: any;
    try {
      filters = CommissionSummaryFilterSchema.parse(query);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid commission summary filters',
          details: err.errors,
        });
      }
      throw err;
    }

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
        propiedad:
          r.contract?.property?.title ??
          r.contract?.property?.street ??
          '—',
        propietario: r.owner
          ? `${r.owner.firstName} ${r.owner.lastName}`
          : '—',
        periodo: new Date(r.period).toLocaleDateString('es-AR', {
          month: '2-digit',
          year: 'numeric',
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
      title: 'Resumen de Comisiones',
      columns: ['Propiedad', 'Propietario', 'Período', 'Tipo Comisión', 'Comisión', 'Honorarios', 'Total'],
      rows,
      summary,
      generatedAt: new Date().toISOString(),
      filters,
    };
  }

  // ─── Pipeline Analytics ───────────────────────────────

  async getPipelineAnalytics(query: unknown): Promise<ReportResult<PipelineAnalyticsRow>> {
    let filters: any;
    try {
      filters = PipelineAnalyticsFilterSchema.parse(query);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid pipeline analytics filters',
          details: err.errors,
        });
      }
      throw err;
    }

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
      title: 'Analítica de Pipeline',
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
    let filters: any;
    try {
      filters = MorosidadFilterSchema.parse(query);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid morosidad filters',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;
    const now = new Date();

    const where: any = {
      contract: { tenantId },
      status: { in: [LiquidacionStatus.Enviada, LiquidacionStatus.Vencida] },
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

    const liquidaciones = await this.prisma.client.liquidacion.findMany({
      where,
      include: {
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

    let totalVencido = new Decimal(0);
    const rows: MorosidadRow[] = liquidaciones.map((liq: any) => {
      const diasVencidos = Math.floor(
        (now.getTime() - new Date(liq.dueDate).getTime()) / 86400000,
      );
      const monto = new Decimal(liq.total.toString());
      totalVencido = totalVencido.plus(monto);

      const inquilino =
        liq.contract?.persons?.[0]?.person
          ? `${liq.contract.persons[0].person.firstName} ${liq.contract.persons[0].person.lastName}`
          : '—';

      return {
        propiedad:
          liq.contract?.property?.title ??
          liq.contract?.property?.street ??
          '—',
        inquilino,
        periodo: new Date(liq.period).toLocaleDateString('es-AR', {
          month: '2-digit',
          year: 'numeric',
        }),
        vencimiento: new Date(liq.dueDate).toLocaleDateString('es-AR'),
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
      title: 'Reporte de Morosidad',
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
