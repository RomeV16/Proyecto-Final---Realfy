import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AR_TIME_ZONE, todayInAR } from '@realfy/shared';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { TenantCron } from '../../common/scheduler/tenant-cron';
import { LiquidacionesService } from './liquidaciones.service';

export interface LiquidacionesRunSummary {
  tenantsProcessed: number;
  tenantsFailed: number;
  created: number;
}

/**
 * Generación automática de liquidaciones: todos los días recorre las
 * inmobiliarias y, a las que están a `leadDays` días o menos del mes siguiente
 * (10 por defecto), les genera las liquidaciones de ese mes. Es idempotente:
 * un contrato que ya tiene su liquidación del período se omite.
 */
@Injectable()
export class LiquidacionesScheduler extends CronBaseService {
  protected readonly logger = new Logger(LiquidacionesScheduler.name);

  constructor(
    private readonly liquidaciones: LiquidacionesService,
    private readonly tenantCron: TenantCron,
  ) {
    super();
  }

  /**
   * Todos los días a las 07:30 de Buenos Aires: después de la lectura de índices
   * (06:00) y de los ajustes del día (07:00), para que la liquidación use el
   * índice publicado ese día (DEF-131). La generación igual aplica antes los
   * ajustes que vencen en el mes que liquida.
   */
  @Cron('30 7 * * *', { name: 'liquidaciones-generate', timeZone: AR_TIME_ZONE })
  async handleDailyGeneration(): Promise<void> {
    await this.runGuarded(async () => {
      await this.generateForAllTenants();
    }, 'liquidaciones-generate');
  }

  /**
   * Núcleo del proceso, compartido por el cron y por `_run-now`. `today` se
   * puede fijar para probar; por defecto es el día de hoy en Buenos Aires.
   */
  async generateForAllTenants(
    today: Date = todayInAR(),
    source: 'cron' | 'run-now' = 'cron',
  ): Promise<LiquidacionesRunSummary> {
    let created = 0;
    const summary = await this.tenantCron.forEachActiveTenant('liquidaciones-generate', async () => {
      const result = await this.liquidaciones.generateScheduled(today, source);
      created += result?.created ?? 0;
    });

    this.logger.log(
      `Liquidaciones scheduler completed: tenants=${summary.ok} failed=${summary.failed} created=${created}`,
    );
    return { tenantsProcessed: summary.ok, tenantsFailed: summary.failed, created };
  }
}
