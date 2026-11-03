import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AR_TIME_ZONE } from '@realfy/shared';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { TenantCron } from '../../common/scheduler/tenant-cron';
import { LessorInvoicingService } from './lessor-invoicing.service';

/**
 * Facturación automática por cuenta del locador: cada 30 minutos pone en cola los cobros y estados
 * nuevos de los locadores con facturación automática y emite lo pendiente. Un fallo de ARCA deja el
 * trabajo en `Fallido` (se reintenta hasta agotar los intentos) y nunca toca el cobro ni el estado.
 */
@Injectable()
export class LessorInvoicingScheduler extends CronBaseService {
  protected readonly logger = new Logger(LessorInvoicingScheduler.name);

  constructor(
    private readonly lessorInvoicing: LessorInvoicingService,
    private readonly tenantCron: TenantCron,
  ) {
    super();
  }

  @Cron('*/30 * * * *', { name: 'lessor-invoices-run', timeZone: AR_TIME_ZONE })
  async handleRun(): Promise<void> {
    await this.runGuarded(async () => {
      await this.runForAllTenants();
    }, 'lessor-invoices-run');
  }

  /** Núcleo del proceso, compartido por el cron y las pruebas. */
  async runForAllTenants(): Promise<{ emitted: number; failed: number }> {
    let emitted = 0;
    let failed = 0;
    await this.tenantCron.forEachActiveTenant('lessor-invoices-run', async () => {
      const result = await this.lessorInvoicing.runPending();
      emitted += result.emitted;
      failed += result.failed;
    });
    this.logger.log(`Lessor invoices run: emitted=${emitted} failed=${failed}`);
    return { emitted, failed };
  }
}
