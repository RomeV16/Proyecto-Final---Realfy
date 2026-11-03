import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { getParty, lessorsDateFor } from '../contracts/contract-parties';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  GenerateLiquidacionesSchema,
  CreateLiquidacionLineItemSchema,
  UpdateLiquidacionLineItemSchema,
  TransitionLiquidacionSchema,
  CreatePaymentSchema,
  LiquidacionFilterSchema,
  LiquidacionStatus,
  LineItemType,
  ContractStatus,
  validateLiquidacionTransition,
  liquidacionMachine,
  calculateLineItemsTotal,
  calculateRemainingBalance,
  isFullyPaid,
  monthStartUTC,
  periodFilter,
  todayInAR,
  InvalidLineAmountError,
  buildLiquidation,
  FirstDueMode,
  defaultBeneficiary,
  defaultCommissionable,
  isLessorActiveAt,
  personName,
  formatReceiptNumber,
  addMonthsClamped,
  amountInWords,
  periodKey,
  onBehalfOfText,
  formatDateAR,
  MessageChannel,
} from '@realfy/shared';
import type { LineItemInput, OperationalDefaults, PaymentInput } from '@realfy/shared';
import { PdfService } from './pdf.service';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { AuditService } from '../../common/audit/audit.service';
import { ContractAdjustmentService } from '../index-data/contract-adjustment.service';
import type { AdjustmentApplied, AdjustmentSkipped } from '../index-data/contract-adjustment.service';
import { pickTermsAt, resolveRule } from '../contracts/contract-terms';
import { rentAtDate, rentChangeInMonth } from './rent-at';
import { scheduledPeriod } from './generation-window';
import { OutboxService } from '../../common/messaging/outbox.service';
import { liquidacionMessageVars } from './liquidacion-message';
import { ServiceBillsService } from '../services/service-bills.service';
import { PenaltiesService, parseDay } from '../penalties/penalties.service';
import type { PenaltyContext } from '../penalties/penalties.service';
import { ChargesService } from '../charges/charges.service';
import { PaymentSettlementService } from '../cash/payment-settlement.service';
import { withReceiptLabel } from '../cash/receipts.service';
import Decimal from 'decimal.js';
import { nextDocumentNumber } from '../../common/document-sequence/document-sequence';
import { assertTransition } from '../../common/errors/assert-transition';
import { parseOrThrow } from '../../common/validation/zod';

/** Lo que acompaña a cada cobro: cuenta, recibo y compensaciones (ADR-0012). */
const PAYMENT_INCLUDE = {
  account: { select: { id: true, name: true, kind: true, currency: true } },
  receipt: { select: { id: true, series: true, number: true } },
  compensations: { select: { id: true, fromLessorId: true, toLessorId: true, amount: true } },
} as const;

/** Serie de numeración de los recibos de liquidación (una por inmobiliaria). */
const RECEIPT_SERIES = 'RECIBO_LIQUIDACION';

export interface GenerationResult {
  contractId: string;
  /** `not_billed`: el primer mes no se liquida por la convención pactada (AlFirmar o VencimientoMesSiguiente). */
  status: 'created' | 'skipped' | 'out_of_range' | 'not_billed' | 'failed';
  reason?: string;
  liquidacionId?: string;
}

export interface GenerationSummary {
  created: number;
  skipped: number;
  /** Contratos que no rigen en el mes (antes del inicio o después del fin). */
  outOfRange: number;
  /** Primeros meses que no se liquidan por la convención del contrato (se cobran al firmar o con el mes siguiente). */
  notBilled: number;
  failed: number;
  total: number;
  results: GenerationResult[];
  /**
   * Ajustes que vencen hasta el fin del mes, aplicados antes de liquidarlo
   * (`applied`), y los que quedaron pendientes, con el motivo y los meses de
   * índice que faltan (`pending`).
   */
  adjustments: { applied: AdjustmentApplied[]; pending: AdjustmentSkipped[] };
}

@Injectable()
export class LiquidacionesService {
  private readonly logger = new Logger(LiquidacionesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly pdfService: PdfService,
    private readonly outbox: OutboxService,
    private readonly operationalDefaults: OperationalDefaultsService,
    private readonly audit: AuditService,
    private readonly adjustments: ContractAdjustmentService,
    private readonly serviceBills: ServiceBillsService,
    private readonly penalties: PenaltiesService,
    private readonly charges: ChargesService,
    private readonly paymentCash: PaymentSettlementService,
  ) {}

  // ─── Auto-Generation ────────────────────────────────

  /** POST /liquidaciones/generate: el mes lo elige quien lo pide. */
  async generate(data: unknown) {
    const validated: { month: number; year: number } = parseOrThrow(GenerateLiquidacionesSchema, data, 'Invalid generation parameters');
    return this.generateForPeriod(validated.year, validated.month);
  }

  /**
   * Genera las liquidaciones de un mes para la inmobiliaria del contexto.
   * Idempotente por contrato y período. Cada contrato se liquida con las
   * reglas y el alquiler vigentes en ese mes (no con los de hoy), respetando
   * su inicio, su fin efectivo y su día de vencimiento; ver `buildLiquidation`.
   */
  async generateForPeriod(year: number, month: number): Promise<GenerationSummary> {
    const tenantId = this.tenantContext.getTenantId()!;

    // Período: primer día del mes, a medianoche UTC.
    const period = monthStartUTC(year, month);
    const monthEnd = new Date(Date.UTC(year, month, 0));

    const defaults = await this.operationalDefaults.get(tenantId);

    // El alquiler del mes incluye los ajustes que vencen dentro de él (DEF-130): la
    // inmobiliaria liquida alrededor del 20 del mes anterior con el ajuste que rige
    // desde el 1, cuyo índice (con el rezago del contrato) ya está publicado. Se
    // aplican antes de leer los contratos, cada uno en su transacción; los que no
    // tienen índice siguen pendientes y se informan (ADR-0011).
    const lastInstant = new Date(Date.UTC(year, month, 1) - 1);
    const adjustmentRun = await this.adjustments.applyDueAdjustments(tenantId, lastInstant, 'generation');

    // Contratos que pueden regir en el mes. El generador decide cada caso (un
    // contrato que ya no está Activo solo liquida hasta su fin real).
    const contracts = await this.prisma.client.contract.findMany({
      where: {
        isActive: true,
        status: { not: ContractStatus.Borrador },
        startDate: { lte: monthEnd },
        OR: [{ status: ContractStatus.Activo }, { actualEndDate: { gte: period } }],
      },
      include: {
        property: true,
        lessors: { include: { person: true } },
        termsVersions: { orderBy: { validFrom: 'asc' } },
        adjustments: { where: { appliedAt: { not: null } }, orderBy: { adjustmentDate: 'asc' } },
      },
    });

    const results: GenerationResult[] = [];

    for (const contract of contracts) {
      try {
        results.push(await this.generateForContract(tenantId, contract, period, defaults));
      } catch (error) {
        results.push({
          contractId: contract.id,
          status: 'failed',
          reason: (error as Error).message,
        });
        this.logger.error('Liquidación generation failed for contract', {
          tenantId,
          contractId: contract.id,
          error: (error as Error).message,
        });
      }
    }

    const created = results.filter((r) => r.status === 'created').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const outOfRange = results.filter((r) => r.status === 'out_of_range').length;
    const notBilled = results.filter((r) => r.status === 'not_billed').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    this.logger.log('Liquidaciones generated', {
      tenantId,
      month,
      year,
      contractsFound: contracts.length,
      created,
      skipped,
      outOfRange,
      notBilled,
      failed,
      adjustmentsApplied: adjustmentRun.applied.length,
      adjustmentsPending: adjustmentRun.skipped.length,
    });

    return {
      created,
      skipped,
      outOfRange,
      notBilled,
      failed,
      total: contracts.length,
      results,
      adjustments: { applied: adjustmentRun.applied, pending: adjustmentRun.skipped },
    };
  }

  private async generateForContract(
    tenantId: string,
    contract: any,
    period: Date,
    defaults: OperationalDefaults,
  ): Promise<GenerationResult> {
    const existing = await this.prisma.client.liquidacion.findFirst({
      where: { contractId: contract.id, period },
    });
    if (existing) {
      return { contractId: contract.id, status: 'skipped', reason: 'EXISTS', liquidacionId: existing.id };
    }

    // Las reglas de ese mes: las del primer día del contrato si el mes es el de inicio.
    const startDate: Date = contract.startDate;
    const rulesDate = startDate.getTime() > period.getTime() ? startDate : period;
    const terms = pickTermsAt<any>(contract.termsVersions ?? [], rulesDate);
    const dueDay = resolveRule(defaults, terms, 'dueDay') as number;

    // Convenciones pactadas (versión vigente en el mes) o, si no hay, las de la inmobiliaria.
    const conventions = {
      prorationMode: resolveRule(defaults, terms, 'prorationMode') as any,
      midMonthAdjustmentMode: resolveRule(defaults, terms, 'midMonthAdjustmentMode') as any,
      firstDueMode: resolveRule(defaults, terms, 'firstDueMode') as any,
      fixedDiscountProration: resolveRule(defaults, terms, 'fixedDiscountProration') as any,
    };

    const rentSource = {
      contractRent: contract.rentAmount,
      adjustments: contract.adjustments ?? [],
      termsVersions: contract.termsVersions ?? [],
    };
    const rent = rentAtDate({ ...rentSource, date: period });
    const monthEnd = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0));
    const midMonthChange = rentChangeInMonth({ ...rentSource, periodStart: period, monthEnd });

    // Con VencimientoMesSiguiente, el mes siguiente al de inicio suma el primer mes: hace falta
    // su alquiler y saber si ese mes ya tiene liquidación (para no cobrarlo dos veces).
    let firstMonth: { monthlyAmount: string; alreadyBilled: boolean } | null = null;
    const startMonthStart = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
    const isMonthAfterStart =
      period.getUTCFullYear() * 12 + period.getUTCMonth() ===
      startDate.getUTCFullYear() * 12 + startDate.getUTCMonth() + 1;
    if (conventions.firstDueMode === FirstDueMode.VencimientoMesSiguiente && isMonthAfterStart) {
      const startRent = rentAtDate({ ...rentSource, date: startMonthStart });
      const billed = await this.prisma.client.liquidacion.findFirst({
        where: { contractId: contract.id, period: startMonthStart },
      });
      firstMonth = { monthlyAmount: startRent.amount, alreadyBilled: !!billed };
    }

    const lessors = (contract.lessors ?? [])
      .filter((l: any) => isLessorActiveAt(l, lessorsDateFor(period, startDate)))
      .map((l: any) => ({ name: personName(l.person) }));

    // Correcciones de ajustes provisorios todavía sin facturar: se piden hasta el mes anterior
    // al período, porque el propio período ya sale con el alquiler corregido.
    const pendingTrueUps = await this.adjustments.getPendingTrueUps(
      contract.id,
      periodKey(addMonthsClamped(period, -1)),
    );
    const trueUps = pendingTrueUps.flatMap((t) => {
      const total = new Decimal(t.total);
      if (total.isZero()) return [];
      const label = `Corrección de ajuste provisorio (${t.effectiveFrom} a ${periodKey(addMonthsClamped(period, -1))})`;
      return [
        {
          // Un crédito (el estimado se pasó) es un descuento a favor del inquilino.
          type: total.isNegative() ? LineItemType.Descuento : LineItemType.AjusteRetroactivo,
          description: total.isNegative() ? `${label}, a favor del inquilino` : label,
          amount: total.abs().toFixed(2),
          sourceType: 'ContractAdjustment',
          sourceId: t.adjustmentId,
        },
      ];
    });

    // Boletas de servicios e impuestos que se cobran al inquilino: las partes sin facturar cuyo
    // mes ya llegó. Una boleta cargada después de generada la liquidación del mes entra en la
    // próxima que se genere.
    const serviceAllocations = await this.serviceBills.pendingLines(
      contract.id,
      period,
      contract.rentCurrency,
    );

    // Punitorios devengados en liquidaciones anteriores del contrato que todavía no se cobraron
    // ni se condonaron (FB-07): entran como renglones Multa de este período.
    const penaltyBilling = await this.penalties.pendingLines(tenantId, contract.id, period, todayInAR());

    // Cargos del centro de carga al inquilino (reparaciones, devoluciones, honorarios) listos para este mes.
    const pendingCharges = await this.charges.pendingLines(contract.id, period, contract.rentCurrency);

    const built = buildLiquidation({
      period,
      currency: contract.rentCurrency,
      contract: {
        startDate,
        endDate: contract.endDate,
        actualEndDate: contract.actualEndDate,
        status: contract.status,
      },
      rent: {
        monthlyAmount: rent.amount,
        isProvisional: rent.isProvisional,
        midMonthChange,
      },
      conventions,
      firstMonth,
      terms: {
        dueDay,
        discountPct: terms?.discountPct != null ? terms.discountPct.toString() : null,
        discountAmount: terms?.discountAmount != null ? terms.discountAmount.toString() : null,
      },
      lessors,
      trueUps,
      pendingCharges,
      serviceAllocations,
      penalties: penaltyBilling.lines,
    });

    if (built.skipped) {
      const notBilled = built.skipped === 'ChargedAtSigning' || built.skipped === 'DeferredToNextPeriod';
      return {
        contractId: contract.id,
        status: notBilled ? 'not_billed' : 'out_of_range',
        reason: built.skipped,
      };
    }

    try {
      const created = await this.prisma.client.$transaction(async (tx: any) => {
        const row = await tx.liquidacion.create({
        data: {
          tenantId,
          contractId: contract.id,
          period,
          dueDate: built.dueDate,
          status: LiquidacionStatus.Borrador,
          kind: built.kind,
          isProvisional: built.isProvisional,
          subtotal: built.subtotal,
          total: built.total,
          currency: contract.rentCurrency,
          lineItems: {
            create: built.lines.map((l) => ({
              tenantId,
              type: l.type,
              description: l.description,
              amount: l.amount,
              currency: contract.rentCurrency,
              sortOrder: l.sortOrder,
              commissionable: l.commissionable,
              beneficiary: l.beneficiary,
              sourceType: l.sourceType,
              sourceId: l.sourceId,
            })),
          },
        },
        });
        // Las correcciones se marcan facturadas en la misma transacción que crea la
        // liquidación: una corrección entra en una sola liquidación.
        await this.adjustments.markTrueUpBilled(
          pendingTrueUps.map((t) => t.adjustmentId),
          tx,
        );
        // Lo mismo con las partes de boletas: cada una se factura una sola vez.
        await this.serviceBills.markBilled(
          tx,
          // Una parte con diferencia por descuento tiene dos renglones con el mismo id.
          [...new Set(serviceAllocations.flatMap((l) => (l.sourceId ? [l.sourceId] : [])))],
          row.id,
        );
        // Y cada punitorio, una sola vez: la fila queda cobrada en esta liquidación.
        await this.penalties.markSettled(tx, penaltyBilling.rowIds, row.id);
        // Y los cargos del centro de carga: cada uno entra en una sola liquidación.
        await this.charges.markImputed(
          tx,
          pendingCharges.flatMap((l) => (l.sourceId ? [l.sourceId] : [])),
          row.id,
        );
        return row;
      });
      return { contractId: contract.id, status: 'created', liquidacionId: created?.id };
    } catch (error) {
      // Dos generaciones simultáneas: la otra ganó el unique (contrato, período).
      if ((error as { code?: string }).code === 'P2002') {
        return { contractId: contract.id, status: 'skipped', reason: 'EXISTS' };
      }
      throw error;
    }
  }

  /**
   * Proceso diario de una inmobiliaria: si hoy está a `leadDays` días o menos
   * del mes siguiente, genera sus liquidaciones. Lo llama el cron dentro del
   * contexto de cada inmobiliaria. Deja una fila de auditoría si generó alguna.
   */
  async generateScheduled(
    today: Date,
    source: 'cron' | 'run-now' = 'cron',
  ): Promise<GenerationSummary | null> {
    const tenantId = this.tenantContext.getTenantId()!;
    const defaults = await this.operationalDefaults.get(tenantId);
    const target = scheduledPeriod(today, defaults.leadDays);
    if (!target) return null;

    const summary = await this.generateForPeriod(target.year, target.month);

    if (summary.created > 0 || summary.failed > 0 || summary.adjustments.applied.length > 0) {
      await this.audit.record(this.prisma.client as any, {
        action: 'CREATE',
        entity: 'Liquidacion',
        entityId: null,
        userId: null,
        after: {
          period: `${target.year}-${String(target.month).padStart(2, '0')}`,
          created: summary.created,
          skipped: summary.skipped,
          outOfRange: summary.outOfRange,
          notBilled: summary.notBilled,
          failed: summary.failed,
          adjustmentsApplied: summary.adjustments.applied.length,
          adjustmentsPending: summary.adjustments.pending.length,
        },
        metadata: { source, job: 'liquidaciones-generate' },
      });
    }
    return summary;
  }

  // ─── List ───────────────────────────────────────────

  async findAll(query: unknown) {
    const filters: any = parseOrThrow(LiquidacionFilterSchema, query, 'Invalid filter parameters');

    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.contractId) where.contractId = filters.contractId;
    if (filters.month || filters.year) {
      // Filter by period month/year
      if (filters.month && filters.year) {
        where.period = monthStartUTC(filters.year, filters.month);
      } else if (filters.year) {
        where.period = periodFilter(filters.year);
      } else if (filters.month) {
        // Month without year — current year
        const currentYear = todayInAR().getUTCFullYear();
        where.period = monthStartUTC(currentYear, filters.month);
      }
    }

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.liquidacion.findMany({
        where,
        include: {
          contract: {
            include: { property: true },
          },
          lineItems: { orderBy: { sortOrder: 'asc' } },
          _count: { select: { payments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.liquidacion.count({ where }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  // ─── Detail ─────────────────────────────────────────

  async findOne(id: string) {
    const liquidacion = await this.prisma.client.liquidacion.findFirst({
      where: { id },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'asc' }, include: PAYMENT_INCLUDE },
        contract: {
          include: {
            property: true,
            persons: { include: { person: true } },
            lessors: { include: { person: true } },
          },
        },
      },
    });

    if (!liquidacion) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    return {
      ...liquidacion,
      payments: (liquidacion.payments ?? []).map(withReceiptLabel),
      receiptNumber: liquidacion.receiptSeq != null ? formatReceiptNumber(liquidacion.receiptSeq) : null,
    };
  }

  // ─── Line Item CRUD ─────────────────────────────────

  async addLineItem(liquidacionId: string, data: unknown) {
    const validated: any = parseOrThrow(CreateLiquidacionLineItemSchema, data, 'Invalid line item data');

    const liquidacion = await this.ensureEditable(liquidacionId);
    const tenantId = this.tenantContext.getTenantId()!;

    // Get max sort order
    const maxSort = await this.prisma.client.liquidacionLineItem.findFirst({
      where: { liquidacionId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const lineItem = await this.prisma.client.liquidacionLineItem.create({
      data: {
        tenantId,
        liquidacionId,
        type: validated.type,
        description: validated.description,
        amount: validated.amount,
        currency: validated.currency ?? liquidacion.currency,
        commissionable: validated.commissionable ?? defaultCommissionable(validated.type),
        beneficiary: validated.beneficiary ?? defaultBeneficiary(validated.type),
        sortOrder: (maxSort?.sortOrder ?? 0) + 1,
      },
    });

    await this.recalculateTotals(liquidacionId);

    this.logger.log('Line item added', {
      liquidacionId,
      lineItemId: lineItem.id,
      type: validated.type,
      amount: validated.amount,
    });

    return this.findOne(liquidacionId);
  }

  async updateLineItem(lineItemId: string, data: unknown) {
    const validated: any = parseOrThrow(UpdateLiquidacionLineItemSchema, data, 'Invalid line item data');

    const lineItem = await this.prisma.client.liquidacionLineItem.findFirst({
      where: { id: lineItemId },
    });

    if (!lineItem) {
      throw new NotFoundException({
        error: 'LINE_ITEM_NOT_FOUND',
        message: 'Line item not found',
      });
    }

    await this.ensureEditable(lineItem.liquidacionId);

    // Si cambia el tipo y no se indica el destino ni la comisión, rigen los del tipo nuevo.
    const patch = { ...validated };
    if (validated.type && validated.type !== lineItem.type) {
      patch.commissionable ??= defaultCommissionable(validated.type);
      patch.beneficiary ??= defaultBeneficiary(validated.type);
    }

    await this.prisma.client.liquidacionLineItem.update({
      where: { id: lineItemId },
      data: patch,
    });

    await this.recalculateTotals(lineItem.liquidacionId);

    this.logger.log('Line item updated', {
      lineItemId,
      liquidacionId: lineItem.liquidacionId,
      fieldsUpdated: Object.keys(validated),
    });

    return this.findOne(lineItem.liquidacionId);
  }

  async removeLineItem(lineItemId: string) {
    const lineItem = await this.prisma.client.liquidacionLineItem.findFirst({
      where: { id: lineItemId },
    });

    if (!lineItem) {
      throw new NotFoundException({
        error: 'LINE_ITEM_NOT_FOUND',
        message: 'Line item not found',
      });
    }

    await this.ensureEditable(lineItem.liquidacionId);

    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.liquidacionLineItem.delete({ where: { id: lineItemId } });
      if (lineItem.type === LineItemType.Multa && lineItem.sourceType === 'Penalty' && lineItem.sourceId) {
        // Los punitorios de ese renglón vuelven a quedar pendientes para la próxima liquidación.
        await this.penalties.release(tx, lineItem.liquidacionId, lineItem.sourceId);
      }
      if (lineItem.sourceType === 'PendingCharge' && lineItem.sourceId) {
        await this.charges.releaseFromLiquidation(tx, { ids: [lineItem.sourceId] });
      }
      if (lineItem.sourceType === 'ContractAdjustment' && lineItem.sourceId) {
        await this.adjustments.releaseTrueUps([lineItem.sourceId], tx);
      }
      if (lineItem.sourceType === 'ServiceBillAllocation' && lineItem.sourceId) {
        await this.serviceBills.release(tx, { ids: [lineItem.sourceId] });
        // El renglón de la diferencia por descuento anual de esa parte sale junto con el principal.
        await tx.liquidacionLineItem.deleteMany({
          where: {
            liquidacionId: lineItem.liquidacionId,
            sourceType: 'ServiceBillAllocationSurplus',
            sourceId: lineItem.sourceId,
          },
        });
      }
    });

    await this.recalculateTotals(lineItem.liquidacionId);

    this.logger.log('Line item removed', {
      lineItemId,
      liquidacionId: lineItem.liquidacionId,
    });

    return this.findOne(lineItem.liquidacionId);
  }

  // ─── State Transitions ──────────────────────────────

  async transition(id: string, data: unknown) {
    const validated: any = parseOrThrow(TransitionLiquidacionSchema, data, 'Invalid transition data');

    const liquidacion = await this.prisma.client.liquidacion.findFirst({
      where: { id },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        payments: true,
      },
    });

    if (!liquidacion) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    const fromStatus = liquidacion.status as LiquidacionStatus;
    const toStatus = validated.status as LiquidacionStatus;

    assertTransition(liquidacionMachine, fromStatus, toStatus);

    const updateData: any = { status: toStatus };

    // On transition to Enviada: trigger PDF + email
    if (toStatus === LiquidacionStatus.Enviada) {
      updateData.sentAt = new Date();
    }

    // El recibo se numera al aprobar (o al enviar, si se salteó ese paso): un
    // borrador que se descarta no gasta número. El número no se reasigna.
    const needsReceipt =
      (toStatus === LiquidacionStatus.Aprobada || toStatus === LiquidacionStatus.Enviada) &&
      liquidacion.receiptSeq == null;

    if (needsReceipt) {
      const tenantId = this.tenantContext.getTenantId()!;
      await this.prisma.client.$transaction(async (tx: any) => {
        updateData.receiptSeq = await nextDocumentNumber(tx, tenantId, RECEIPT_SERIES);
        await tx.liquidacion.update({ where: { id }, data: updateData });
      });
    } else if (toStatus === LiquidacionStatus.Anulada) {
      // Anular libera lo que la liquidación había tomado, en la misma transacción.
      await this.prisma.client.$transaction(async (tx: any) => {
        await tx.liquidacion.update({ where: { id }, data: updateData });
        await this.releaseSources(tx, id, 'annulled', fromStatus);
      });
    } else {
      await this.prisma.client.liquidacion.update({
        where: { id },
        data: updateData,
      });
    }

    this.logger.log('Liquidación transitioned', {
      liquidacionId: id,
      fromStatus,
      toStatus,
      receiptSeq: updateData.receiptSeq,
      userId: this.tenantContext.getUserId(),
    });

    const updated = await this.findOne(id);

    // On transition to Enviada: generate PDF and send email
    if (toStatus === LiquidacionStatus.Enviada) {
      await this.sendPdfEmail(updated);
    }

    return updated;
  }

  // ─── Payments ───────────────────────────────────────

  async registerPayment(liquidacionId: string, data: unknown) {
    const validated: any = parseOrThrow(CreatePaymentSchema, data, 'Invalid payment data');
    const tenantId = this.tenantContext.getTenantId()!;

    // La regla de punitorios se resuelve antes de bloquear la fila: pago tardío o cobro con punitorios.
    const paidDay = parseDay(new Date(validated.paidAt).toISOString().slice(0, 10));
    const head = await this.prisma.client.liquidacion.findFirst({
      where: { id: liquidacionId },
      select: { contractId: true, dueDate: true },
    });
    const penaltyCtx =
      head && (validated.settlePenalties || paidDay.getTime() > head.dueDate.getTime())
        ? await this.penalties.loadContext(tenantId, head.contractId, paidDay)
        : null;

    // Validar el saldo, crear el pago y pasar a Pagada es una sola unidad: la
    // fila de la liquidación se bloquea (SELECT ... FOR UPDATE) hasta el commit,
    // así que dos pagos simultáneos se serializan y el segundo ve el saldo que
    // dejó el primero. El SQL crudo no pasa por la extensión de inmobiliaria,
    // por eso filtra por tenantId a mano (ADR-0006).
    const { payment, remaining, fullyPaid, totalPaid, penaltySettled } = await this.prisma.client.$transaction(
      (tx: any) => this.applyPaymentInTx(tx, tenantId, liquidacionId, validated, penaltyCtx, paidDay),
    );

    if (fullyPaid) {
      this.logger.log('Liquidación auto-transitioned to Pagada', {
        liquidacionId,
        paymentId: payment.id,
        totalPaid,
      });
    }

    this.logger.log('Payment registered', {
      liquidacionId,
      paymentId: payment.id,
      amount: validated.amount,
      method: validated.method,
      remainingBalance: remaining.toFixed(2),
      fullyPaid,
    });

    const detail = await this.findOne(liquidacionId);
    const withPayment = { ...detail, registeredPayment: withReceiptLabel(payment) };
    return penaltySettled ? { ...withPayment, penaltySettled } : withPayment;
  }

  /**
   * Un pago de una liquidación dentro de la transacción del que llama: bloquea la fila, valida el
   * estado y el saldo, cobra los punitorios si se pidió, crea el pago, reparte (caja, recibo y cuenta
   * corriente de los locadores) y pasa la liquidación a Pagada si queda saldada. Lo usan el cobro
   * normal y la aplicación del depósito en la liquidación de egreso.
   */
  async applyPaymentInTx(
    tx: any,
    tenantId: string,
    liquidacionId: string,
    validated: any,
    penaltyCtx: PenaltyContext | null,
    paidDay: Date,
  ) {
    const locked: { id: string }[] = await tx.$queryRaw(
      Prisma.sql`SELECT id FROM liquidaciones WHERE id = ${liquidacionId} AND "tenantId" = ${tenantId} FOR UPDATE`,
    );
    if (locked.length === 0) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    const liquidacion = await tx.liquidacion.findFirst({
      where: { id: liquidacionId },
      include: { payments: true, lineItems: true },
    });

    if (!liquidacion) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    // Payments are only allowed when status is Enviada or Vencida
    const status = liquidacion.status as LiquidacionStatus;
    if (status !== LiquidacionStatus.Enviada && status !== LiquidacionStatus.Vencida) {
      throw new BadRequestException({
        error: 'INVALID_STATUS_FOR_PAYMENT',
        message: `Cannot register payment when status is ${status}. Must be Enviada or Vencida.`,
      });
    }

    // Cobro con punitorios: lo devengado a la fecha del pago, sin lo condonado ni lo ya cobrado en
    // otra liquidación, entra como renglón Multa y el pago tiene que cubrir el total.
    let penaltySettled: { amount: string; days: number } | null = null;
    if (validated.settlePenalties && penaltyCtx) {
      const { result } = await this.penalties.accrue(tx, liquidacion, penaltyCtx, paidDay, 'payment');
      const rows: { id: string; amount: unknown }[] = await tx.penalty.findMany({
        where: { liquidacionId, status: 'active', settledLiquidacionId: null },
        select: { id: true, amount: true },
      });
      const due = rows.reduce((acc, r) => acc.plus(String(r.amount)), new Decimal(0));
      if (due.gt(0)) {
        const last = await tx.liquidacionLineItem.findFirst({
          where: { liquidacionId },
          orderBy: { sortOrder: 'desc' },
          select: { sortOrder: true },
        });
        const multa = await tx.liquidacionLineItem.create({
          data: {
            tenantId,
            liquidacionId,
            type: LineItemType.Multa,
            description: `Punitorios por mora hasta el ${formatDateAR(paidDay)} (${result.daysOverdue} días)`,
            amount: due.toFixed(2),
            currency: liquidacion.currency,
            sortOrder: (last?.sortOrder ?? -1) + 1,
            commissionable: defaultCommissionable(LineItemType.Multa),
            beneficiary: defaultBeneficiary(LineItemType.Multa),
            sourceType: 'Penalty',
            sourceId: liquidacionId,
          },
        });
        await this.penalties.markSettled(tx, rows.map((r) => r.id), liquidacionId);
        const updated = await this.recalculateTotals(liquidacionId, tx);
        liquidacion.total = updated.total;
        liquidacion.lineItems = [...(liquidacion.lineItems ?? []), multa];
        penaltySettled = { amount: due.toFixed(2), days: result.daysOverdue };
      }
    }

    // Un pago no puede superar lo que falta saldar: el excedente no tiene a qué
    // imputarse y dejaría la liquidación con saldo negativo.
    const priorPayments: PaymentInput[] = liquidacion.payments.map((p: any) => ({
      amount: p.amount.toString(),
    }));
    const balanceBefore = calculateRemainingBalance(liquidacion.total.toString(), priorPayments);
    if (new Decimal(validated.amount).gt(balanceBefore)) {
      throw new BadRequestException({
        error: 'PAYMENT_EXCEEDS_BALANCE',
        message: `Payment amount exceeds the remaining balance of ${balanceBefore.toFixed(2)}`,
        remainingBalance: balanceBefore.toFixed(2),
      });
    }

    // Con `RentaPrimero` (por defecto) el pago tiene que cubrir todo; con `PunitorioPrimero` puede
    // ser parcial y cubre primero el punitorio.
    const penaltyFirst = penaltyCtx?.rule.partialPaymentAllocation === 'PunitorioPrimero';
    if (penaltySettled && !penaltyFirst && !new Decimal(validated.amount).eq(balanceBefore)) {
      throw new BadRequestException({
        error: 'PAYOFF_REQUIRES_FULL_AMOUNT',
        message: `A payment that settles penalties must cover the full amount of ${balanceBefore.toFixed(2)}`,
        expectedAmount: balanceBefore.toFixed(2),
      });
    }

    if (validated.externalRef) {
      const duplicate = await tx.payment.findFirst({ where: { externalRef: validated.externalRef }, select: { id: true } });
      if (duplicate) {
        throw new ConflictException({
          error: 'PAYMENT_EXTERNAL_REF_EXISTS',
          message: `A payment with external reference ${validated.externalRef} already exists`,
        });
      }
    }

    const inserted = await tx.payment.create({
      data: {
        tenantId,
        liquidacionId,
        amount: validated.amount,
        method: validated.method,
        reference: validated.reference ?? null,
        notes: validated.notes ?? null,
        paidAt: new Date(validated.paidAt),
        currency: liquidacion.currency,
        externalRef: validated.externalRef ?? null,
      },
    });

    // Caja y recibo en la misma transacción: quién recibió, reparto, movimientos y
    // recibo numerado una sola vez (ADR-0012).
    const created = await this.paymentCash.record(tx, {
      tenantId,
      liquidacion,
      payment: inserted,
      paidBefore: priorPayments.reduce((acc, p) => acc.plus(String(p.amount)), new Decimal(0)).toFixed(2),
      input: {
        receivedBy: validated.receivedBy ?? null,
        accountId: validated.accountId ?? null,
        inCustody: validated.inCustody ?? null,
        receivedByUserId: validated.receivedByUserId ?? null,
      },
    });

    // Check if fully paid using shared engine
    const allPayments: PaymentInput[] = [...priorPayments, { amount: validated.amount }];
    const isPaid = isFullyPaid(liquidacion.total.toString(), allPayments);
    const left = calculateRemainingBalance(liquidacion.total.toString(), allPayments);

    // Un pago tardío que salda la liquidación fija el devengo hasta su fecha: lo que no se cobró
    // en el momento queda como punitorio pendiente para la próxima liquidación.
    if (isPaid && !penaltySettled && penaltyCtx && paidDay.getTime() > liquidacion.dueDate.getTime()) {
      await this.penalties.accrue(tx, liquidacion, penaltyCtx, paidDay, 'payment');
    }

    if (isPaid) {
      // Auto-transition to Pagada. La fecha de saldado es la del último pago que
      // la completó, no el momento en que se cargó en el sistema: una cobranza
      // del día 5 registrada el día 20 se saldó el 5, y de esa fecha dependen la
      // puntualidad, el puntaje del inquilino y el resumen de cierre.
      const settledOn = [
        ...liquidacion.payments.map((p: { paidAt: Date }) => p.paidAt),
        created.paidAt,
      ].reduce((latest, date) => (date > latest ? date : latest));

      await tx.liquidacion.update({
        where: { id: liquidacionId },
        data: {
          status: LiquidacionStatus.Pagada,
          paidAt: settledOn,
        },
      });
    }

    return {
      payment: created,
      remaining: left,
      fullyPaid: isPaid,
      totalPaid: new Decimal(liquidacion.total.toString()).minus(left).toFixed(2),
      penaltySettled,
    };
  }

  async findPayments(liquidacionId: string) {
    const liquidacion = await this.prisma.client.liquidacion.findFirst({
      where: { id: liquidacionId },
    });

    if (!liquidacion) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    const payments = await this.prisma.client.payment.findMany({
      where: { liquidacionId },
      orderBy: { paidAt: 'asc' },
      include: PAYMENT_INCLUDE,
    });
    return payments.map(withReceiptLabel);
  }

  // ─── PDF Generation ─────────────────────────────────

  async generatePdf(id: string): Promise<Buffer> {
    const liquidacion = await this.findOne(id);
    return this.renderReceipt(liquidacion);
  }

  /** PDF del recibo: número, monto en letras, "por cuenta y orden" y renglones por destino. */
  private async renderReceipt(liquidacion: any): Promise<Buffer> {
    const tenantId = this.tenantContext.getTenantId()!;
    const tenant = await this.prisma.client.tenant.findFirst({
      where: { id: tenantId },
    });

    const lessorNames = (liquidacion.contract?.lessors ?? [])
      .filter((l: any) => isLessorActiveAt(l, lessorsDateFor(liquidacion.period, liquidacion.contract?.startDate)))
      .map((l: any) => personName(l.person));

    return this.pdfService.generateReceipt(
      {
        id: liquidacion.id,
        period: liquidacion.period,
        subtotal: liquidacion.subtotal.toString(),
        total: liquidacion.total.toString(),
        currency: liquidacion.currency,
        dueDate: liquidacion.dueDate,
        kind: liquidacion.kind,
        isProvisional: liquidacion.isProvisional,
        receiptNumber: liquidacion.receiptNumber ?? null,
        amountInWords: amountInWords(liquidacion.total.toString(), liquidacion.currency),
        onBehalfOf: onBehalfOfText(lessorNames),
      },
      {
        name: tenant?.name ?? 'Inmobiliaria',
        cuit: (tenant as any)?.cuit ?? null,
        logoUrl: (tenant as any)?.logoUrl ?? null,
      },
      { property: liquidacion.contract?.property ?? null },
      (liquidacion.lineItems ?? []).map((li: any) => ({
        type: li.type,
        description: li.description,
        amount: li.amount.toString(),
        beneficiary: li.beneficiary,
        commissionable: li.commissionable,
      })),
      (liquidacion.payments ?? []).map((p: any) => ({
        method: p.method,
        amount: p.amount.toString(),
        paidAt: p.paidAt,
        reference: p.reference,
      })),
    );
  }

  // ─── Bulk Operations ────────────────────────────────

  async bulkApprove(ids: string[]) {
    if (!ids || ids.length === 0) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'ids array is required and must not be empty',
      });
    }

    return this.processBulkApprove(ids);
  }

  async bulkSend(ids: string[]) {
    if (!ids || ids.length === 0) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'ids array is required and must not be empty',
      });
    }

    return this.processBulkSend(ids);
  }

  // ─── Delete / Annul ─────────────────────────────────

  async remove(id: string) {
    const liquidacion = await this.prisma.client.liquidacion.findFirst({
      where: { id },
    });

    if (!liquidacion) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    const status = liquidacion.status as LiquidacionStatus;

    // If in Borrador or Revision, hard delete; otherwise annul
    if (
      status === LiquidacionStatus.Borrador ||
      status === LiquidacionStatus.Revision
    ) {
      // Las partes de boletas que traía vuelven a quedar pendientes para la próxima.
      await this.prisma.client.$transaction(async (tx: any) => {
        await this.releaseSources(tx, id, 'deleted', status);
        await tx.liquidacion.delete({ where: { id } });
      });
      this.logger.log('Liquidación deleted', { liquidacionId: id, status });
      return { deleted: true, id };
    }

    // For other states, transition to Anulada
    if (!validateLiquidacionTransition(status, LiquidacionStatus.Anulada)) {
      throw new BadRequestException({
        error: 'CANNOT_ANNUL',
        message: `Cannot annul liquidación in status ${status}`,
      });
    }

    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.liquidacion.update({ where: { id }, data: { status: LiquidacionStatus.Anulada } });
      await this.releaseSources(tx, id, 'annulled', status);
    });

    this.logger.log('Liquidación annulled', {
      liquidacionId: id,
      fromStatus: status,
    });

    return this.findOne(id);
  }

  // ─── Private Helpers ────────────────────────────────

  /**
   * Devuelve a pendiente lo que la liquidación había tomado: las partes de boletas,
   * los cargos del centro de carga, los punitorios y las correcciones de ajustes provisorios.
   * Corre en la transacción de quien anula o borra, y deja una fila de auditoría.
   */
  private async releaseSources(tx: any, liquidacionId: string, reason: 'annulled' | 'deleted', fromStatus: string) {
    const trueUpLines = await tx.liquidacionLineItem.findMany({
      where: { liquidacionId, sourceType: 'ContractAdjustment' },
      select: { sourceId: true },
    });
    const trueUps = await this.adjustments.releaseTrueUps(
      trueUpLines.flatMap((l: { sourceId: string | null }) => (l.sourceId ? [l.sourceId] : [])),
      tx,
    );
    const billParts = await this.serviceBills.release(tx, { liquidacionId });
    const charges = await this.charges.releaseFromLiquidation(tx, { liquidacionId });
    // Una liquidación anulada o borrada no cobra: sus punitorios vuelven a quedar pendientes.
    const penalties = await this.penalties.release(tx, liquidacionId);
    await this.audit.record(tx, {
      action: 'UPDATE',
      entity: 'Liquidacion',
      entityId: liquidacionId,
      metadata: { operation: `release-on-${reason}`, fromStatus, released: { trueUps, billParts, charges, penalties } },
    });
  }

  private async ensureEditable(liquidacionId: string) {
    const liquidacion = await this.prisma.client.liquidacion.findFirst({
      where: { id: liquidacionId },
    });

    if (!liquidacion) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    const status = liquidacion.status as LiquidacionStatus;
    if (
      status !== LiquidacionStatus.Borrador &&
      status !== LiquidacionStatus.Revision
    ) {
      throw new BadRequestException({
        error: 'NOT_EDITABLE',
        message: `Line items can only be modified when status is Borrador or Revision (current: ${status})`,
      });
    }

    return liquidacion;
  }

  private async recalculateTotals(liquidacionId: string, db: any = this.prisma.client) {
    const lineItems = await db.liquidacionLineItem.findMany({
      where: { liquidacionId },
    });

    const inputs: LineItemInput[] = lineItems.map((li: any) => ({
      type: li.type as LineItemType,
      amount: li.amount.toString(),
    }));

    let result: ReturnType<typeof calculateLineItemsTotal>;
    try {
      result = calculateLineItemsTotal(inputs);
    } catch (err) {
      if (err instanceof InvalidLineAmountError) {
        throw new BadRequestException({
          error: err.code,
          message: err.message,
        });
      }
      throw err;
    }

    return db.liquidacion.update({
      where: { id: liquidacionId },
      data: {
        subtotal: result.subtotal.toFixed(2),
        total: result.total.toFixed(2),
      },
    });
  }

  /**
   * Encola el mail de la liquidación al inquilino en la bandeja de salida
   * (ADR-0013); el PDF se genera al despacharlo. Una vez por liquidación: si
   * vuelve a pasar por Enviada no se repite. Nunca hace fallar la transición.
   */
  private async sendPdfEmail(liquidacion: any) {
    try {
      const inquilino = liquidacion.contract ? getParty<any>(liquidacion.contract, 'Inquilino') : undefined;
      if (!inquilino?.person?.email) {
        this.logger.warn('No inquilino email found — skipping email', {
          liquidacionId: liquidacion.id,
          contractId: liquidacion.contractId,
        });
        return;
      }
      const tenant = await this.prisma.client.tenant.findFirst({
        where: { id: this.tenantContext.getTenantId()! },
        select: { name: true },
      });
      await this.outbox.enqueue(this.prisma.client, {
        channel: MessageChannel.Email,
        templateKey: 'liquidacion',
        vars: liquidacionMessageVars(
          { period: liquidacion.period, total: liquidacion.total.toString() },
          tenant?.name ?? 'Inmobiliaria',
        ),
        personId: inquilino.person.id ?? inquilino.personId ?? null,
        to: inquilino.person.email,
        relatedType: 'Liquidacion',
        relatedId: liquidacion.id,
        idempotencyKey: `Liquidacion:${liquidacion.id}:Email`,
        createdByUserId: this.tenantContext.getUserId() ?? null,
      });
    } catch (error) {
      // Una dirección inválida no hace fallar la transición.
      this.logger.error('Failed to queue PDF email', {
        liquidacionId: liquidacion.id,
        error: (error as Error).message,
      });
    }
  }

  private async processBulkApprove(ids: string[]) {
    let processed = 0;
    let failed = 0;

    for (const id of ids) {
      try {
        await this.transition(id, { status: LiquidacionStatus.Aprobada });
        processed++;
      } catch (error) {
        failed++;
        this.logger.error('Bulk approve failed for item', {
          liquidacionId: id,
          error: (error as Error).message,
        });
      }
    }

    this.logger.log('Bulk approve completed', { processed, failed, total: ids.length });
    return { processed, failed, total: ids.length };
  }

  private async processBulkSend(ids: string[]) {
    let processed = 0;
    let failed = 0;

    for (const id of ids) {
      try {
        await this.transition(id, { status: LiquidacionStatus.Enviada });
        processed++;
      } catch (error) {
        failed++;
        this.logger.error('Bulk send failed for item', {
          liquidacionId: id,
          error: (error as Error).message,
        });
      }
    }

    this.logger.log('Bulk send completed', { processed, failed, total: ids.length });
    return { processed, failed, total: ids.length };
  }
}
