import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Decimal from 'decimal.js';
import { AR_TIME_ZONE, OVERDUE_STATUSES, todayInAR } from '@realfy/shared';
import { outstandingBalance } from '../liquidaciones/receivables';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { TenantCron } from '../../common/scheduler/tenant-cron';
import { AuditService } from '../../common/audit/audit.service';
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
    private readonly tenantCron: TenantCron,
    private readonly audit: AuditService,
  ) {
    super();
  }

  /**
   * Daily at 02:15 Argentina time — apply overdue penalties across all active tenants.
   * Idempotent: skips if a Penalty row already exists for (liquidacionId, today).
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
      const config = await this.tenantsService.getPenaltyConfig(tenantId);

      // Fetch overdue liquidaciones (Enviada or Vencida with dueDate < today).
      // 'Pendiente' existe en la base y en shared, pero no forma parte del filtro:
      // los punitorios corren sobre Enviada y Vencida.
      const overdueLiquidaciones = await this.prisma.client.liquidacion.findMany({
        where: {
          status: { in: [...OVERDUE_STATUSES] as any },
          dueDate: { lt: today },
        },
        select: {
          id: true,
          tenantId: true,
          total: true,
          dueDate: true,
          payments: { select: { amount: true } },
        },
      });

      for (const liq of overdueLiquidaciones) {
        try {
          // Idempotency check: skip if already inserted today
          const existing = await this.prisma.client.penalty.findFirst({
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
          const priorPenalties = await this.prisma.client.penalty.aggregate({
            where: {
              liquidacionId: liq.id,
              status: 'active',
            },
            _sum: { amount: true },
          });

          const alreadyAppliedPenalty = new Decimal(
            priorPenalties._sum.amount?.toString() ?? '0',
          );

          // El punitorio corre sobre lo que falta cobrar, no sobre el total.
          const outstanding = outstandingBalance({
            total: liq.total?.toString() ?? '0',
            payments: liq.payments,
          });
          if (outstanding.lte(0)) {
            this.logger.debug(`liquidacionId=${liq.id} has no outstanding balance — skipping`);
            continue;
          }

          const input: ComputePenaltyInput = {
            liquidacion: {
              id: liq.id,
              totalAmount: new Decimal(outstanding.toString()),
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
            const amount = result.amount.toDecimalPlaces(2).toNumber();
            await this.prisma.client.$transaction(async (tx) => {
              const penalty = await tx.penalty.create({
                data: {
                  tenantId,
                  liquidacionId: liq.id,
                  amount,
                  compoundBase: result.compoundBase.toDecimalPlaces(2).toNumber(),
                  appliedOn: today,
                  daysOverdue: result.daysOverdue,
                  status: 'active',
                },
              });
              // Un punitorio cambia lo que debe el inquilino: queda auditado
              // aunque no haya un pedido ni un usuario detrás.
              await this.audit.record(tx, {
                action: 'CREATE',
                entity: 'Penalty',
                entityId: penalty?.id,
                userId: null,
                after: { liquidacionId: liq.id, amount, daysOverdue: result.daysOverdue },
                metadata: { source: 'cron', job: 'penalties-daily' },
              });
            });
            penaltiesInserted++;

            this.logger.log(
              `Penalty inserted: tenantId=${tenantId} liquidacionId=${liq.id} amount=${result.amount.toFixed(2)} daysOverdue=${result.daysOverdue}`,
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
