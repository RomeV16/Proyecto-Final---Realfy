import { Injectable, Logger } from '@nestjs/common';
import { TicketStatus, type MessageTemplateKey } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/messaging/outbox.service';
import type { MessageVars } from '../../common/messaging/message-templates';
import { findStaff } from '../../common/auth/find-staff';
import { SUPPORT_ROLES } from '../../common/auth/role-groups';
import { NotificationsService } from '../notifications/notifications.service';

/** Cómo se le nombra cada estado al inquilino. */
const STATUS_LABEL: Record<string, string> = {
  [TicketStatus.Abierto]: 'abierto',
  [TicketStatus.Asignado]: 'asignado',
  [TicketStatus.EnProgreso]: 'en curso',
  [TicketStatus.ProveedorAsignado]: 'con proveedor asignado',
  [TicketStatus.ProveedorEnCamino]: 'el proveedor está en camino',
  [TicketStatus.TrabajoRealizado]: 'trabajo realizado',
  [TicketStatus.Resuelto]: 'resuelto',
  [TicketStatus.Cerrado]: 'cerrado',
  [TicketStatus.Cancelado]: 'cancelado',
  [TicketStatus.Reabierto]: 'reabierto',
  [TicketStatus.PendienteAutorizacion]: 'esperando la autorización del propietario',
  [TicketStatus.Presupuestado]: 'presupuestado',
  [TicketStatus.PresupuestoAprobado]: 'presupuesto aprobado',
};

interface TicketRef {
  id: string;
  tenantId: string;
  title: string;
  assignedToUserId?: string | null;
  createdByPersonId?: string | null;
}

/**
 * Avisos de los tickets (ADR-0013). Al personal le llegan a la bandeja de
 * notificaciones; al inquilino que abrió el ticket desde el portal, por la
 * bandeja de salida (WhatsApp si dio el alta, si no mail). Ninguno hace
 * fallar la operación: quien llama ya atrapa el error.
 */
@Injectable()
export class TicketNotificationService {
  private readonly logger = new Logger(TicketNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Ticket nuevo desde el portal: aviso a quienes atienden reclamos. */
  async notifyStaffOnNewTicket(ticket: {
    id: string;
    tenantId: string;
    title: string;
    property?: { title?: string | null; street?: string | null; number?: string | null } | null;
  }): Promise<void> {
    const staff = await findStaff(this.prisma, ticket.tenantId, SUPPORT_ROLES, { id: true });
    const where = ticket.property?.title ? ` en ${ticket.property.title}` : '';
    for (const user of staff) {
      await this.notifications.createNotification({
        tenantId: ticket.tenantId,
        userId: user.id,
        type: 'TicketCreated',
        title: 'Ticket nuevo desde el portal',
        message: `${ticket.title}${where}`,
        entityType: 'Ticket',
        entityId: ticket.id,
      });
    }
  }

  /** Cambio de estado: se le avisa al inquilino que lo abrió. */
  async notifyInquilinoOnStatusChange(
    ticket: TicketRef & { propertyId: string },
    oldStatus: string,
    newStatus: string,
  ): Promise<void> {
    await this.messageInquilino(ticket, 'ticket_status', {
      vars: { ticket: ticket.title, status: STATUS_LABEL[newStatus] ?? newStatus },
      relatedType: 'Ticket',
      relatedId: ticket.id,
      // Un estado puede repetirse (reabierto y vuelto a resolver): la clave lleva el momento del cambio.
      idempotencyKey: `Ticket:${ticket.id}:${oldStatus}->${newStatus}:${new Date().toISOString()}`,
    });
  }

  /**
   * Comentario nuevo: si lo escribió el inquilino, aviso al responsable (o a
   * quienes atienden reclamos si no hay); si lo escribió el personal, mensaje
   * al inquilino.
   */
  async notifyOnComment(
    ticket: TicketRef,
    comment: { id: string; content: string },
    isPortalComment: boolean,
  ): Promise<void> {
    if (!isPortalComment) {
      await this.messageInquilino(ticket, 'ticket_comment', {
        vars: { ticket: ticket.title, comment: excerpt(comment.content) },
        relatedType: 'TicketComment',
        relatedId: comment.id,
        idempotencyKey: `TicketComment:${comment.id}`,
      });
      return;
    }
    const recipients = ticket.assignedToUserId
      ? [{ id: ticket.assignedToUserId }]
      : await findStaff(this.prisma, ticket.tenantId, SUPPORT_ROLES, { id: true });
    for (const user of recipients) {
      await this.notifications.createNotification({
        tenantId: ticket.tenantId,
        userId: user.id,
        type: 'TicketCommentAdded',
        title: 'El inquilino comentó un ticket',
        message: `${ticket.title}: ${excerpt(comment.content)}`,
        entityType: 'Ticket',
        entityId: comment.id,
      });
    }
  }

  private async messageInquilino(
    ticket: TicketRef,
    templateKey: MessageTemplateKey,
    m: { vars: MessageVars; relatedType: string; relatedId: string; idempotencyKey: string },
  ): Promise<void> {
    if (!ticket.createdByPersonId) return;
    const db = this.prisma.client;
    const person = await db.person.findFirst({
      where: { id: ticket.createdByPersonId },
      select: { id: true, firstName: true, email: true, phone: true },
    });
    if (!person) return;
    const channel = await this.outbox.pickChannel(db, person, templateKey);
    if (!channel) {
      this.logger.log(`Ticket message skipped (no contact channel): ticketId=${ticket.id} template=${templateKey}`);
      return;
    }
    const tenant = await db.tenant.findFirst({ where: { id: ticket.tenantId }, select: { name: true } });
    await this.outbox.enqueue(db, {
      channel,
      templateKey,
      vars: { name: person.firstName, ...m.vars, agency: tenant?.name ?? 'Inmobiliaria' },
      personId: person.id,
      relatedType: m.relatedType,
      relatedId: m.relatedId,
      idempotencyKey: m.idempotencyKey,
    });
  }
}

/** Primeras palabras de un comentario, para el aviso. */
function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
