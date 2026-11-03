import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AR_TIME_ZONE } from '@realfy/shared';
import { findStaff } from '../../common/auth/find-staff';
import { MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { TenantCron } from '../../common/scheduler/tenant-cron';
import { NotificationsService } from '../notifications/notifications.service';
import { CLOSED_STATUSES } from './inbox-ingest.service';

/** Consultas que se marcan por vuelta y por inmobiliaria. */
const BATCH = 200;

export interface SlaRunSummary {
  tenantsProcessed: number;
  tenantsFailed: number;
  flagged: number;
}

/**
 * Plazo de primera respuesta de la bandeja (ADR-0013). Cada minuto marca las consultas
 * cuyo plazo venció sin respuesta de una persona y avisa al responsable y a la
 * administración. Cada consulta se marca una sola vez: la marca se toma con un
 * `updateMany` condicional, así dos instancias del proceso no avisan dos veces.
 */
@Injectable()
export class InboxSlaScheduler extends CronBaseService {
  protected readonly logger = new Logger(InboxSlaScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantCron: TenantCron,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  @Cron('* * * * *', { name: 'inbox-sla', timeZone: AR_TIME_ZONE })
  async handleSla(): Promise<void> {
    await this.runGuarded(async () => {
      const summary = await this.flagAllTenants();
      if (summary.flagged > 0 || summary.tenantsFailed > 0) {
        this.logger.log(
          `Cron job completed: inbox-sla tenants=${summary.tenantsProcessed} failed=${summary.tenantsFailed} flagged=${summary.flagged}`,
        );
      }
    }, 'inbox-sla');
  }

  /** Núcleo del proceso; `now` se puede fijar para probar. */
  async flagAllTenants(now: Date = new Date()): Promise<SlaRunSummary> {
    let flagged = 0;
    const summary = await this.tenantCron.forEachActiveTenant('inbox-sla', async (tenantId) => {
      flagged += await this.flagTenant(tenantId, now);
    });
    return { tenantsProcessed: summary.ok, tenantsFailed: summary.failed, flagged };
  }

  /** Marca las consultas vencidas de la inmobiliaria del contexto; devuelve cuántas. */
  async flagTenant(tenantId: string, now: Date): Promise<number> {
    const db = this.prisma.client;
    const due = await db.conversation.findMany({
      where: {
        slaBreachedAt: null,
        firstResponseAt: null,
        slaDueAt: { lte: now },
        status: { notIn: CLOSED_STATUSES },
      },
      orderBy: [{ slaDueAt: 'asc' }, { id: 'asc' }],
      take: BATCH,
      select: { id: true, assigneeUserId: true, counterpartName: true, address: true, channel: true },
    });
    if (due.length === 0) return 0;

    const managers = (await findStaff(this.prisma, tenantId, MANAGEMENT_ROLES, { id: true })).map((u) => u.id);
    let flagged = 0;
    for (const c of due) {
      const { count } = await db.conversation.updateMany({
        where: { id: c.id, slaBreachedAt: null },
        data: { slaBreachedAt: now },
      });
      if (count === 0) continue;
      flagged++;
      const recipients = [...new Set([...(c.assigneeUserId ? [c.assigneeUserId] : []), ...managers])].sort((a, b) =>
        a.localeCompare(b),
      );
      for (const userId of recipients) {
        await this.notifications.createNotification({
          tenantId,
          userId,
          type: 'InboxSlaBreached',
          title: 'Consulta sin respuesta a tiempo',
          message: `${c.counterpartName ?? c.address} (${c.channel}) sigue sin respuesta pasado el plazo.`,
          entityType: 'Conversation',
          entityId: c.id,
        });
      }
    }
    return flagged;
  }
}
