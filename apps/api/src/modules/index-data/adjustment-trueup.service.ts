import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { calculateAdjustment, calculateTrueUp, periodKey, todayInAR } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { resolveAdjustmentWindow } from './adjustment-window';
import { ContractAdjustmentService, MissingIndexDataError } from './contract-adjustment.service';

/** Ajuste provisorio ya corregido con los valores oficiales. */
export interface TrueUpApplied {
  contractId: string;
  provisionalAdjustmentId: string;
  adjustmentId: string;
  periodNumber: number;
  provisionalRent: string;
  officialRent: string;
  monthlyDelta: string;
  /** Meses de la diferencia hasta hoy; la liquidación toma lo que le toque. */
  retroactiveTotal: string;
  /** El alquiler del contrato pasó al oficial; falso si ya hubo ajustes posteriores (se revisa a mano). */
  rentUpdated: boolean;
}

/** Ajuste provisorio que sigue esperando algún valor oficial. */
export interface TrueUpWaiting {
  contractId: string;
  provisionalAdjustmentId: string;
  missingPeriods: string[];
}

export interface TrueUpRun {
  corrected: TrueUpApplied[];
  waiting: TrueUpWaiting[];
}

/**
 * Corrige los ajustes provisorios cuando ya están publicados todos los índices
 * oficiales que habían sido estimados (ADR-0011).
 *
 * Por cada provisorio sin corregir recalcula el ajuste con los valores de hoy,
 * sin estimados y partiendo del alquiler anterior al provisorio. Si ya hay
 * oficial para todos los meses crea el ajuste definitivo, enlazado por
 * `trueUpOfId`, y deja el alquiler en el valor oficial. No crea cargos en
 * liquidaciones: la diferencia retroactiva queda disponible en
 * `ContractAdjustmentService.getPendingTrueUps` para el armado de liquidaciones.
 */
@Injectable()
export class AdjustmentTrueUpService {
  private readonly logger = new Logger(AdjustmentTrueUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adjustments: ContractAdjustmentService,
    private readonly audit: AuditService,
  ) {}

  /** Debe correr dentro del contexto de la inmobiliaria `tenantId` (como lo deja `TenantCron`). */
  async correctProvisionals(tenantId: string): Promise<TrueUpRun> {
    const run: TrueUpRun = { corrected: [], waiting: [] };

    const provisionals = await this.prisma.client.contractAdjustment.findMany({
      where: { isProvisional: true },
      orderBy: [{ contractId: 'asc' }, { periodNumber: 'asc' }],
    });
    if (provisionals.length === 0) return run;

    const alreadyCorrected = await this.prisma.client.contractAdjustment.findMany({
      where: { trueUpOfId: { in: provisionals.map((p) => p.id) } },
      select: { trueUpOfId: true },
    });
    const corrected = new Set(alreadyCorrected.map((c) => c.trueUpOfId));

    for (const provisional of provisionals.filter((p) => !corrected.has(p.id))) {
      try {
        const outcome = await this.correct(provisional, tenantId);
        if (outcome) run.corrected.push(outcome);
      } catch (err) {
        if (err instanceof MissingIndexDataError) {
          run.waiting.push({
            contractId: provisional.contractId,
            provisionalAdjustmentId: provisional.id,
            missingPeriods: err.missingPeriods,
          });
          continue;
        }
        this.logger.error(
          `Failed to correct provisional adjustment ${provisional.id}`,
          (err as Error).stack,
        );
      }
    }
    return run;
  }

  private async correct(provisional: any, tenantId: string): Promise<TrueUpApplied | null> {
    let outcome: TrueUpApplied | null = null;

    await this.prisma.client.$transaction(async (tx: any) => {
      const contract = await tx.contract.findUnique({ where: { id: provisional.contractId } });
      if (!contract) return;

      // Con los valores de hoy y el alquiler de antes del provisorio. Si todavía
      // falta algún oficial lanza MissingIndexDataError (allowProvisional: false).
      const window = await resolveAdjustmentWindow(tx, contract, provisional.adjustmentDate);
      const loaded = await this.adjustments.loadParams(
        { ...contract, rentAmount: provisional.previousAmount },
        window,
        { tenantId, client: tx, allowProvisional: false },
      );
      const official = calculateAdjustment(loaded.params);

      const provisionalRent = new Decimal(provisional.newAmount.toString());
      const trueUp = calculateTrueUp({
        provisionalRent,
        officialRent: official.newRent,
        fromPeriod: periodKey(provisional.adjustmentDate),
        toPeriod: periodKey(todayInAR()),
      });

      const created = await tx.contractAdjustment.create({
        data: {
          tenantId,
          contractId: contract.id,
          periodNumber: provisional.periodNumber,
          adjustmentDate: provisional.adjustmentDate,
          previousAmount: provisional.previousAmount.toString(),
          newAmount: official.newRent.toString(),
          percentage: official.percentage.toDecimalPlaces(4).toString(),
          currency: provisional.currency,
          indexType: provisional.indexType,
          indexValues: this.adjustments.buildIndexValues(loaded) as any,
          notes: 'TRUE_UP',
          calculatedAt: new Date(),
          appliedAt: new Date(),
          isProvisional: false,
          trueUpOfId: provisional.id,
        },
      });

      // El alquiler pasa al oficial solo si el provisorio sigue siendo lo vigente:
      // con ajustes posteriores el contrato ya partió de otro valor y se revisa a mano.
      const later = await tx.contractAdjustment.findFirst({
        where: { contractId: contract.id, periodNumber: { gt: provisional.periodNumber }, appliedAt: { not: null } },
      });
      const stillCurrent =
        !later && new Decimal(contract.rentAmount.toString()).equals(provisionalRent);
      if (stillCurrent) {
        await tx.contract.update({
          where: { id: contract.id },
          data: { rentAmount: official.newRent.toString() },
        });
      }

      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'adjustment_trued_up',
        entityId: contract.id,
        userId: null,
        tenantId,
        before: { rent: provisionalRent.toString() },
        after: { rent: official.newRent.toString() },
        metadata: {
          source: 'cron',
          provisionalAdjustmentId: provisional.id,
          adjustmentId: created?.id ?? null,
          periodNumber: provisional.periodNumber,
          monthlyDelta: trueUp.monthlyDelta.toString(),
          retroactiveTotal: trueUp.total.toString(),
          rentUpdated: stillCurrent,
        },
      });

      outcome = {
        contractId: contract.id,
        provisionalAdjustmentId: provisional.id,
        adjustmentId: created?.id ?? '',
        periodNumber: provisional.periodNumber,
        provisionalRent: provisionalRent.toString(),
        officialRent: official.newRent.toString(),
        monthlyDelta: trueUp.monthlyDelta.toFixed(2),
        retroactiveTotal: trueUp.total.toFixed(2),
        rentUpdated: stillCurrent,
      };
    });

    if (outcome) {
      this.logger.log('Corrected provisional adjustment', {
        tenantId,
        contractId: (outcome as TrueUpApplied).contractId,
        provisionalAdjustmentId: provisional.id,
      });
    }
    return outcome;
  }
}
