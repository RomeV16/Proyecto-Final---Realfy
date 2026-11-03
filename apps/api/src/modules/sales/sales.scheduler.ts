import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AR_TIME_ZONE, todayInAR } from '@realfy/shared';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { TenantCron } from '../../common/scheduler/tenant-cron';
import { SalesDepositsService } from './sales-deposits.service';

export interface SalesExpiryRunSummary {
  tenantsProcessed: number;
  tenantsFailed: number;
  expired: number;
}

/**
 * Vencimiento diario de las reservas: a cada inmobiliaria le marca vencidas las reservas cuya fecha
 * pasó y libera las operaciones que quedaron sin reserva ni seña viva. Es idempotente y no devuelve
 * ni retiene dinero.
 */
@Injectable()
export class SalesScheduler extends CronBaseService {
  protected readonly logger = new Logger(SalesScheduler.name);

  constructor(
    private readonly deposits: SalesDepositsService,
    private readonly tenantCron: TenantCron,
  ) {
    super();
  }

  /** Todos los días a las 05:45 de Buenos Aires. */
  @Cron('45 5 * * *', { name: 'sales-reservations-expire', timeZone: AR_TIME_ZONE })
  async handleDailyExpiry(): Promise<void> {
    await this.runGuarded(async () => {
      await this.expireForAllTenants();
    }, 'sales-reservations-expire');
  }

  /** Núcleo del proceso; `today` se puede fijar para probar. */
  async expireForAllTenants(today: Date = todayInAR()): Promise<SalesExpiryRunSummary> {
    let expired = 0;
    const summary = await this.tenantCron.forEachActiveTenant('sales-reservations-expire', async () => {
      expired += await this.deposits.expireReservations(today);
    });
    this.logger.log(`Sales scheduler completed: tenants=${summary.ok} failed=${summary.failed} expired=${expired}`);
    return { tenantsProcessed: summary.ok, tenantsFailed: summary.failed, expired };
  }
}
