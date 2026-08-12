import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { TenantsService } from '../tenants/tenants.service';
import {
  PenaltiesService,
  ComputePenaltyInput,
} from './penalties.service';

@Injectable()
export class PenaltiesScheduler extends CronBaseService {
  protected readonly logger = new Logger(PenaltiesScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly penaltiesService: PenaltiesService,
    private readonly tenantsService: TenantsService,
  ) {
    super();
  }

  /**
   * Daily at 02:15 Argentina time — apply overdue penalties across all active tenants.
   * Idempotent: skips if a Penalty row already exists for (liquidacionId, today).
   */
  @Cron('15 2 * * *', { name: 'penalties-daily', timeZone: 'America/Argentina/Buenos_Aires' })
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let tenantsProcessed = 0;
    let penaltiesInserted = 0;

    const tenants = await this.prisma.baseClient.tenant.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });

    for (const tenant of tenants) {
      try {
        const config = await this.tenantsService.getPenaltyConfig(tenant.id);

        // Fetch overdue liquidaciones (Enviada status with dueDate < today).
        // Note: Prisma schema includes 'Pendiente' but it does not exist in the DB enum —
        // using it at runtime causes a ConnectorError. Filter on 'Enviada' only.
        const overdueLiquidaciones = await this.prisma.baseClient.liquidacion.findMany({
          where: {
            tenantId: tenant.id,
            status: 'Enviada' as any,
            dueDate: { lt: today },
          },
          select: {
            id: true,
            tenantId: true,
            total: true,
            dueDate: true,
          },
        });

        for (const liq of overdueLiquidaciones) {
          try {
            // Idempotency check: skip if already inserted today
            const existing = await this.prisma.baseClient.penalty.findFirst({
              where: {
                liquidacionId: liq.id,
                appliedOn: today,
              },
            });

            if (existing) {
              this.logger.debug(
                `Penalty already exists for liquidacionId=${liq.id} appliedOn=${today.toISOString().split('T')[0]} — skipping`,
              );
              continue;
            }

            // Sum prior unsettled (active) penalty amounts for this liquidacion
            const priorPenalties = await this.prisma.baseClient.penalty.aggregate({
              where: {
                liquidacionId: liq.id,
                status: 'active',
              },
              _sum: { amount: true },
            });

            const alreadyAppliedPenalty = new Decimal(
              priorPenalties._sum.amount?.toString() ?? '0',
            );

            const input: ComputePenaltyInput = {
              liquidacion: {
                id: liq.id,
                totalAmount: new Decimal(liq.total?.toString() ?? '0'),
                dueDate: liq.dueDate,
                tenantId: liq.tenantId,
              },
              config: {
                mode: config.mode as 'daily_fixed' | 'daily_percent' | 'compound_percent',
                value: new Decimal(config.value),
                graceDays: config.graceDays,
                maxMultiplier: new Decimal(config.maxMultiplier),
              },
              asOf: today,
              alreadyAppliedPenalty,
            };

            const result = this.penaltiesService.computePenalty(input);

            if (result.amount.greaterThan(0)) {
              await this.prisma.baseClient.penalty.create({
                data: {
                  tenantId: tenant.id,
                  liquidacionId: liq.id,
                  amount: result.amount.toDecimalPlaces(2).toNumber(),
                  compoundBase: result.compoundBase.toDecimalPlaces(2).toNumber(),
                  appliedOn: today,
                  daysOverdue: result.daysOverdue,
                  status: 'active',
                },
              });
              penaltiesInserted++;

              this.logger.log(
                `Penalty inserted: tenantId=${tenant.id} liquidacionId=${liq.id} amount=${result.amount.toFixed(2)} daysOverdue=${result.daysOverdue}`,
              );
            }
          } catch (err) {
            this.logger.error(
              `Penalty failed for liquidacionId=${liq.id}: ${(err as Error).message}`,
              (err as Error).stack,
            );
          }
        }

        tenantsProcessed++;
      } catch (err) {
        this.logger.error(
          `Penalty scheduler failed for tenantId=${tenant.id}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }

    this.logger.log(
      `Penalty scheduler completed in ${Date.now() - start}ms — tenants=${tenantsProcessed}, penaltiesInserted=${penaltiesInserted}`,
    );

    return { tenantsProcessed, penaltiesInserted };
  }
}
