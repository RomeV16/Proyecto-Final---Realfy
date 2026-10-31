import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { formatDateAR, todayInAR } from '@realfy/shared';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { NotificationEmailService } from './notification-email.service';

/** Los avisos diarios salen a las 08:00 de Buenos Aires. */
const DAILY_08_AR = { timeZone: 'America/Argentina/Buenos_Aires' } as const;

/**
 * Días antes del vencimiento de un contrato en que se avisa, uno por umbral:
 * al entrar en los 30 días, a los 15 y a los 7. Un contrato que se carga ya
 * dentro de un umbral recibe solo el aviso del umbral que le corresponde.
 */
const CONTRACT_EXPIRY_THRESHOLDS_DAYS = [30, 15, 7] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Umbral vigente: el más chico que todavía alcanza (a 20 días, 30; a 10, 15; a 3, 7). */
function contractExpiryThreshold(daysLeft: number): number | null {
  const ascending = [...CONTRACT_EXPIRY_THRESHOLDS_DAYS].sort((a, b) => a - b);
  return ascending.find((threshold) => daysLeft <= threshold) ?? null;
}

/**
 * Título del aviso de un umbral. Es parte de la clave de deduplicación
 * (usuario, contrato, tipo, umbral): la tabla no tiene una columna de umbral.
 */
function contractExpiryTitle(threshold: number): string {
  return `Contrato por vencer: faltan ${threshold} días o menos`;
}

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
   * Daily at 08:00 Argentina time — Service due reminders.
   * Notifies Admin/Gerente users when a service due day is within 5 days.
   */
  @Cron('0 8 * * *', { name: 'service-due-reminders', ...DAILY_08_AR })
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
   * Daily at 08:00 Argentina time — Contract expiry warnings.
   * Notifies Admin/Gerente users once per contract and threshold (CONTRACT_EXPIRY_THRESHOLDS_DAYS).
   */
  @Cron('0 8 * * *', { name: 'contract-expiry-warnings', ...DAILY_08_AR })
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

      // Día calendario de Buenos Aires a medianoche UTC, como se guardan los vencimientos.
      const today = todayInAR();
      const horizon = new Date(today.getTime() + Math.max(...CONTRACT_EXPIRY_THRESHOLDS_DAYS) * DAY_MS);

      for (const tenant of tenants) {
        try {
          const contracts = await this.prisma.baseClient.contract.findMany({
            where: {
              tenantId: tenant.id,
              status: 'Activo',
              endDate: { lte: horizon, gte: today },
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
            const daysLeft = Math.ceil((contract.endDate.getTime() - today.getTime()) / DAY_MS);
            const threshold = contractExpiryThreshold(daysLeft);
            if (threshold === null) continue;
            const title = contractExpiryTitle(threshold);

            for (const user of users) {
              // Un aviso por usuario, contrato y umbral: si ya salió, no se repite.
              const alreadyNotified = await this.prisma.baseClient.notification.findFirst({
                where: {
                  tenantId: tenant.id,
                  userId: user.id,
                  type: 'ContractExpiring',
                  entityType: 'Contract',
                  entityId: contract.id,
                  title,
                },
                select: { id: true },
              });
              if (alreadyNotified) continue;

              const created = await this.notificationsService.createNotification({
                tenantId: tenant.id,
                userId: user.id,
                type: 'ContractExpiring',
                title,
                message: `El contrato de ${contract.property.title} vence el ${formatDateAR(contract.endDate)} (faltan ${daysLeft} días).`,
                entityType: 'Contract',
                entityId: contract.id,
              });
              if (!created) continue;
              notificationsCreated++;

              // Send email for critical contract expiry
              await this.emailService.sendNotificationEmail({
                to: user.email,
                subject: `Contrato por vencer — ${contract.property.title}`,
                title,
                message: `El contrato de ${contract.property.title} vence el ${formatDateAR(contract.endDate)} (faltan ${daysLeft} días). Por favor revise las opciones de renovación.`,
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
   * Daily at 08:00 Argentina time — Overdue liquidación detection.
   * Notifies Admin/Gerente/Liquidaciones users when a liquidación is overdue.
   */
  @Cron('0 8 * * *', { name: 'overdue-liquidaciones', ...DAILY_08_AR })
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

  /**
   * Daily at 08:00 Argentina time — Stale lead alerts.
   * Notifies assigned user (or Admin/Gerente fallback) when a lead has been
   * inactive in a stage longer than that stage's staleDays threshold.
   */
  @Cron('0 8 * * *', { name: 'stale-lead-alerts', ...DAILY_08_AR })
  async handleStaleLeadAlerts(): Promise<void> {
    await this.runGuarded(async () => {
      const start = Date.now();
      this.logger.log('Cron job started: stale-lead-alerts');
      let tenantsProcessed = 0;
      let notificationsCreated = 0;

      const tenants = await this.prisma.baseClient.tenant.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      });
      tenantsProcessed = tenants.length;

      const now = new Date();

      for (const tenant of tenants) {
        try {
          // Find leads whose current stage has a staleDays threshold configured
          const leads = await this.prisma.baseClient.lead.findMany({
            where: {
              tenantId: tenant.id,
              isActive: true,
              status: { notIn: ['Convertido', 'Perdido'] },
              currentStage: { staleDays: { not: null } },
            },
            include: {
              currentStage: { select: { staleDays: true, name: true } },
              person: { select: { firstName: true, lastName: true } },
              assignedToUser: { select: { id: true } },
            },
          });

          for (const lead of leads) {
            const contactDate = new Date(
              lead.lastContactAt ?? lead.updatedAt,
            );
            const daysSinceContact = Math.floor(
              (now.getTime() - contactDate.getTime()) / (1000 * 60 * 60 * 24),
            );

            if (
              lead.currentStage.staleDays == null ||
              daysSinceContact <= lead.currentStage.staleDays
            ) {
              continue;
            }

            const personName = `${lead.person.firstName} ${lead.person.lastName}`;
            const title = `Lead inactivo: ${personName}`;
            const message = `El lead ${personName} lleva ${daysSinceContact} días sin contacto en la etapa "${lead.currentStage.name}" (límite: ${lead.currentStage.staleDays} días).`;

            if (lead.assignedToUserId && lead.assignedToUser) {
              // Notify the assigned user
              await this.notificationsService.createNotification({
                tenantId: tenant.id,
                userId: lead.assignedToUser.id,
                type: 'StaleLeadAlert',
                title,
                message,
                entityType: 'Lead',
                entityId: lead.id,
              });
              notificationsCreated++;
            } else {
              // Fallback: notify Admin/Gerente users in this tenant
              const admins = await this.prisma.baseClient.user.findMany({
                where: {
                  tenantId: tenant.id,
                  isActive: true,
                  role: { in: ['Admin', 'Gerente'] },
                },
                select: { id: true },
              });

              for (const admin of admins) {
                await this.notificationsService.createNotification({
                  tenantId: tenant.id,
                  userId: admin.id,
                  type: 'StaleLeadAlert',
                  title,
                  message,
                  entityType: 'Lead',
                  entityId: lead.id,
                });
                notificationsCreated++;
              }
            }
          }
        } catch (err) {
          this.logger.error(
            `Stale lead alerts failed for tenantId=${tenant.id}`,
            (err as Error).stack,
          );
        }
      }

      this.logger.log(
        `Cron job completed: stale-lead-alerts in ${Date.now() - start}ms — tenants=${tenantsProcessed}, notifications=${notificationsCreated}`,
      );
    }, 'stale-lead-alerts');
  }
}
