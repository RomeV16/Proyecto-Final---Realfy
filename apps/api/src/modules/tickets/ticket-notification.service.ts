import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TicketNotificationService {
  private readonly logger = new Logger(TicketNotificationService.name);

  /**
   * Notify staff when a new ticket is created from the portal.
   */
  async notifyStaffOnNewTicket(ticket: {
    id: string;
    tenantId: string;
    title: string;
    property?: { title?: string | null; street?: string | null; number?: string | null } | null;
  }): Promise<void> {
    this.logger.log(`New ticket registered: ticketId=${ticket.id}, title=${ticket.title}`);
  }

  /**
   * Notify the inquilino when a ticket's status changes.
   */
  async notifyInquilinoOnStatusChange(
    ticket: {
      id: string;
      tenantId: string;
      title: string;
      propertyId: string;
      createdByPersonId?: string | null;
    },
    oldStatus: string,
    newStatus: string,
  ): Promise<void> {
    this.logger.log(
      `Ticket status changed: ticketId=${ticket.id}, ${oldStatus} → ${newStatus}`,
    );
  }

  /**
   * Notify on a new comment.
   */
  async notifyOnComment(
    ticket: {
      id: string;
      tenantId: string;
      title: string;
      assignedToUserId?: string | null;
      createdByPersonId?: string | null;
    },
    comment: {
      id: string;
      content: string;
    },
    isPortalComment: boolean,
  ): Promise<void> {
    this.logger.log(
      `Ticket comment added: ticketId=${ticket.id}, commentId=${comment.id}, portal=${isPortalComment}`,
    );
  }
}
