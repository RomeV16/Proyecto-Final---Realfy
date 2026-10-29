import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IndexDataService } from './index-data.service';
import { AdjustmentWindow, excludesWindowStart, resolveAdjustmentWindow } from './adjustment-window';
import {
  AdjustmentType,
  AdjustmentPeriod,
  ContractStatus,
  IndexType,
  ScheduleStatus,
  calculateAdjustment,
} from '@realfy/shared';
import type { AdjustmentParams } from '@realfy/shared';
import Decimal from 'decimal.js';

// ─── Helpers (module-private) ─────────────────────────────────────────────────

function periodToMonths(period: AdjustmentPeriod): number {
  switch (period) {
    case AdjustmentPeriod.Mensual:      return 1;
    case AdjustmentPeriod.Bimestral:   return 2;
    case AdjustmentPeriod.Trimestral:  return 3;
    case AdjustmentPeriod.Cuatrimestral: return 4;
    case AdjustmentPeriod.Semestral:   return 6;
    case AdjustmentPeriod.Anual:       return 12;
    default:                            return 3;
  }
}

/**
 * Suma meses en UTC recortando al último día del mes destino: 31 de enero
 * más un mes es 28 (o 29) de febrero, no 3 de marzo (DEF-05). Se opera en
 * UTC porque las fechas de cronograma se guardan a medianoche UTC y la
 * aritmética en hora local las corría un día en UTC-3.
 */
function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(date.getUTCDate(), lastDayOfTarget),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

const toDecimal = (row: { value: unknown }) => new Decimal(String(row.value));

// ─── Preview Return Type ──────────────────────────────────────────────────────

export interface AdjustmentPreview {
  period: string;
  indexType: IndexType;
  factor: Decimal;
  currentRent: Decimal;
  projectedRent: Decimal;
  projectedDelta: Decimal;
}

interface LoadedParams {
  params: AdjustmentParams;
  /** Índice principal usado, para informar en la previsualización. */
  indexType: IndexType;
}

type IndexClient = { indexData: { findMany: (args: any) => Promise<any[]> } };

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ContractAdjustmentService {
  private readonly logger = new Logger(ContractAdjustmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexData: IndexDataService,
  ) {}

  /**
   * Arma los parámetros del motor según la modalidad del contrato, leyendo
   * los índices de la ventana del ajuste (desde el último ajuste aplicado o el
   * inicio del contrato, DEF-07) a través de IndexDataService, que une los
   * valores propios con los de sistema.
   * Es el único lugar donde se traduce modalidad → parámetros: lo comparten
   * la previsualización y la aplicación automática (DEF-02, DEF-03).
   */
  private async loadParams(
    contract: any,
    window: AdjustmentWindow,
    options: { tenantId: string; client?: IndexClient },
  ): Promise<LoadedParams> {
    const baseRent = new Decimal(contract.rentAmount.toString());
    const adjustmentType = contract.adjustmentType as AdjustmentType;
    const load = (type: IndexType) =>
      this.indexData.getForPeriod(
        type,
        window.from,
        window.until,
        excludesWindowStart(window, type) ? { ...options, startExclusive: true } : options,
      );

    switch (adjustmentType) {
      case AdjustmentType.IPC: {
        const rows = await load(IndexType.IPC);
        return {
          indexType: IndexType.IPC,
          params: { type: AdjustmentType.IPC, monthlyValues: rows.map(toDecimal), baseRent },
        };
      }
      case AdjustmentType.ICL: {
        const rows = await load(IndexType.ICL);
        return {
          indexType: IndexType.ICL,
          params: {
            type: AdjustmentType.ICL,
            startValue: rows.length > 0 ? toDecimal(rows[0]) : new Decimal(1),
            endValue: rows.length > 0 ? toDecimal(rows[rows.length - 1]) : new Decimal(1),
            baseRent,
          },
        };
      }
      case AdjustmentType.CCP: {
        const [cvs, cer] = await Promise.all([load(IndexType.CVS), load(IndexType.CER)]);
        const length = Math.min(cvs.length, cer.length);
        return {
          indexType: IndexType.CVS,
          params: {
            type: AdjustmentType.CCP,
            cvsPcts: cvs.slice(0, length).map(toDecimal),
            cerPcts: cer.slice(0, length).map(toDecimal),
            baseRent,
          },
        };
      }
      case AdjustmentType.FixedPercent:
      case AdjustmentType.Custom:
        return {
          indexType: IndexType.IPC,
          params: {
            type: adjustmentType,
            percentage: new Decimal(contract.customAdjustmentPct?.toString() ?? '0'),
            baseRent,
          },
        };
      default:
        return {
          indexType: IndexType.IPC,
          params: { type: AdjustmentType.FixedPercent, percentage: new Decimal(0), baseRent },
        };
    }
  }

  // ─── Preview ───────────────────────────────────────────────────────────────

  /**
   * Read-only preview: computes the adjustment factor and projected rent for
   * a contract's next pending schedule entry.  Does NOT mutate anything.
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
    const { params, indexType } = await this.loadParams(contract, window, {
      tenantId: contract.tenantId,
    });

    const result = calculateAdjustment(params);
    const factor = result.newRent.div(currentRent.isZero() ? new Decimal(1) : currentRent);

    return {
      period: adjustmentDate.toISOString().slice(0, 7), // YYYY-MM
      indexType,
      factor,
      currentRent,
      projectedRent: result.newRent,
      projectedDelta: result.newRent.minus(currentRent),
    };
  }

  // ─── Apply Due Adjustments ─────────────────────────────────────────────────

  /**
   * Scans contracts where the next pending AdjustmentSchedule.nextAdjustmentDate
   * <= today AND contract.status = Active.  For each, computes the adjustment
   * factor, updates the contract rent, advances the schedule status to Applied,
   * and logs the result.
   *
   * Returns a summary array — one entry per contract processed.
   */
  async applyDueAdjustments(): Promise<
    { contractId: string; deltaAmount: string; appliedPeriod: string }[]
  > {
    const today = new Date();

    // Find due adjustment schedules for active contracts.
    // System-wide sweep across every inmobiliaria — reads through baseClient and
    // scopes each contract's own queries by contract.tenantId below.
    const dueSchedules = await this.prisma.baseClient.adjustmentSchedule.findMany({
      where: {
        status: ScheduleStatus.Pending,
        nextAdjustmentDate: { lte: today },
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

    const results: { contractId: string; deltaAmount: string; appliedPeriod: string }[] = [];

    for (const schedule of dueSchedules) {
      const contract = schedule.contract as any;
      const appliedPeriod = schedule.nextAdjustmentDate.toISOString().slice(0, 7);

      try {
        // El delta se calcula una sola vez, dentro de la transacción, y es el
        // que se informa (DEF-02).
        let delta = new Decimal(0);

        await this.prisma.baseClient.$transaction(async (tx: any) => {
          // Se relee el contrato: si el barrido se pone al día con dos ajustes
          // del mismo contrato, el segundo parte del alquiler que dejó el
          // primero y no del leído antes de empezar (DEF-08).
          const current =
            (await tx.contract.findUnique({ where: { id: contract.id } })) ?? contract;
          const currentRent = new Decimal(current.rentAmount.toString());
          const window = await resolveAdjustmentWindow(tx, current, schedule.nextAdjustmentDate);
          const { params } = await this.loadParams(current, window, {
            tenantId: contract.tenantId,
            client: tx,
          });

          const adjustmentResult = calculateAdjustment(params);
          delta = adjustmentResult.newRent.minus(currentRent);

          // ── Update contract rentAmount and mark schedule Applied ──────────
          await tx.contract.update({
            where: { id: contract.id },
            data: { rentAmount: adjustmentResult.newRent.toString() },
          });

          await tx.adjustmentSchedule.update({
            where: { id: schedule.id },
            data: { status: ScheduleStatus.Applied },
          });

          // ── Advance next adjustment date ──────────────────────────────────
          const months = periodToMonths(contract.adjustmentPeriod as AdjustmentPeriod);
          const nextDate = addMonths(schedule.nextAdjustmentDate, months);

          // Create audit log entry via baseClient (no tenant context in batch job)
          await tx.auditLog.create({
            data: {
              tenantId: contract.tenantId,
              userId: null,
              action: 'UPDATE',
              entity: 'adjustment_applied',
              entityId: contract.id,
              changes: {
                contractId: contract.id,
                appliedPeriod,
                previousRent: currentRent.toString(),
                newRent: adjustmentResult.newRent.toString(),
                delta: delta.toString(),
                nextAdjustmentDate: nextDate.toISOString(),
              },
            },
          });
        });

        results.push({
          contractId: contract.id,
          deltaAmount: delta.toDecimalPlaces(2).toString(),
          appliedPeriod,
        });

        this.logger.log('Applied due adjustment', {
          contractId: contract.id,
          tenantId: contract.tenantId,
          appliedPeriod,
          scheduleId: schedule.id,
        });
      } catch (err: unknown) {
        this.logger.error(
          `Failed to apply adjustment for contract ${contract.id}`,
          (err as Error).stack,
        );
      }
    }

    return results;
  }
}
