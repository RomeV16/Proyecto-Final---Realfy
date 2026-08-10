import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { MediaService } from '../../common/media/media.service';
import { TicketNotificationService } from './ticket-notification.service';
import {
  CreateTicketSchema,
  UpdateTicketSchema,
  TicketFilterSchema,
  TransitionTicketStatusSchema,
  CreateTicketCommentSchema,
  AssignProviderSchema,
  UpdateTicketCostSchema,
  validateTicketTransition,
  getValidTicketTransitions,
  TICKET_SLA_HOURS,
  TicketStatus,
  TicketPriority,
} from '@realfy/shared';

/**
 * Checks if an error is a Zod validation error (K006 pattern — no direct zod import).
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
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly media: MediaService,
    private readonly ticketNotifications: TicketNotificationService,
  ) {}

  // ─── SLA Computation ──────────────────────────────────

  /**
   * Compute the SLA deadline for a ticket based on priority and tenant timezone.
   * Returns null for Baja priority (no SLA).
   */
  private async computeSlaDeadline(
    priority: TicketPriority,
    tenantId: string,
  ): Promise<Date | null> {
    const hours = TICKET_SLA_HOURS[priority];
    if (hours === null) return null;

    // Look up tenant timezone
    const tenant = await this.prisma.baseClient.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const timezone = tenant?.timezone ?? 'America/Buenos_Aires';

    // Get current time in tenant's timezone, add SLA hours, convert back to UTC
    const now = new Date();
    // Create a date formatter for the tenant timezone to get the offset
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    // We compute SLA as: now + hours (simple UTC addition for business hour counting)
    // The timezone is stored for display purposes — SLA deadline stored in UTC
    const deadline = new Date(now.getTime() + hours * 60 * 60 * 1000);
    this.logger.debug(
      `SLA computed: priority=${priority}, hours=${hours}, timezone=${timezone}, deadline=${deadline.toISOString()}`,
    );
    return deadline;
  }

  // ─── Create ───────────────────────────────────────────

  async create(body: unknown) {
    let validated: any;
    try {
      validated = CreateTicketSchema.parse(body);
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

    const tenantId = this.tenantContext.getTenantId()!;
    const userId = this.tenantContext.getUserId()!;

    // Verify property exists and belongs to tenant
    const property = await this.prisma.client.property.findUnique({
      where: { id: validated.propertyId },
      select: { id: true },
    });
    if (!property) {
      throw new NotFoundException({
        error: 'PROPERTY_NOT_FOUND',
        message: `Property ${validated.propertyId} not found`,
      });
    }

    // Verify category belongs to tenant if provided
    if (validated.categoryId) {
      const category = await this.prisma.client.ticketCategory.findUnique({
        where: { id: validated.categoryId },
        select: { id: true, tenantId: true },
      });
      if (!category) {
        throw new NotFoundException({
          error: 'CATEGORY_NOT_FOUND',
          message: `Category ${validated.categoryId} not found`,
        });
      }
    }

    // Verify assignee exists and belongs to tenant if provided
    if (validated.assignedToUserId) {
      const assignee = await this.prisma.client.user.findUnique({
        where: { id: validated.assignedToUserId },
        select: { id: true },
      });
      if (!assignee) {
        throw new NotFoundException({
          error: 'USER_NOT_FOUND',
          message: `User ${validated.assignedToUserId} not found`,
        });
      }
    }

    const slaDeadline = await this.computeSlaDeadline(
      validated.priority,
      tenantId,
    );

    // If assignee provided, start in Asignado state
    const status = validated.assignedToUserId
      ? TicketStatus.Asignado
      : TicketStatus.Abierto;

    const ticket = await this.prisma.client.ticket.create({
      data: {
        tenantId,
        propertyId: validated.propertyId,
        categoryId: validated.categoryId ?? null,
        createdByUserId: userId,
        assignedToUserId: validated.assignedToUserId ?? null,
        title: validated.title,
        description: validated.description ?? null,
        status,
        priority: validated.priority,
        slaDeadline,
      },
      include: {
        property: { select: { id: true, title: true, street: true, number: true, city: true } },
        category: true,
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    this.logger.log(
      `Ticket created: id=${ticket.id}, status=${ticket.status}, priority=${ticket.priority}`,
    );
    return ticket;
  }

  // ─── List ─────────────────────────────────────────────

  async findAll(query: unknown) {
    let filters: any;
    try {
      filters = TicketFilterSchema.parse(query);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid filter parameters',
          details: err.errors,
        });
      }
      throw err;
    }

    const { page, limit, ...where } = filters;
    const skip = (page - 1) * limit;

    // Build Prisma where clause
    const prismaWhere: any = {};
    if (where.status) prismaWhere.status = where.status;
    if (where.priority) prismaWhere.priority = where.priority;
    if (where.assignedToUserId)
      prismaWhere.assignedToUserId = where.assignedToUserId;
    if (where.propertyId) prismaWhere.propertyId = where.propertyId;
    if (where.categoryId) prismaWhere.categoryId = where.categoryId;

    const [data, total] = await Promise.all([
      this.prisma.client.ticket.findMany({
        where: prismaWhere,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          property: { select: { id: true, title: true, street: true, number: true, city: true } },
          category: { select: { id: true, name: true, color: true, icon: true } },
          createdBy: {
            select: { id: true, firstName: true, lastName: true },
          },
          assignedTo: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.client.ticket.count({ where: prismaWhere }),
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

  // ─── Detail ───────────────────────────────────────────

  async findOne(id: string) {
    const ticket = await this.prisma.client.ticket.findUnique({
      where: { id },
      include: {
        property: { select: { id: true, title: true, street: true, number: true, city: true } },
        category: true,
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        createdByPerson: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true },
            },
            person: {
              select: { id: true, firstName: true, lastName: true },
            },
            attachments: true,
          },
        },
        provider: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException({
        error: 'TICKET_NOT_FOUND',
        message: `Ticket ${id} not found`,
      });
    }

    // Append valid transitions for the current state
    const validTransitions = getValidTicketTransitions(
      ticket.status as TicketStatus,
    );

    return { ...ticket, validTransitions };
  }

  // ─── Update ───────────────────────────────────────────

  async update(id: string, body: unknown) {
    let validated: any;
    try {
      validated = UpdateTicketSchema.parse(body);
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

    // Check ticket exists
    const existing = await this.prisma.client.ticket.findUnique({
      where: { id },
      select: { id: true, tenantId: true, priority: true },
    });
    if (!existing) {
      throw new NotFoundException({
        error: 'TICKET_NOT_FOUND',
        message: `Ticket ${id} not found`,
      });
    }

    // If priority changed, recalculate SLA deadline
    let slaDeadline: Date | null | undefined;
    if (
      validated.priority !== undefined &&
      validated.priority !== existing.priority
    ) {
      slaDeadline = await this.computeSlaDeadline(
        validated.priority,
        existing.tenantId,
      );
    }

    const updateData: any = { ...validated };
    if (slaDeadline !== undefined) {
      updateData.slaDeadline = slaDeadline;
    }

    const ticket = await this.prisma.client.ticket.update({
      where: { id },
      data: updateData,
      include: {
        property: { select: { id: true, title: true, street: true, number: true, city: true } },
        category: true,
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    this.logger.log(`Ticket updated: id=${ticket.id}`);
    return ticket;
  }

  // ─── State Transition ─────────────────────────────────

  async transition(id: string, body: unknown) {
    let validated: any;
    try {
      validated = TransitionTicketStatusSchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid transition data',
          details: err.errors,
        });
      }
      throw err;
    }

    const ticket = await this.prisma.client.ticket.findUnique({
      where: { id },
      select: { id: true, status: true, tenantId: true, title: true, propertyId: true, createdByPersonId: true },
    });
    if (!ticket) {
      throw new NotFoundException({
        error: 'TICKET_NOT_FOUND',
        message: `Ticket ${id} not found`,
      });
    }

    const currentStatus = ticket.status as TicketStatus;
    const targetStatus = validated.status as TicketStatus;

    if (!validateTicketTransition(currentStatus, targetStatus)) {
      const validTargets = getValidTicketTransitions(currentStatus);
      throw new BadRequestException({
        error: 'INVALID_TRANSITION',
        message: `Cannot transition from ${currentStatus} to ${targetStatus}`,
        validTransitions: validTargets,
      });
    }

    // Record timestamps for specific states
    const updateData: any = { status: targetStatus };
    if (targetStatus === TicketStatus.Resuelto) {
      updateData.resolvedAt = new Date();
    }
    if (targetStatus === TicketStatus.Cerrado) {
      updateData.closedAt = new Date();
    }
    // On reopen, clear resolved/closed timestamps
    if (targetStatus === TicketStatus.Reabierto) {
      updateData.resolvedAt = null;
      updateData.closedAt = null;
    }

    const updated = await this.prisma.client.ticket.update({
      where: { id },
      data: updateData,
      include: {
        property: { select: { id: true, title: true, street: true, number: true, city: true } },
        category: true,
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    this.logger.log(
      `Ticket transitioned: id=${id}, ${currentStatus} → ${targetStatus}`,
    );

    // Notify inquilino on status change (non-blocking)
    this.ticketNotifications
      .notifyInquilinoOnStatusChange(
        { id, tenantId: ticket.tenantId, title: ticket.title, propertyId: ticket.propertyId, createdByPersonId: ticket.createdByPersonId },
        currentStatus,
        targetStatus,
      )
      .catch((err) =>
        this.logger.error('Status notification failed', { ticketId: id, error: (err as Error).message }),
      );

    const validTransitions = getValidTicketTransitions(targetStatus);
    return { ...updated, validTransitions };
  }

  // ─── Comments ─────────────────────────────────────────

  async addComment(
    ticketId: string,
    body: unknown,
    file?: Express.Multer.File,
  ) {
    let validated: any;
    try {
      validated = CreateTicketCommentSchema.parse(body);
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

    const tenantId = this.tenantContext.getTenantId()!;
    const userId = this.tenantContext.getUserId()!;

    // Verify ticket exists and fetch notification-relevant fields
    const ticket = await this.prisma.client.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, tenantId: true, title: true, assignedToUserId: true, createdByPersonId: true },
    });
    if (!ticket) {
      throw new NotFoundException({
        error: 'TICKET_NOT_FOUND',
        message: `Ticket ${ticketId} not found`,
      });
    }

    // Create comment
    const comment = await this.prisma.client.ticketComment.create({
      data: {
        tenantId,
        ticketId,
        userId,
        content: validated.content,
      },
      include: {
        user: {
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
      `Comment added to ticket ${ticketId}: commentId=${comment.id}, hasAttachment=${!!attachment}`,
    );

    // Notify on staff comment if ticket was created by portal user (non-blocking)
    if (ticket.createdByPersonId) {
      this.ticketNotifications
        .notifyOnComment(
          { id: ticket.id, tenantId: ticket.tenantId, title: ticket.title, assignedToUserId: ticket.assignedToUserId, createdByPersonId: ticket.createdByPersonId },
          { id: comment.id, content: validated.content },
          false, // staff comment, not portal
        )
        .catch((err) =>
          this.logger.error('Comment notification failed', { ticketId, error: (err as Error).message }),
        );
    }

    return {
      ...comment,
      attachments: attachment ? [attachment] : [],
    };
  }

  async listComments(ticketId: string) {
    // Verify ticket exists
    const ticket = await this.prisma.client.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!ticket) {
      throw new NotFoundException({
        error: 'TICKET_NOT_FOUND',
        message: `Ticket ${ticketId} not found`,
      });
    }

    return this.prisma.client.ticketComment.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true },
        },
        person: {
          select: { id: true, firstName: true, lastName: true },
        },
        attachments: true,
      },
    });
  }

  // ─── Assign Provider ─────────────────────────────────

  /**
   * Assign a provider to a ticket.
   * Validates provider exists and belongs to tenant, sets providerId,
   * transitions status to ProveedorAsignado.
   */
  async assignProvider(ticketId: string, body: unknown) {
    let validated: any;
    try {
      validated = AssignProviderSchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid assign provider data',
          details: err.errors,
        });
      }
      throw err;
    }

    // Verify ticket exists
    const ticket = await this.prisma.client.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, status: true, tenantId: true },
    });
    if (!ticket) {
      throw new NotFoundException({
        error: 'TICKET_NOT_FOUND',
        message: `Ticket ${ticketId} not found`,
      });
    }

    // Verify provider person exists and has a provider profile
    const provider = await this.prisma.client.person.findFirst({
      where: {
        id: validated.providerId,
        tenantId: ticket.tenantId,
        providerProfile: { isNot: null },
      },
      include: { providerProfile: true },
    });
    if (!provider) {
      throw new NotFoundException({
        error: 'PROVIDER_NOT_FOUND',
        message: `Provider ${validated.providerId} not found`,
      });
    }

    // Validate state transition to ProveedorAsignado
    const currentStatus = ticket.status as TicketStatus;
    const targetStatus = TicketStatus.ProveedorAsignado;

    if (!validateTicketTransition(currentStatus, targetStatus)) {
      const validTargets = getValidTicketTransitions(currentStatus);
      throw new BadRequestException({
        error: 'INVALID_TRANSITION',
        message: `Cannot transition from ${currentStatus} to ${targetStatus}`,
        validTransitions: validTargets,
      });
    }

    // Update ticket: set provider, transition status, optionally set notes
    const updated = await this.prisma.client.ticket.update({
      where: { id: ticketId },
      data: {
        providerId: validated.providerId,
        status: targetStatus,
        providerNotes: validated.providerNotes ?? null,
      },
      include: {
        property: { select: { id: true, title: true, street: true, number: true, city: true } },
        category: true,
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        provider: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    this.logger.log(
      `Provider assigned to ticket: ticketId=${ticketId}, providerId=${validated.providerId}, ${currentStatus} → ${targetStatus}`,
    );

    const validTransitions = getValidTicketTransitions(targetStatus);
    return { ...updated, validTransitions };
  }

  // ─── Update Cost ──────────────────────────────────────

  /**
   * Update cost tracking fields on a ticket (amount, currency, payer).
   */
  async updateCost(ticketId: string, body: unknown) {
    let validated: any;
    try {
      validated = UpdateTicketCostSchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid cost data',
          details: err.errors,
        });
      }
      throw err;
    }

    // Verify ticket exists
    const ticket = await this.prisma.client.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!ticket) {
      throw new NotFoundException({
        error: 'TICKET_NOT_FOUND',
        message: `Ticket ${ticketId} not found`,
      });
    }

    const updated = await this.prisma.client.ticket.update({
      where: { id: ticketId },
      data: validated,
      include: {
        property: { select: { id: true, title: true, street: true, number: true, city: true } },
        category: true,
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        provider: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    this.logger.log(`Ticket cost updated: ticketId=${ticketId}`);

    return updated;
  }
}
