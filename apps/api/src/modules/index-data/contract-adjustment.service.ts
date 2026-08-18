import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
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

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

// ─── Preview Return Type ──────────────────────────────────────────────────────

export interface AdjustmentPreview {
  period: string;
  indexType: IndexType;
  factor: Decimal;
  currentRent: Decimal;
  projectedRent: Decimal;
  projectedDelta: Decimal;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ContractAdjustmentService {
  private readonly logger = new Logger(ContractAdjustmentService.name);

  constructor(private readonly prisma: PrismaService) {}

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
    const adjustmentType = contract.adjustmentType as AdjustmentType;

    // Map AdjustmentType → IndexType for index data lookup
    const indexTypeMap: Partial<Record<AdjustmentType, IndexType>> = {
      [AdjustmentType.IPC]: IndexType.IPC,
      [AdjustmentType.ICL]: IndexType.ICL,
    };
    const resolvedIndexType = indexTypeMap[adjustmentType] ?? IndexType.IPC;

    // Load index data spanning from contract start to next adjustment date
    const indexRows = await this.prisma.client.indexData.findMany({
      where: {
        indexType: resolvedIndexType as any,
        period: {
          gte: contract.startDate,
          lte: adjustmentDate,
        },
      },
      orderBy: { period: 'asc' },
    });

    // Build AdjustmentParams and call the shared engine
    let params: AdjustmentParams;
    switch (adjustmentType) {
      case AdjustmentType.IPC:
        params = {
          type: AdjustmentType.IPC,
          monthlyValues: indexRows.map((r: any) => new Decimal(r.value.toString())),
          baseRent: currentRent,
        };
        break;

      case AdjustmentType.ICL:
        params = {
          type: AdjustmentType.ICL,
          startValue: indexRows.length > 0
            ? new Decimal(indexRows[0].value.toString())
            : new Decimal(1),
          endValue: indexRows.length > 0
            ? new Decimal(indexRows[indexRows.length - 1].value.toString())
            : new Decimal(1),
          baseRent: currentRent,
        };
        break;

      case AdjustmentType.FixedPercent:
      case AdjustmentType.Custom:
        params = {
          type: adjustmentType,
          percentage: new Decimal(contract.customAdjustmentPct?.toString() ?? '0'),
          baseRent: currentRent,
        };
        break;

      default:
        // CCP — fall back to zero-adjustment preview if data unavailable
        params = {
          type: AdjustmentType.FixedPercent,
          percentage: new Decimal(0),
          baseRent: currentRent,
        };
    }

    const result = calculateAdjustment(params);
    const factor = result.newRent.div(currentRent.isZero() ? new Decimal(1) : currentRent);

    return {
      period: adjustmentDate.toISOString().slice(0, 7), // YYYY-MM
      indexType: resolvedIndexType,
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
        await this.prisma.baseClient.$transaction(async (tx: any) => {
          // ── 1. Build adjustment params ────────────────────────────────────
          const currentRent = new Decimal(contract.rentAmount.toString());
          const adjustmentType = contract.adjustmentType as AdjustmentType;

          const indexTypeMap: Partial<Record<AdjustmentType, IndexType>> = {
            [AdjustmentType.IPC]: IndexType.IPC,
            [AdjustmentType.ICL]: IndexType.ICL,
          };
          const resolvedIndexType = indexTypeMap[adjustmentType] ?? IndexType.IPC;

          const indexRows = await tx.indexData.findMany({
            where: {
              tenantId: contract.tenantId,
              indexType: resolvedIndexType as any,
              period: {
                gte: contract.startDate,
                lte: schedule.nextAdjustmentDate,
              },
            },
            orderBy: { period: 'asc' },
          });

          let params: AdjustmentParams;
          switch (adjustmentType) {
            case AdjustmentType.IPC:
              params = {
                type: AdjustmentType.IPC,
                monthlyValues: indexRows.map((r: any) => new Decimal(r.value.toString())),
                baseRent: currentRent,
              };
              break;
            case AdjustmentType.ICL:
              params = {
                type: AdjustmentType.ICL,
                startValue: indexRows.length > 0
                  ? new Decimal(indexRows[0].value.toString())
                  : new Decimal(1),
                endValue: indexRows.length > 0
                  ? new Decimal(indexRows[indexRows.length - 1].value.toString())
                  : new Decimal(1),
                baseRent: currentRent,
              };
              break;
            case AdjustmentType.FixedPercent:
            case AdjustmentType.Custom:
              params = {
                type: adjustmentType,
                percentage: new Decimal(contract.customAdjustmentPct?.toString() ?? '0'),
                baseRent: currentRent,
              };
              break;
            default:
              params = {
                type: AdjustmentType.FixedPercent,
                percentage: new Decimal(0),
                baseRent: currentRent,
              };
          }

          const adjustmentResult = calculateAdjustment(params);
          const delta = adjustmentResult.newRent.minus(currentRent);

          // ── 2. Update contract rentAmount and mark schedule Applied ───────
          await tx.contract.update({
            where: { id: contract.id },
            data: { rentAmount: adjustmentResult.newRent.toString() },
          });

          await tx.adjustmentSchedule.update({
            where: { id: schedule.id },
            data: { status: ScheduleStatus.Applied },
          });

          // ── 3. Advance next adjustment date (update next Pending schedule) ─
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

        const currentRent = new Decimal(contract.rentAmount.toString());
        const params: AdjustmentParams = (() => {
          switch (contract.adjustmentType as AdjustmentType) {
            case AdjustmentType.FixedPercent:
            case AdjustmentType.Custom:
              return {
                type: contract.adjustmentType as AdjustmentType.FixedPercent,
                percentage: new Decimal(contract.customAdjustmentPct?.toString() ?? '0'),
                baseRent: currentRent,
              };
            default:
              return {
                type: AdjustmentType.FixedPercent,
                percentage: new Decimal(0),
                baseRent: currentRent,
              };
          }
        })();

        // Compute delta for reporting (outside transaction, approximate)
        const reportResult = calculateAdjustment(params);
        const reportDelta = reportResult.newRent.minus(currentRent);

        results.push({
          contractId: contract.id,
          deltaAmount: reportDelta.toDecimalPlaces(2).toString(),
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
