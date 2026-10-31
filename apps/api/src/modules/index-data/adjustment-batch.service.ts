import { HttpException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ContractStatus, ScheduleStatus, calculateAdjustment } from '@realfy/shared';
import type {
  AdjustmentApplyBatch,
  AdjustmentApplyResult,
  AdjustmentPreviewBatch,
  AdjustmentPreviewRow,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { resolveAdjustmentWindow } from './adjustment-window';
import {
  ContractAdjustmentService,
  MISSING_INDEX_DATA,
  MissingIndexDataError,
} from './contract-adjustment.service';

/** Último instante del mes `YYYY-MM` en UTC. */
function endOfMonth(period: string): Date {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1) - 1);
}

/**
 * Aplicación masiva de los ajustes del mes (FB-23): en lugar de cargar uno por
 * uno, se previsualizan los de todos los contratos con un ajuste que vence en
 * el mes (o venía atrasado), se eligen y se aplican. Cada contrato se aplica en
 * su propia transacción y el resultado se informa por contrato.
 */
@Injectable()
export class AdjustmentBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly adjustments: ContractAdjustmentService,
  ) {}

  /** El primer cronograma pendiente de cada contrato activo con vencimiento hasta el fin del mes. */
  private async dueSchedules(period: string) {
    const schedules = await this.prisma.client.adjustmentSchedule.findMany({
      where: {
        status: ScheduleStatus.Pending,
        nextAdjustmentDate: { lte: endOfMonth(period) },
        contract: { status: ContractStatus.Activo, isActive: true },
      },
      include: {
        contract: { include: { property: { select: { id: true, title: true } } } },
      },
      orderBy: [{ nextAdjustmentDate: 'asc' }, { periodNumber: 'asc' }],
    });
    // Un contrato atrasado puede tener varios pendientes; cada pasada toma el
    // más antiguo, porque el siguiente parte del alquiler que deja este.
    const seen = new Set<string>();
    return schedules.filter((s) => (seen.has(s.contractId) ? false : (seen.add(s.contractId), true)));
  }

  async preview(period: string): Promise<AdjustmentPreviewBatch> {
    const tenantId = this.requireTenant();
    const schedules = await this.dueSchedules(period);
    const allowProvisional =
      schedules.length > 0 ? await this.adjustments.isProvisionalAllowed(tenantId) : true;
    const monthStart = new Date(`${period}-01T00:00:00.000Z`);

    const rows: AdjustmentPreviewRow[] = [];
    for (const schedule of schedules) {
      const contract = schedule.contract;
      const currentRent = new Decimal(contract.rentAmount.toString());
      const row: AdjustmentPreviewRow = {
        contractId: contract.id,
        scheduleId: schedule.id,
        periodNumber: schedule.periodNumber,
        adjustmentDate: schedule.nextAdjustmentDate.toISOString(),
        overdue: schedule.nextAdjustmentDate < monthStart,
        propertyTitle: contract.property?.title ?? null,
        adjustmentType: contract.adjustmentType,
        currency: contract.rentCurrency,
        currentRent: currentRent.toFixed(2),
        newRent: null,
        percentage: null,
        factor: null,
        status: 'error',
        isProvisional: false,
        estimatedPeriods: [],
        indexValues: [],
        missing: null,
        error: null,
        selectable: false,
      };

      try {
        const window = await resolveAdjustmentWindow(
          this.prisma.client,
          contract,
          schedule.nextAdjustmentDate,
        );
        const loaded = await this.adjustments.loadParams(contract, window, { tenantId, allowProvisional });
        const result = calculateAdjustment(loaded.params);
        const newRent = loaded.fixedInitial ? currentRent : result.newRent;
        row.newRent = newRent.toFixed(2);
        row.percentage = (loaded.fixedInitial ? new Decimal(0) : result.percentage).toFixed(4);
        row.factor = newRent.div(currentRent.isZero() ? new Decimal(1) : currentRent).toFixed(6);
        row.isProvisional = loaded.isProvisional;
        row.estimatedPeriods = [...new Set(loaded.estimated.map((e) => e.period))];
        row.indexValues = loaded.observations;
        row.status = loaded.fixedInitial ? 'fixed_initial' : loaded.isProvisional ? 'provisional' : 'ready';
        row.selectable = true;
      } catch (err) {
        if (err instanceof MissingIndexDataError) {
          row.status = 'missing_data';
          row.missing = {
            indexTypes: err.indexTypes,
            missingPeriods: err.missingPeriods,
            estimatesOnly: err.estimatesOnly,
          };
        } else if (err instanceof HttpException) {
          row.error = this.adjustments.skipReason(err);
        } else {
          throw err;
        }
      }
      rows.push(row);
    }

    return { period, rows };
  }

  async apply(period: string, contractIds: string[]): Promise<AdjustmentApplyBatch> {
    const tenantId = this.requireTenant();
    const userId = this.tenantContext.getUserId() ?? null;
    const byContract = new Map((await this.dueSchedules(period)).map((s) => [s.contractId, s]));
    const allowProvisional = await this.adjustments.isProvisionalAllowed(tenantId);

    const results: AdjustmentApplyResult[] = [];
    for (const contractId of [...new Set(contractIds)]) {
      const schedule = byContract.get(contractId);
      if (!schedule) {
        const exists = await this.prisma.client.contract.findFirst({
          where: { id: contractId },
          select: { id: true },
        });
        results.push(
          this.skipped(contractId, exists ? 'NO_DUE_ADJUSTMENT' : 'CONTRACT_NOT_FOUND'),
        );
        continue;
      }
      try {
        const applied = await this.adjustments.applySchedule(schedule, {
          tenantId,
          source: 'batch',
          userId,
          allowProvisional,
        });
        results.push({
          contractId,
          result: 'applied',
          status: applied.status,
          reason: null,
          previousRent: applied.previousRent,
          newRent: applied.newRent,
          estimatedPeriods: applied.estimatedPeriods,
          missingPeriods: [],
          indexTypes: [],
        });
      } catch (err) {
        const entry = this.skipped(contractId, this.adjustments.skipReason(err));
        if (err instanceof MissingIndexDataError) {
          entry.indexTypes = err.indexTypes;
          entry.missingPeriods = err.missingPeriods;
          entry.reason = MISSING_INDEX_DATA;
        } else if (!(err instanceof HttpException)) {
          throw err;
        }
        results.push(entry);
      }
    }
    return { period, results };
  }

  private skipped(contractId: string, reason: string): AdjustmentApplyResult {
    return {
      contractId,
      result: 'skipped',
      status: null,
      reason,
      previousRent: null,
      newRent: null,
      estimatedPeriods: [],
      missingPeriods: [],
      indexTypes: [],
    };
  }

  private requireTenant(): string {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) throw new Error('Adjustment batch requires a tenant context');
    return tenantId;
  }
}
