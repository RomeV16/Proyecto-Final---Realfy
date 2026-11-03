import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AR_TIME_ZONE } from '@realfy/shared';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { TenantCron } from '../../common/scheduler/tenant-cron';
import { BillFetchService } from './bill-fetch.service';

export interface BillFetchRunSummary {
  tenantsProcessed: number;
  tenantsFailed: number;
  attempts: number;
  documents: number;
}

/** Consulta diaria de boletas a los proveedores (6:00 de Buenos Aires), por inmobiliaria y dentro de su contexto. */
@Injectable()
export class BillFetchScheduler extends CronBaseService {
  protected readonly logger = new Logger(BillFetchScheduler.name);

  constructor(
    private readonly tenantCron: TenantCron,
    private readonly fetch: BillFetchService,
  ) {
    super();
  }

  @Cron('0 6 * * *', { name: 'bill-fetch', timeZone: AR_TIME_ZONE })
  async handleDaily(): Promise<void> {
    await this.runGuarded(async () => {
      const summary = await this.runAllTenants();
      this.logger.log(
        `Cron job completed: bill-fetch tenants=${summary.tenantsProcessed} failed=${summary.tenantsFailed} attempts=${summary.attempts} documents=${summary.documents}`,
      );
    }, 'bill-fetch');
  }

  /** Núcleo del proceso; `now` se puede fijar para probar. */
  async runAllTenants(now: Date = new Date()): Promise<BillFetchRunSummary> {
    let attempts = 0;
    let documents = 0;
    const summary = await this.tenantCron.forEachActiveTenant('bill-fetch', async (tenantId) => {
      const result = await this.fetch.runForTenant(tenantId, now);
      attempts += result.attempts;
      documents += result.documents;
    });
    return { tenantsProcessed: summary.ok, tenantsFailed: summary.failed, attempts, documents };
  }
}
