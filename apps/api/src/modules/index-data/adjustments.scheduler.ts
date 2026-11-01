import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AR_TIME_ZONE } from '@realfy/shared';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { TenantCron } from '../../common/scheduler/tenant-cron';
import {
  AdjustmentApplied,
  AdjustmentSkipped,
  ContractAdjustmentService,
} from './contract-adjustment.service';
import { AdjustmentTrueUpService, TrueUpApplied, TrueUpWaiting } from './adjustment-trueup.service';

export interface AdjustmentsRunSummary {
  tenantsProcessed: number;
  tenantsFailed: number;
  applied: AdjustmentApplied[];
  /** Ajustes que siguen pendientes, con los índices y meses que faltan. */
  skipped: AdjustmentSkipped[];
  trueUps: TrueUpApplied[];
  /** Provisorios que siguen esperando algún valor oficial. */
  trueUpsWaiting: TrueUpWaiting[];
}

/**
 * Todos los días a las 07:00 de Buenos Aires, después de la lectura de índices
 * de las 06:00: aplica los ajustes vencidos de cada inmobiliaria (con el índice
 * oficial, definitivos; solo con estimados, provisorios si la inmobiliaria
 * permite el pago a cuenta) y corrige los provisorios cuyo índice oficial ya se
 * publicó. Los contratos que quedan sin ajustar por falta de índice se informan.
 */
@Injectable()
export class AdjustmentsScheduler extends CronBaseService {
  protected readonly logger = new Logger(AdjustmentsScheduler.name);

  constructor(
    private readonly tenantCron: TenantCron,
    private readonly adjustments: ContractAdjustmentService,
    private readonly trueUps: AdjustmentTrueUpService,
  ) {
    super();
  }

  @Cron('0 7 * * *', { name: 'adjustments-daily', timeZone: AR_TIME_ZONE })
  async handleDailyAdjustments(): Promise<void> {
    await this.runGuarded(async () => {
      await this.run();
    }, 'adjustments-daily');
  }

  /** Lo que ejecutan el cron y `POST /adjustments/_run-now`. */
  async run(): Promise<AdjustmentsRunSummary> {
    const start = Date.now();
    const summary: AdjustmentsRunSummary = {
      tenantsProcessed: 0,
      tenantsFailed: 0,
      applied: [],
      skipped: [],
      trueUps: [],
      trueUpsWaiting: [],
    };

    const tenants = await this.tenantCron.forEachActiveTenant('adjustments-daily', async (tenantId) => {
      const due = await this.adjustments.applyDueAdjustments(tenantId);
      const corrected = await this.trueUps.correctProvisionals(tenantId);
      summary.applied.push(...due.applied);
      summary.skipped.push(...due.skipped);
      summary.trueUps.push(...corrected.corrected);
      summary.trueUpsWaiting.push(...corrected.waiting);

      if (due.skipped.length > 0) {
        this.logger.warn(
          `Adjustments pending for lack of index data: tenantId=${tenantId} contracts=${due.skipped
            .map((s) => `${s.contractId}(${(s.missingPeriods ?? []).join(',')})`)
            .join(' ')}`,
        );
      }
    });
    summary.tenantsProcessed = tenants.ok;
    summary.tenantsFailed = tenants.failed;

    this.logger.log(
      `Adjustments run completed in ${Date.now() - start}ms — tenants=${tenants.ok}, applied=${summary.applied.length}, skipped=${summary.skipped.length}, trueUps=${summary.trueUps.length}`,
    );
    return summary;
  }
}
