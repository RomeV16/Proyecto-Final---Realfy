import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AR_TIME_ZONE, OVERDUE_STATUSES, todayInAR } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { TenantCron } from '../../common/scheduler/tenant-cron';
import { PenaltiesService, PenaltyContext } from './penalties.service';

@Injectable()
export class PenaltiesScheduler extends CronBaseService {
  protected readonly logger = new Logger(PenaltiesScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly penaltiesService: PenaltiesService,
    private readonly tenantCron: TenantCron,
  ) {
    super();
  }

  /**
   * Daily at 02:15 Argentina time — apply overdue penalties across all active tenants.
   * Idempotente: cada corrida registra solo lo devengado que todavía no está registrado.
   */
  @Cron('15 2 * * *', { name: 'penalties-daily', timeZone: AR_TIME_ZONE })
  async handleDailyPenalties(): Promise<void> {
    await this.runGuarded(async () => {
      await this.applyPenalties();
    }, 'penalties-daily');
  }

  /**
   * Core penalty application logic — called by the cron and by the _run-now endpoint.
   */
  async applyPenalties(): Promise<{ tenantsProcessed: number; penaltiesInserted: number }> {
    const start = Date.now();
    this.logger.log('Penalty scheduler started');

    // Día calendario de Buenos Aires a medianoche UTC, igual que dueDate y appliedOn.
    const today = todayInAR();

    let tenantsProcessed = 0;
    let penaltiesInserted = 0;

    const summary = await this.tenantCron.forEachActiveTenant('penalties-daily', async (tenantId) => {
      // Fetch overdue liquidaciones (Enviada or Vencida with dueDate < today).
      // 'Pendiente' existe en la base y en shared, pero no forma parte del filtro:
      // los punitorios corren sobre Enviada y Vencida.
      const overdueLiquidaciones = await this.prisma.client.liquidacion.findMany({
        where: {
          status: { in: [...OVERDUE_STATUSES] as any },
          dueDate: { lt: today },
        },
        select: { id: true, contractId: true },
      });

      // La regla es del contrato (o la de la inmobiliaria): se resuelve una vez por contrato.
      const contexts = new Map<string, PenaltyContext>();
      for (const liq of overdueLiquidaciones) {
        try {
          let ctx = contexts.get(liq.contractId);
          if (!ctx) {
            ctx = await this.penaltiesService.loadContext(tenantId, liq.contractId, today);
            contexts.set(liq.contractId, ctx);
          }
          // El devengo se calcula sobre el saldo de cada día y se registra solo lo que falta
          // respecto de lo ya registrado: correr dos veces el mismo día no duplica.
          const { created, skipped } = await this.penaltiesService.accrueLocked(tenantId, liq.id, ctx, today, 'cron');
          if (skipped) {
            this.logger.debug(`liquidacionId=${liq.id} has no outstanding balance — skipping`);
            continue;
          }
          if (created) {
            penaltiesInserted++;
            this.logger.log(
              `Penalty inserted: tenantId=${tenantId} liquidacionId=${liq.id} amount=${created.toFixed(2)}`,
            );
          }
        } catch (err) {
          this.logger.error(
            `Penalty failed for liquidacionId=${liq.id}: ${(err as Error).message}`,
            (err as Error).stack,
          );
        }
      }
    });
    tenantsProcessed = summary.ok;

    this.logger.log(
      `Penalty scheduler completed in ${Date.now() - start}ms — tenants=${tenantsProcessed}, penaltiesInserted=${penaltiesInserted}`,
    );

    return { tenantsProcessed, penaltiesInserted };
  }
}
