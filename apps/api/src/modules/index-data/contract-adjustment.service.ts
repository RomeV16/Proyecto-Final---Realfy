import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { IndexDataService } from './index-data.service';
import { AdjustmentWindow, excludesWindowStart, resolveAdjustmentWindow } from './adjustment-window';
import {
  AdjustmentBase,
  AdjustmentType,
  AdjustmentPeriod,
  ContractStatus,
  IndexType,
  ScheduleStatus,
  assessCoverage,
  calculateAdjustment,
  calculateTrueUp,
  addMonthsClamped,
  expectedMonthlyPeriods,
  isWithinFixedInitialPeriod,
  monthsBetween,
  periodKey,
  periodToMonths,
  resolveAdjustmentBasis,
  resolveOperationalDefaults,
  shiftWindowByLag,
  todayInAR,
} from '@realfy/shared';
import type { AdjustmentParams, Coverage, IndexObservation, IndexWindow } from '@realfy/shared';
import Decimal from 'decimal.js';
import { getTermsAt } from '../contracts/contract-terms';

const toDecimal = (row: { value: unknown }) => new Decimal(String(row.value));

/** Código con el que se informa un ajuste que no se pudo calcular por falta de índices. */
export const MISSING_INDEX_DATA = 'MISSING_INDEX_DATA';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface AdjustmentPreview {
  period: string;
  indexType: IndexType;
  factor: Decimal;
  currentRent: Decimal;
  projectedRent: Decimal;
  projectedDelta: Decimal;
  /** Calculado con índices estimados (pago a cuenta). */
  isProvisional: boolean;
  /** Meses cubiertos con un estimado. */
  estimatedPeriods: string[];
}

/** Valor de un índice que entró en el cálculo, para reconstruirlo y corregirlo después. */
export interface UsedIndexValue {
  indexType: IndexType;
  /** `YYYY-MM` en las series mensuales, `YYYY-MM-DD` en las diarias. */
  period: string;
  value: string;
  isEstimate: boolean;
}

export interface LoadedParams {
  params: AdjustmentParams;
  /** Modalidad con que se calculó (la de la versión de reglas vigente). */
  adjustmentType: AdjustmentType;
  /** Índice principal usado, para informar en la previsualización. */
  indexType: IndexType;
  /** Reglas con que se calculó, de la versión vigente a la fecha del ajuste. */
  rules: { adjustmentBase: string; indexLagMonths: number; fixedInitialMonths: number };
  /** Hay meses cubiertos con un estimado: el ajuste es a cuenta y se corrige al publicarse el oficial. */
  isProvisional: boolean;
  /** Índices y meses cubiertos con un estimado. */
  estimated: { indexType: IndexType; period: string }[];
  /** Valores que entraron en el cálculo. */
  observations: UsedIndexValue[];
  /** Ventana de índices efectiva (con el rezago y la base ya aplicados). */
  window: { from: Date; until: Date };
  /** El ajuste cae en los meses fijos iniciales: el alquiler no cambia. */
  fixedInitial: boolean;
}

export interface LoadOptions {
  tenantId: string;
  client?: IndexClient;
  /**
   * Pago a cuenta: si es falso, un mes sin valor oficial no se cubre con el
   * estimado. Sin indicar, rige el de la inmobiliaria (`allowProvisional`).
   */
  allowProvisional?: boolean;
}

/** Ajuste aplicado (o salteado por estar en los meses fijos iniciales) por el barrido o la aplicación masiva. */
export interface AdjustmentApplied {
  contractId: string;
  scheduleId: string;
  periodNumber: number;
  /** `YYYY-MM` del cronograma. */
  appliedPeriod: string;
  status: 'applied' | 'provisional' | 'fixed_initial';
  previousRent: string;
  newRent: string;
  deltaAmount: string;
  percentage: string;
  estimatedPeriods: string[];
  adjustmentId: string | null;
}

/** Ajuste que no se pudo aplicar: sigue pendiente. */
export interface AdjustmentSkipped {
  contractId: string;
  scheduleId: string;
  appliedPeriod: string;
  reason: string;
  indexTypes?: string[];
  missingPeriods?: string[];
}

/**
 * Corrección retroactiva pendiente de facturar: el ajuste provisorio de un
 * contrato ya tiene su valor oficial y los meses facturados con el alquiler
 * provisorio quedaron con una diferencia. Es el dato que consume el armado de
 * liquidaciones (ver ADR-0011).
 */
export interface PendingTrueUp {
  /** Ajuste definitivo (el que corrige al provisorio): se marca facturado con `markTrueUpBilled`. */
  adjustmentId: string;
  provisionalAdjustmentId: string;
  contractId: string;
  periodNumber: number;
  /** Primer mes (`YYYY-MM`) facturado con el alquiler provisorio. */
  effectiveFrom: string;
  provisionalRent: string;
  officialRent: string;
  /** Oficial menos provisorio, por mes; negativo si el estimado se pasó. */
  monthlyDelta: string;
  /** Meses de `effectiveFrom` a `upTo` con su diferencia. */
  months: { period: string; delta: string }[];
  /** Suma de la diferencia de esos meses. */
  total: string;
}

export interface AdjustmentRun {
  applied: AdjustmentApplied[];
  skipped: AdjustmentSkipped[];
}

/** El ajuste no se puede calcular: faltan los valores de uno o más índices. */
export class MissingIndexDataError extends BadRequestException {
  readonly code = MISSING_INDEX_DATA;

  constructor(
    readonly indexTypes: IndexType[],
    window: { from: Date; until: Date },
    readonly missingPeriods: string[] = [],
    readonly estimatesOnly = false,
  ) {
    super({
      error: MISSING_INDEX_DATA,
      message: `No index data found for ${indexTypes.join(', ')} in the adjustment period`,
      indexType: indexTypes.join('+'),
      periodStart: window.from,
      periodEnd: window.until,
      missingPeriods,
      // Hay estimado cargado pero la inmobiliaria no permite el pago a cuenta.
      estimatesOnly,
    });
  }
}

type IndexClient = {
  indexData: { findMany: (args: any) => Promise<any[]> };
  contractTermsVersion: { findFirst: (args: any) => Promise<any> };
  contractPeriod?: { findFirst: (args: any) => Promise<any> };
};

const SERIES_CCP: IndexType[] = [IndexType.CVS, IndexType.CER];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ContractAdjustmentService {
  private readonly logger = new Logger(ContractAdjustmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexData: IndexDataService,
    private readonly audit: AuditService,
  ) {}

  /** Pago a cuenta de la inmobiliaria (FB-13): activo salvo que se apague en sus valores por defecto. */
  async isProvisionalAllowed(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.baseClient.tenant.findUnique({
      where: { id: tenantId },
      select: { operationalDefaults: true },
    });
    return resolveOperationalDefaults(tenant?.operationalDefaults ?? null).allowProvisional;
  }

  /** Tramo vigente a la fecha: su inicio y su alquiler inicial (sin tramos, el contrato). */
  private async periodAt(
    client: IndexClient,
    contract: { id: string; tenantId: string; startDate: Date; rentAmount: unknown },
    date: Date,
  ): Promise<{ start: Date; initialRent: string }> {
    const found = client.contractPeriod
      ? await client.contractPeriod.findFirst({
          where: { tenantId: contract.tenantId, contractId: contract.id, startDate: { lte: date } },
          orderBy: { startDate: 'desc' },
        })
      : null;
    return found
      ? { start: found.startDate, initialRent: found.initialRent.toString() }
      : { start: contract.startDate, initialRent: String(contract.rentAmount) };
  }

  /**
   * Arma los parámetros del motor según la modalidad del contrato, leyendo
   * los índices de la ventana del ajuste a través de IndexDataService, que une
   * los valores propios con los de sistema. Es el único lugar donde se traduce
   * modalidad → parámetros: lo comparten la previsualización, el cálculo manual
   * de ContractsService, el barrido y la aplicación masiva (DEF-02, DEF-03,
   * DEF-25).
   *
   * Las reglas salen de la versión vigente a la fecha del ajuste
   * (`ContractTermsVersion`); sin versiones, de las columnas del contrato y sin
   * rezago, que es lo que el motor hacía antes de las reglas versionadas.
   * - Rezago: la ventana termina `indexLagMonths` meses antes de la fecha.
   * - Base: `Vigente` aplica el índice del período al alquiler de hoy;
   *   `Original`, el factor acumulado desde el inicio del tramo al alquiler
   *   inicial.
   * - Meses fijos: dentro de ellos el alquiler no cambia (`fixedInitial`).
   *
   * Un mes de la ventana sin valor oficial se cubre con el estimado si lo hay y
   * la inmobiliaria permite el pago a cuenta (`isProvisional`). Sin estimado, o
   * sin permiso, lanza 400 `MISSING_INDEX_DATA` con los meses que faltan (DEF-27):
   * nunca ajusta con menos meses ni con 0 %. También lanza `MISSING_ADJUSTMENT_PCT`,
   * `MISSING_ADJUSTMENT_STEPS` o `UNKNOWN_ADJUSTMENT_TYPE`.
   */
  async loadParams(
    contract: any,
    window: AdjustmentWindow,
    options: LoadOptions,
  ): Promise<LoadedParams> {
    const client: IndexClient = options.client ?? (this.prisma.baseClient as unknown as IndexClient);
    const currentRent = new Decimal(contract.rentAmount.toString());
    const terms = await getTermsAt(client, contract, window.until);
    const adjustmentType = (terms?.adjustmentType ?? contract.adjustmentType) as AdjustmentType;
    const customPct = terms ? terms.customPct : contract.customAdjustmentPct;
    const rules = {
      adjustmentBase: (terms?.adjustmentBase ?? AdjustmentBase.Vigente) as string,
      indexLagMonths: (terms?.indexLagMonths ?? 0) as number,
      fixedInitialMonths: (terms?.fixedInitialMonths ?? 0) as number,
    };

    const needsPeriod =
      rules.adjustmentBase === AdjustmentBase.Original ||
      rules.fixedInitialMonths > 0 ||
      adjustmentType === AdjustmentType.Escalonado;
    const period = needsPeriod ? await this.periodAt(client, contract, window.until) : null;

    const base = (overrides: Partial<LoadedParams>): LoadedParams => ({
      adjustmentType,
      indexType: IndexType.IPC,
      rules,
      isProvisional: false,
      estimated: [],
      observations: [],
      window: { from: window.from, until: window.until },
      fixedInitial: false,
      ...overrides,
    } as LoadedParams);

    if (period && isWithinFixedInitialPeriod(period.start, window.until, rules.fixedInitialMonths)) {
      return base({
        fixedInitial: true,
        params: { type: AdjustmentType.FixedPercent, percentage: new Decimal(0), baseRent: currentRent },
      });
    }

    const vigenteWindow: IndexWindow = {
      from: window.from,
      until: window.until,
      startExclusive: window.afterPrevious,
    };
    const basis = period
      ? resolveAdjustmentBasis({
          base: rules.adjustmentBase as AdjustmentBase,
          initialRent: period.initialRent,
          currentRent: currentRent.toString(),
          periodStart: period.start,
          vigenteWindow,
        })
      : { baseRent: currentRent.toString(), window: vigenteWindow };
    const baseRent = new Decimal(basis.baseRent);
    const shifted = shiftWindowByLag(basis.window, rules.indexLagMonths);
    const effective = { from: shifted.from, until: shifted.until };
    const forSeries = (type: IndexType): IndexWindow => ({
      ...shifted,
      startExclusive: excludesWindowStart({ ...window, afterPrevious: shifted.startExclusive }, type),
    });

    const load = (type: IndexType) => {
      const exclusive = forSeries(type).startExclusive;
      return this.indexData.getForPeriod(type, shifted.from, shifted.until, {
        tenantId: options.tenantId,
        ...(options.client ? { client: options.client } : {}),
        includeEstimates: true,
        ...(exclusive ? { startExclusive: true } : {}),
      });
    };

    const toObservation = (type: IndexType, row: any): IndexObservation => ({
      period: type === IndexType.IPC || type === IndexType.CVS || type === IndexType.CER
        ? periodKey(new Date(row.period))
        : isoDay(new Date(row.period)),
      value: toDecimal(row),
      isEstimate: Boolean(row.isEstimate),
    });

    const record = (type: IndexType, used: IndexObservation[]): UsedIndexValue[] =>
      used.map((o) => ({ indexType: type, period: o.period, value: o.value.toString(), isEstimate: o.isEstimate }));

    /** Serie mensual: la ventana debe tener cada mes; los faltantes se informan (DEF-27). */
    const monthly = async (type: IndexType) => {
      const rows = await load(type);
      const coverage = assessCoverage(
        expectedMonthlyPeriods(forSeries(type)),
        rows.map((r) => toObservation(type, r)),
      );
      return { type, coverage };
    };

    /** Cierra el cálculo con series completas: provisorio si usa estimados y el pago a cuenta está permitido. */
    const settle = async (
      series: { type: IndexType; coverage: Coverage }[],
    ): Promise<{ estimated: { indexType: IndexType; period: string }[] }> => {
      const incomplete = series.filter(
        (s) => s.coverage.missingPeriods.length > 0 || s.coverage.values.length === 0,
      );
      if (incomplete.length > 0) {
        throw new MissingIndexDataError(
          incomplete.map((s) => s.type),
          effective,
          [...new Set(incomplete.flatMap((s) => s.coverage.missingPeriods))],
        );
      }
      const estimated = series.flatMap((s) =>
        s.coverage.estimatedPeriods.map((p) => ({ indexType: s.type, period: p })),
      );
      if (estimated.length > 0) {
        const allowed =
          options.allowProvisional ?? (await this.isProvisionalAllowed(options.tenantId));
        if (!allowed) {
          throw new MissingIndexDataError(
            [...new Set(estimated.map((e) => e.indexType))],
            effective,
            [...new Set(estimated.map((e) => e.period))],
            true,
          );
        }
      }
      return { estimated };
    };

    /** Serie de nivel (ICL, UVA): el cociente toma el primer y el último valor de la ventana. */
    const level = async (type: IndexType) => {
      const rows = await load(type);
      // El cociente necesita el valor inicial y el final: con uno solo daría 1/1.
      if (rows.length < 2) throw new MissingIndexDataError([type], effective);
      const first = rows[0];
      const last = rows[rows.length - 1];
      const used = [toObservation(type, first), toObservation(type, last)];
      const estimated = used
        .filter((o) => o.isEstimate)
        .map((o) => ({ indexType: type, period: o.period }));
      if (estimated.length > 0) {
        const allowed =
          options.allowProvisional ?? (await this.isProvisionalAllowed(options.tenantId));
        if (!allowed) {
          throw new MissingIndexDataError([type], effective, estimated.map((e) => e.period), true);
        }
      }
      return { first, last, used, estimated };
    };

    switch (adjustmentType) {
      case AdjustmentType.IPC: {
        const ipc = await monthly(IndexType.IPC);
        const { estimated } = await settle([ipc]);
        return base({
          indexType: IndexType.IPC,
          isProvisional: estimated.length > 0,
          estimated,
          observations: record(IndexType.IPC, ipc.coverage.used),
          window: effective,
          params: { type: AdjustmentType.IPC, monthlyValues: ipc.coverage.values, baseRent },
        });
      }
      case AdjustmentType.ICL:
      case AdjustmentType.UVA: {
        const type = adjustmentType === AdjustmentType.ICL ? IndexType.ICL : IndexType.UVA;
        const { first, last, used, estimated } = await level(type);
        return base({
          indexType: type,
          isProvisional: estimated.length > 0,
          estimated,
          observations: record(type, used),
          window: effective,
          params: {
            type: adjustmentType,
            startValue: toDecimal(first),
            endValue: toDecimal(last),
            baseRent,
          },
        });
      }
      case AdjustmentType.CCP: {
        const [cvs, cer] = await Promise.all(SERIES_CCP.map((t) => monthly(t)));
        const { estimated } = await settle([cvs, cer]);
        return base({
          indexType: IndexType.CVS,
          isProvisional: estimated.length > 0,
          estimated,
          observations: [
            ...record(IndexType.CVS, cvs.coverage.used),
            ...record(IndexType.CER, cer.coverage.used),
          ],
          window: effective,
          params: {
            type: AdjustmentType.CCP,
            cvsPcts: cvs.coverage.values,
            cerPcts: cer.coverage.values,
            baseRent,
          },
        });
      }
      case AdjustmentType.FixedPercent:
      case AdjustmentType.Custom:
        if (!customPct) {
          throw new BadRequestException({
            error: 'MISSING_ADJUSTMENT_PCT',
            message: `Contract has no customAdjustmentPct set for ${adjustmentType} type`,
          });
        }
        return base({
          params: {
            type: adjustmentType,
            percentage: new Decimal(customPct.toString()),
            baseRent,
          },
        });
      case AdjustmentType.Escalonado: {
        const raw = terms?.customSteps;
        if (!Array.isArray(raw) || raw.length === 0) {
          throw new BadRequestException({
            error: 'MISSING_ADJUSTMENT_STEPS',
            message: 'Contract has no customSteps set for Escalonado type',
          });
        }
        return base({
          params: {
            type: AdjustmentType.Escalonado,
            steps: raw.map((s: { fromMonth: number; pct: string }) => ({
              fromMonth: s.fromMonth,
              pct: new Decimal(String(s.pct)),
            })),
            monthsElapsed: monthsBetween(period!.start, window.until),
            baseRent,
          },
        });
      }
      default:
        throw new BadRequestException({
          error: 'UNKNOWN_ADJUSTMENT_TYPE',
          message: `Unknown adjustment type: ${adjustmentType}`,
        });
    }
  }

  /** Lo que se guarda en `ContractAdjustment.indexValues` para reconstruir el cálculo. */
  buildIndexValues(loaded: LoadedParams): Record<string, unknown> {
    return {
      params: JSON.parse(JSON.stringify(loaded.params)),
      lagMonths: loaded.rules.indexLagMonths,
      base: loaded.rules.adjustmentBase,
      window: { from: loaded.window.from.toISOString(), until: loaded.window.until.toISOString() },
      observations: loaded.observations,
      estimated: loaded.estimated,
    };
  }

  // ─── Preview ───────────────────────────────────────────────────────────────

  /**
   * Read-only preview: computes the adjustment factor and projected rent for
   * a contract's next pending AdjustmentSchedule entry.  Does NOT mutate anything.
   */
  async preview(contractId: string): Promise<AdjustmentPreview> {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId },
    });

    if (!contract) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    // Find the next pending adjustment schedule entry
    const schedule = await this.prisma.client.adjustmentSchedule.findFirst({
      where: { contractId, status: ScheduleStatus.Pending },
      orderBy: { nextAdjustmentDate: 'asc' },
    });

    const adjustmentDate = schedule?.nextAdjustmentDate ?? new Date();
    const currentRent = new Decimal(contract.rentAmount.toString());

    const window = await resolveAdjustmentWindow(this.prisma.client, contract, adjustmentDate);
    const loaded = await this.loadParams(contract, window, { tenantId: contract.tenantId });

    const result = calculateAdjustment(loaded.params);
    const factor = result.newRent.div(currentRent.isZero() ? new Decimal(1) : currentRent);

    return {
      period: adjustmentDate.toISOString().slice(0, 7), // YYYY-MM
      indexType: loaded.indexType,
      factor,
      currentRent,
      projectedRent: result.newRent,
      projectedDelta: result.newRent.minus(currentRent),
      isProvisional: loaded.isProvisional,
      estimatedPeriods: [...new Set(loaded.estimated.map((e) => e.period))],
    };
  }

  // ─── Aplicar un cronograma ─────────────────────────────────────────────────

  /**
   * Aplica un cronograma pendiente de la inmobiliaria actual, todo o nada.
   * Con índice oficial el ajuste es definitivo; solo con estimados queda
   * provisorio (si la inmobiliaria permite el pago a cuenta). Escribe el
   * `ContractAdjustment`, el alquiler, el cronograma y el registro de auditoría
   * en la misma transacción. Sin los índices que la modalidad necesita lanza
   * `MissingIndexDataError` antes de escribir y el cronograma sigue pendiente.
   */
  async applySchedule(
    schedule: { id: string; contractId: string; nextAdjustmentDate: Date; periodNumber: number; contract?: any },
    context: { tenantId: string; source: string; userId?: string | null; allowProvisional?: boolean },
  ): Promise<AdjustmentApplied> {
    const appliedPeriod = schedule.nextAdjustmentDate.toISOString().slice(0, 7);
    let outcome!: AdjustmentApplied;

    await this.prisma.client.$transaction(async (tx: any) => {
      // Se relee el contrato: si el barrido se pone al día con dos ajustes del
      // mismo contrato, el segundo parte del alquiler que dejó el primero y no
      // del leído antes de empezar (DEF-08).
      const current =
        (await tx.contract.findUnique({ where: { id: schedule.contract?.id ?? schedule.contractId } })) ??
        schedule.contract;
      const currentRent = new Decimal(current.rentAmount.toString());
      const window = await resolveAdjustmentWindow(tx, current, schedule.nextAdjustmentDate);
      // Sin datos del índice no hay ajuste: aplicar 0 % en silencio dejaría el
      // cronograma como Applied y el alquiler sin actualizar. loadParams corta
      // antes de escribir; el cronograma sigue pendiente para el próximo barrido.
      const loaded = await this.loadParams(current, window, {
        tenantId: context.tenantId,
        client: tx,
        allowProvisional: context.allowProvisional,
      });

      // Fecha del ajuste siguiente: falla antes de escribir si el período es desconocido.
      const months = periodToMonths(current.adjustmentPeriod as AdjustmentPeriod);
      const nextDate = addMonthsClamped(schedule.nextAdjustmentDate, months);

      const result = calculateAdjustment(loaded.params);
      const newRent = loaded.fixedInitial ? currentRent : result.newRent;
      const delta = newRent.minus(currentRent);
      const percentage = loaded.fixedInitial ? new Decimal(0) : result.percentage;

      let adjustmentId: string | null = null;
      if (!loaded.fixedInitial) {
        const created = await tx.contractAdjustment.create({
          data: {
            tenantId: context.tenantId,
            contractId: current.id,
            periodNumber: schedule.periodNumber,
            adjustmentDate: schedule.nextAdjustmentDate,
            previousAmount: currentRent.toString(),
            newAmount: newRent.toString(),
            percentage: percentage.toDecimalPlaces(4).toString(),
            currency: current.rentCurrency,
            indexType: loaded.adjustmentType,
            indexValues: this.buildIndexValues(loaded) as any,
            notes: loaded.isProvisional ? 'PROVISIONAL' : null,
            calculatedAt: new Date(),
            appliedAt: new Date(),
            isProvisional: loaded.isProvisional,
          },
        });
        adjustmentId = created?.id ?? null;
        await tx.contract.update({
          where: { id: current.id },
          data: { rentAmount: newRent.toString() },
        });
      }

      // Dentro de los meses fijos iniciales el cronograma se saltea (no ancla la
      // ventana del ajuste siguiente, que sigue contando desde el último aplicado).
      await tx.adjustmentSchedule.update({
        where: { id: schedule.id },
        data: { status: loaded.fixedInitial ? ScheduleStatus.Skipped : ScheduleStatus.Applied },
      });

      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'adjustment_applied',
        entityId: current.id,
        userId: context.userId ?? null,
        tenantId: context.tenantId,
        before: { rent: currentRent.toString() },
        after: { rent: newRent.toString() },
        metadata: {
          source: context.source,
          contractId: current.id,
          appliedPeriod,
          previousRent: currentRent.toString(),
          newRent: newRent.toString(),
          delta: delta.toString(),
          percentage: percentage.toDecimalPlaces(4).toString(),
          nextAdjustmentDate: nextDate.toISOString(),
          provisional: loaded.isProvisional,
          fixedInitial: loaded.fixedInitial,
          estimatedPeriods: loaded.estimated,
          lagMonths: loaded.rules.indexLagMonths,
        },
      });

      outcome = {
        contractId: current.id,
        scheduleId: schedule.id,
        periodNumber: schedule.periodNumber,
        appliedPeriod,
        status: loaded.fixedInitial ? 'fixed_initial' : loaded.isProvisional ? 'provisional' : 'applied',
        previousRent: currentRent.toString(),
        newRent: newRent.toString(),
        deltaAmount: delta.toDecimalPlaces(2).toString(),
        percentage: percentage.toDecimalPlaces(4).toString(),
        estimatedPeriods: [...new Set(loaded.estimated.map((e) => e.period))],
        adjustmentId,
      };
    });

    this.logger.log('Applied due adjustment', {
      contractId: outcome.contractId,
      tenantId: context.tenantId,
      appliedPeriod,
      scheduleId: schedule.id,
      status: outcome.status,
    });
    return outcome;
  }

  /** Motivo con que se informa un ajuste que no se pudo aplicar. */
  skipReason(err: unknown): AdjustmentSkipped['reason'] {
    if (err instanceof MissingIndexDataError) return MISSING_INDEX_DATA;
    const code = (err as any)?.getResponse?.()?.error;
    return typeof code === 'string' ? code : 'ADJUSTMENT_FAILED';
  }

  // ─── Correcciones pendientes de facturar ──────────────────────────────────

  /**
   * Correcciones de ajustes provisorios que todavía no se facturaron, de un
   * contrato de la inmobiliaria actual. `upTo` (`YYYY-MM`, por defecto el mes
   * actual) es el último mes que ya se facturó con el alquiler provisorio: la
   * liquidación de un período pide hasta el mes anterior, porque el propio
   * período ya sale con el alquiler corregido.
   */
  async getPendingTrueUps(contractId: string, upTo?: string): Promise<PendingTrueUp[]> {
    const finals = await this.prisma.client.contractAdjustment.findMany({
      where: { contractId, trueUpOfId: { not: null }, trueUpBilledAt: null },
      orderBy: { periodNumber: 'asc' },
    });
    if (finals.length === 0) return [];
    const provisionals = await this.prisma.client.contractAdjustment.findMany({
      where: { id: { in: finals.map((f) => f.trueUpOfId as string) } },
    });
    const toPeriod = upTo ?? periodKey(todayInAR());

    return finals.flatMap((final) => {
      const provisional = provisionals.find((p) => p.id === final.trueUpOfId);
      if (!provisional) return [];
      const effectiveFrom = periodKey(final.adjustmentDate);
      const trueUp = calculateTrueUp({
        provisionalRent: new Decimal(provisional.newAmount.toString()),
        officialRent: new Decimal(final.newAmount.toString()),
        fromPeriod: effectiveFrom,
        toPeriod,
      });
      return [
        {
          adjustmentId: final.id,
          provisionalAdjustmentId: provisional.id,
          contractId: final.contractId,
          periodNumber: final.periodNumber,
          effectiveFrom,
          provisionalRent: provisional.newAmount.toString(),
          officialRent: final.newAmount.toString(),
          monthlyDelta: trueUp.monthlyDelta.toFixed(2),
          months: trueUp.months.map((m) => ({ period: m.period, delta: m.delta.toFixed(2) })),
          total: trueUp.total.toFixed(2),
        },
      ];
    });
  }

  /**
   * Marca facturadas las correcciones (`PendingTrueUp.adjustmentId`) que una
   * liquidación ya incluyó. Se llama dentro de la misma transacción que crea la
   * liquidación; marca una sola vez, así una corrección no se factura dos veces.
   */
  async markTrueUpBilled(adjustmentIds: string[], tx: any = this.prisma.client): Promise<number> {
    if (adjustmentIds.length === 0) return 0;
    const result = await tx.contractAdjustment.updateMany({
      where: { id: { in: adjustmentIds }, trueUpOfId: { not: null }, trueUpBilledAt: null },
      data: { trueUpBilledAt: new Date() },
    });
    return result.count;
  }

  /**
   * Deshace `markTrueUpBilled`: las correcciones vuelven a quedar pendientes cuando la
   * liquidación que las traía se anula o se borra, o se quita su renglón.
   */
  async releaseTrueUps(adjustmentIds: string[], tx: any = this.prisma.client): Promise<number> {
    if (adjustmentIds.length === 0) return 0;
    const result = await tx.contractAdjustment.updateMany({
      where: { id: { in: adjustmentIds }, trueUpOfId: { not: null }, trueUpBilledAt: { not: null } },
      data: { trueUpBilledAt: null },
    });
    return result.count;
  }

  // ─── Barrido de ajustes vencidos ───────────────────────────────────────────

  /**
   * Aplica los ajustes vencidos hasta `until` de contratos activos de la
   * inmobiliaria `tenantId` (debe correr dentro de su contexto, como lo deja
   * `TenantCron`). Lo usan el proceso diario (hasta hoy) y la generación de
   * liquidaciones (hasta el fin del mes que se liquida, DEF-130).
   * Cada contrato en su propia transacción: si falta algún índice que la
   * modalidad necesita, el cronograma se salta (sigue pendiente), no se toca el
   * alquiler y se informa con `MISSING_INDEX_DATA` y los meses que faltan.
   */
  async applyDueAdjustments(
    tenantId: string,
    until: Date = endOfTodayInAR(),
    source: 'cron' | 'generation' = 'cron',
  ): Promise<AdjustmentRun> {
    const dueSchedules = await this.prisma.client.adjustmentSchedule.findMany({
      where: {
        status: ScheduleStatus.Pending,
        nextAdjustmentDate: { lte: until },
        contract: {
          status: ContractStatus.Activo,
          isActive: true,
        },
      },
      include: {
        contract: true,
      },
      orderBy: { nextAdjustmentDate: 'asc' },
    });

    const run: AdjustmentRun = { applied: [], skipped: [] };
    if (dueSchedules.length === 0) return run;
    const allowProvisional = await this.isProvisionalAllowed(tenantId);

    for (const schedule of dueSchedules) {
      const contractId = schedule.contract?.id ?? schedule.contractId;
      const appliedPeriod = schedule.nextAdjustmentDate.toISOString().slice(0, 7);
      try {
        run.applied.push(
          await this.applySchedule(schedule, { tenantId, source, allowProvisional }),
        );
      } catch (err: unknown) {
        if (err instanceof MissingIndexDataError) {
          this.logger.warn(`${MISSING_INDEX_DATA}: ajuste pendiente por falta de índices`, {
            code: MISSING_INDEX_DATA,
            contractId,
            tenantId,
            scheduleId: schedule.id,
            appliedPeriod,
            indexTypes: err.indexTypes,
            missingPeriods: err.missingPeriods,
          });
          run.skipped.push({
            contractId,
            scheduleId: schedule.id,
            appliedPeriod,
            reason: MISSING_INDEX_DATA,
            indexTypes: err.indexTypes,
            missingPeriods: err.missingPeriods,
          });
          continue;
        }
        this.logger.error(
          `Failed to apply adjustment for contract ${contractId}`,
          (err as Error).stack,
        );
        run.skipped.push({
          contractId,
          scheduleId: schedule.id,
          appliedPeriod,
          reason: this.skipReason(err),
        });
      }
    }

    return run;
  }
}

/** Último instante del día de hoy en Buenos Aires (las fechas sin hora se guardan a medianoche UTC). */
function endOfTodayInAR(): Date {
  return new Date(todayInAR().getTime() + 86_400_000 - 1);
}
