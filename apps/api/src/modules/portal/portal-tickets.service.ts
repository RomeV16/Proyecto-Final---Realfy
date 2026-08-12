import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { MediaService } from '../../common/media/media.service';
import { TicketNotificationService } from '../tickets/ticket-notification.service';
import {
  CreatePortalTicketSchema,
  CreatePortalTicketCommentSchema,
  TicketPriority,
} from '@realfy/shared';

/**
 * Checks if an error is a Zod validation error.
 */
function isZodError(err: unknown): err is { errors: any[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as any).name === 'ZodError' &&
    'errors' in err
  );
}

@Injectable()
export class PortalTicketsService {
  private readonly logger = new Logger(PortalTicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly media: MediaService,
    private readonly ticketNotifications: TicketNotificationService,
  ) {}

  /**
   * Get the property IDs accessible to the current portal inquilino.
   * Scoping path: Person → ContractPerson(role=Inquilino) → Contract(isActive) → Property.
   */
  private async getInquilinoPropertyIds(): Promise<string[]> {
    const personId = this.tenantContext.getPersonId();
    if (!personId) {
      throw new ForbiddenException({
        error: 'PORTAL_NO_PERSON',
        message: 'No person context found for portal request',
      });
    }

    const contractPersons = await this.prisma.client.contractPerson.findMany({
      where: {
        personId,
        role: 'Inquilino',
      },
      include: {
        contract: {
          select: { propertyId: true, isActive: true },
        },
      },
    });

    return contractPersons
      .filter((cp: any) => (cp as any).contract?.isActive)
      .map((cp: any) => (cp as any).contract.propertyId as string);
  }

  /**
   * GET /portal/tickets — List tickets for inquilino's properties.
   */
  async getTickets(page = 1, limit = 10) {
    const propertyIds = await this.getInquilinoPropertyIds();

    if (propertyIds.length === 0) {
      return { data: [], meta: { total: 0, page, limit, totalPages: 0 } };
    }

    const where = { propertyId: { in: propertyIds } };

    const [data, total] = await Promise.all([
      this.prisma.client.ticket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          property: { select: { id: true, title: true, street: true, number: true, city: true } },
          category: { select: { id: true, name: true, color: true, icon: true } },
          createdByPerson: { select: { id: true, firstName: true, lastName: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.client.ticket.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * POST /portal/tickets — Create ticket from portal.
   */
  async createTicket(body: unknown, file?: Express.Multer.File) {
    let validated: any;
    try {
      validated = CreatePortalTicketSchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid ticket data',
          details: err.errors,
        });
      }
      throw err;
    }

    const personId = this.tenantContext.getPersonId();
    if (!personId) {
      throw new ForbiddenException({
        error: 'PORTAL_NO_PERSON',
        message: 'No person context found for portal request',
      });
    }

    // Verify the property belongs to inquilino's active contracts
    const propertyIds = await this.getInquilinoPropertyIds();
    if (!propertyIds.includes(validated.propertyId)) {
      throw new ForbiddenException({
        error: 'PORTAL_ACCESS_DENIED',
        message: 'You do not have access to this property',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Verify category belongs to tenant if provided
    if (validated.categoryId) {
      const category = await this.prisma.client.ticketCategory.findUnique({
        where: { id: validated.categoryId },
        select: { id: true, tenantId: true, isActive: true },
      });
      if (!category || !category.isActive) {
        throw new NotFoundException({
          error: 'CATEGORY_NOT_FOUND',
          message: `Category ${validated.categoryId} not found`,
        });
      }
    }

    const ticket = await this.prisma.client.ticket.create({
      data: {
        tenantId,
        propertyId: validated.propertyId,
        categoryId: validated.categoryId ?? null,
        createdByPersonId: personId,
        title: validated.title,
        description: validated.description ?? null,
        status: 'Abierto',
        priority: TicketPriority.Media,
      },
      include: {
        property: { select: { id: true, title: true, street: true, number: true, city: true } },
        category: true,
        createdByPerson: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // If a photo was uploaded, create a comment with the attachment
    if (file) {
      const comment = await this.prisma.client.ticketComment.create({
        data: {
          tenantId,
          ticketId: ticket.id,
          personId,
          content: 'Foto adjunta al crear el reclamo',
        },
      });

      const keyPrefix = `tenants/${tenantId}/tickets/${ticket.id}/comments/${comment.id}`;
      const processed = await this.media.processAndUpload(file, keyPrefix);

      await this.prisma.client.ticketAttachment.create({
        data: {
          tenantId,
          commentId: comment.id,
          url: processed.url,
          thumbnailUrl: processed.thumbnailUrl,
          mimeType: 'image/jpeg',
          sizeBytes: processed.sizeBytes,
          width: processed.width,
          height: processed.height,
        },
      });
    }

    this.logger.log(
      `Portal ticket created: id=${ticket.id}, personId=${personId}, propertyId=${validated.propertyId}`,
    );

    // Notify staff (non-blocking)
    this.ticketNotifications
      .notifyStaffOnNewTicket({
        id: ticket.id,
        tenantId,
        title: ticket.title,
        property: ticket.property,
      })
      .catch((err) =>
        this.logger.error('Staff notification failed', { ticketId: ticket.id, error: (err as Error).message }),
      );

    return ticket;
  }

  /**
   * GET /portal/tickets/:id — Ticket detail with timeline (ownership-checked).
   */
  async getTicketDetail(id: string) {
    const propertyIds = await this.getInquilinoPropertyIds();

    const ticket = await this.prisma.client.ticket.findUnique({
      where: { id },
      include: {
        property: { select: { id: true, title: true, street: true, number: true, city: true } },
        category: true,
        createdByPerson: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
            person: { select: { id: true, firstName: true, lastName: true } },
            attachments: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException({
        error: 'TICKET_NOT_FOUND',
        message: `Ticket ${id} not found`,
      });
    }

    // Ownership check: ticket's property must be in inquilino's accessible properties
    if (!propertyIds.includes(ticket.propertyId)) {
      throw new ForbiddenException({
        error: 'PORTAL_ACCESS_DENIED',
        message: 'You do not have access to this ticket',
      });
    }

    return ticket;
  }

  /**
   * POST /portal/tickets/:id/comments — Add comment from portal.
   */
  async addComment(ticketId: string, body: unknown, file?: Express.Multer.File) {
    let validated: any;
    try {
      validated = CreatePortalTicketCommentSchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid comment data',
          details: err.errors,
        });
      }
      throw err;
    }

    const personId = this.tenantContext.getPersonId();
    if (!personId) {
      throw new ForbiddenException({
        error: 'PORTAL_NO_PERSON',
        message: 'No person context found for portal request',
      });
    }

    // Verify ticket exists and is accessible
    const propertyIds = await this.getInquilinoPropertyIds();

    const ticket = await this.prisma.client.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, tenantId: true, title: true, propertyId: true, assignedToUserId: true, createdByPersonId: true },
    });

    if (!ticket) {
      throw new NotFoundException({
        error: 'TICKET_NOT_FOUND',
        message: `Ticket ${ticketId} not found`,
      });
    }

    if (!propertyIds.includes(ticket.propertyId)) {
      throw new ForbiddenException({
        error: 'PORTAL_ACCESS_DENIED',
        message: 'You do not have access to this ticket',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    const comment = await this.prisma.client.ticketComment.create({
      data: {
        tenantId,
        ticketId,
        personId,
        content: validated.content,
      },
      include: {
        person: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    // Process photo attachment if provided
    let attachment: any = null;
    if (file) {
      const keyPrefix = `tenants/${tenantId}/tickets/${ticketId}/comments/${comment.id}`;
      const processed = await this.media.processAndUpload(file, keyPrefix);

      attachment = await this.prisma.client.ticketAttachment.create({
        data: {
          tenantId,
          commentId: comment.id,
          url: processed.url,
          thumbnailUrl: processed.thumbnailUrl,
          mimeType: 'image/jpeg',
          sizeBytes: processed.sizeBytes,
          width: processed.width,
          height: processed.height,
        },
      });
    }

    this.logger.log(
      `Portal comment added to ticket ${ticketId}: commentId=${comment.id}, personId=${personId}`,
    );

    // Notify staff on portal comment (non-blocking)
    this.ticketNotifications
      .notifyOnComment(
        { id: ticket.id, tenantId: ticket.tenantId, title: ticket.title, assignedToUserId: ticket.assignedToUserId, createdByPersonId: ticket.createdByPersonId },
        { id: comment.id, content: validated.content },
        true, // portal comment
      )
      .catch((err) =>
        this.logger.error('Comment notification failed', { ticketId, error: (err as Error).message }),
      );

    return {
      ...comment,
      attachments: attachment ? [attachment] : [],
    };
  }

  /**
   * GET /portal/categories — List active ticket categories for tenant.
   */
  async getCategories() {
    return this.prisma.client.ticketCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        icon: true,
        color: true,
      },
    });
  }
}
