import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AR_TIME_ZONE, todayInAR } from '@realfy/shared';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { TenantCron } from '../../common/scheduler/tenant-cron';
import { FollowUpsService } from './follow-ups.service';

export interface FollowUpsRunSummary {
  tenantsProcessed: number;
  tenantsFailed: number;
  opened: number;
}

/**
 * Apertura diaria de los seguimientos de fin de contrato: a cada inmobiliaria
 * le abre el de los contratos cuyo fin efectivo entró en la ventana amarilla.
 * Es idempotente: un contrato que ya tiene su seguimiento se omite.
 */
@Injectable()
export class FollowUpsScheduler extends CronBaseService {
  protected readonly logger = new Logger(FollowUpsScheduler.name);

  constructor(
    private readonly followUps: FollowUpsService,
    private readonly tenantCron: TenantCron,
  ) {
    super();
  }

  /** Todos los días a las 05:30 de Buenos Aires, antes de los avisos de las 08:00. */
  @Cron('30 5 * * *', { name: 'follow-ups-open', timeZone: AR_TIME_ZONE })
  async handleDailyOpen(): Promise<void> {
    await this.runGuarded(async () => {
      await this.openForAllTenants();
    }, 'follow-ups-open');
  }

  /** Núcleo del proceso; `today` se puede fijar para probar. */
  async openForAllTenants(today: Date = todayInAR()): Promise<FollowUpsRunSummary> {
    let opened = 0;
    const summary = await this.tenantCron.forEachActiveTenant('follow-ups-open', async () => {
      opened += await this.followUps.openDueFollowUps(today);
    });
    this.logger.log(`Follow-ups scheduler completed: tenants=${summary.ok} failed=${summary.failed} opened=${opened}`);
    return { tenantsProcessed: summary.ok, tenantsFailed: summary.failed, opened };
  }
}
