import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { NotificationEmailService } from './notification-email.service';

@Injectable()
export class NotificationSchedulerService extends CronBaseService {
  protected readonly logger = new Logger(NotificationSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: NotificationEmailService,
  ) {
    super();
  }

  /**
   * Daily at 11:00 UTC (≈ 08:00 Argentina) — Service due reminders.
   * Notifies Admin/Gerente users when a service due day is within 5 days.
   */
  @Cron('0 11 * * *', { name: 'service-due-reminders' })
  async handleServiceDueReminders(): Promise<void> {
    await this.runGuarded(async () => {
      const start = Date.now();
      this.logger.log('Cron job started: service-due-reminders');
      let tenantsProcessed = 0;
      let notificationsCreated = 0;

      const tenants = await this.prisma.baseClient.tenant.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      });
      tenantsProcessed = tenants.length;

      const today = new Date();
      const currentDay = today.getDate();

      for (const tenant of tenants) {
        try {
          // Find active services where dueDay is within 5 days of today
          const services = await this.prisma.baseClient.service.findMany({
            where: {
              tenantId: tenant.id,
              isActive: true,
            },
            include: { property: { select: { title: true } } },
          });

          // Filter services whose dueDay is within 5 days
          const dueServices = services.filter((s: any) => {
            const diff = s.dueDay - currentDay;
            return diff >= 0 && diff <= 5;
          });

          if (dueServices.length === 0) continue;

          // Get Admin/Gerente users in this tenant
          const users = await this.prisma.baseClient.user.findMany({
            where: {
              tenantId: tenant.id,
              isActive: true,
              role: { in: ['Admin', 'Gerente'] },
            },
            select: { id: true, email: true },
          });

          for (const service of dueServices) {
            for (const user of users) {
              await this.notificationsService.createNotification({
                tenantId: tenant.id,
                userId: user.id,
                type: 'ServiceDueReminder',
                title: `Vencimiento de servicio: día ${service.dueDay}`,
                message: `El servicio ${service.serviceType} de ${service.property.title} vence el día ${service.dueDay} del mes.`,
                entityType: 'Service',
                entityId: service.id,
              });
              notificationsCreated++;
            }
          }
        } catch (err) {
          this.logger.error(
            `Service due reminders failed for tenantId=${tenant.id}`,
            (err as Error).stack,
          );
        }
      }

      this.logger.log(
        `Cron job completed: service-due-reminders in ${Date.now() - start}ms — tenants=${tenantsProcessed}, notifications=${notificationsCreated}`,
      );
    }, 'service-due-reminders');
  }

  /**
   * Daily at 11:00 UTC — Contract expiry warnings.
   * Notifies Admin/Gerente users when a contract expires within 30 days.
   */
  @Cron('0 11 * * *', { name: 'contract-expiry-warnings' })
  async handleContractExpiryWarnings(): Promise<void> {
    await this.runGuarded(async () => {
      const start = Date.now();
      this.logger.log('Cron job started: contract-expiry-warnings');
      let tenantsProcessed = 0;
      let notificationsCreated = 0;

      const tenants = await this.prisma.baseClient.tenant.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      });
      tenantsProcessed = tenants.length;

      const today = new Date();
      const thirtyDaysFromNow = new Date(today);
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      for (const tenant of tenants) {
        try {
          const contracts = await this.prisma.baseClient.contract.findMany({
            where: {
              tenantId: tenant.id,
              status: 'Activo',
              endDate: { lte: thirtyDaysFromNow, gte: today },
            },
            include: { property: { select: { title: true } } },
          });

          if (contracts.length === 0) continue;

          const users = await this.prisma.baseClient.user.findMany({
            where: {
              tenantId: tenant.id,
              isActive: true,
              role: { in: ['Admin', 'Gerente'] },
            },
            select: { id: true, email: true },
          });

          for (const contract of contracts) {
            const daysLeft = Math.ceil(
              (contract.endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
            );

            for (const user of users) {
              await this.notificationsService.createNotification({
                tenantId: tenant.id,
                userId: user.id,
                type: 'ContractExpiring',
                title: `Contrato por vencer en ${daysLeft} días`,
                message: `El contrato de ${contract.property.title} vence el ${contract.endDate.toLocaleDateString('es-AR')}.`,
                entityType: 'Contract',
                entityId: contract.id,
              });
              notificationsCreated++;

              // Send email for critical contract expiry
              await this.emailService.sendNotificationEmail({
                to: user.email,
                subject: `Contrato por vencer — ${contract.property.title}`,
                title: `Contrato por vencer en ${daysLeft} días`,
                message: `El contrato de ${contract.property.title} vence el ${contract.endDate.toLocaleDateString('es-AR')}. Por favor revise las opciones de renovación.`,
                tenantName: tenant.name,
              });
            }
          }
        } catch (err) {
          this.logger.error(
            `Contract expiry warnings failed for tenantId=${tenant.id}`,
            (err as Error).stack,
          );
        }
      }

      this.logger.log(
        `Cron job completed: contract-expiry-warnings in ${Date.now() - start}ms — tenants=${tenantsProcessed}, notifications=${notificationsCreated}`,
      );
    }, 'contract-expiry-warnings');
  }

  /**
   * Daily at 11:00 UTC — Overdue liquidación detection.
   * Notifies Admin/Gerente/Liquidaciones users when a liquidación is overdue.
   */
  @Cron('0 11 * * *', { name: 'overdue-liquidaciones' })
  async handleOverdueLiquidaciones(): Promise<void> {
    await this.runGuarded(async () => {
      const start = Date.now();
      this.logger.log('Cron job started: overdue-liquidaciones');
      let tenantsProcessed = 0;
      let notificationsCreated = 0;

      const tenants = await this.prisma.baseClient.tenant.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      });
      tenantsProcessed = tenants.length;

      const today = new Date();

      for (const tenant of tenants) {
        try {
          const liquidaciones = await this.prisma.baseClient.liquidacion.findMany({
            where: {
              tenantId: tenant.id,
              status: 'Enviada',
              dueDate: { lt: today },
            },
            include: {
              contract: {
                include: { property: { select: { title: true } } },
              },
            },
          });

          if (liquidaciones.length === 0) continue;

          const users = await this.prisma.baseClient.user.findMany({
            where: {
              tenantId: tenant.id,
              isActive: true,
              role: { in: ['Admin', 'Gerente', 'Liquidaciones'] },
            },
            select: { id: true, email: true },
          });

          for (const liq of liquidaciones) {
            const periodStr = liq.period.toLocaleDateString('es-AR', {
              month: 'long',
              year: 'numeric',
            });

            for (const user of users) {
              await this.notificationsService.createNotification({
                tenantId: tenant.id,
                userId: user.id,
                type: 'LiquidacionOverdue',
                title: `Liquidación vencida: ${periodStr}`,
                message: `La liquidación de ${liq.contract.property.title} del período ${periodStr} está vencida (vencimiento: ${liq.dueDate.toLocaleDateString('es-AR')}).`,
                entityType: 'Liquidacion',
                entityId: liq.id,
              });
              notificationsCreated++;

              // Send email for overdue liquidaciones
              await this.emailService.sendNotificationEmail({
                to: user.email,
                subject: `Liquidación vencida — ${liq.contract.property.title}`,
                title: `Liquidación vencida: ${periodStr}`,
                message: `La liquidación de ${liq.contract.property.title} del período ${periodStr} venció el ${liq.dueDate.toLocaleDateString('es-AR')}. Por favor gestione el cobro.`,
                tenantName: tenant.name,
              });
            }
          }
        } catch (err) {
          this.logger.error(
            `Overdue liquidaciones failed for tenantId=${tenant.id}`,
            (err as Error).stack,
          );
        }
      }

      this.logger.log(
        `Cron job completed: overdue-liquidaciones in ${Date.now() - start}ms — tenants=${tenantsProcessed}, notifications=${notificationsCreated}`,
      );
    }, 'overdue-liquidaciones');
  }
}
