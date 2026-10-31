import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreateInteractionSchema,
  InteractionFilterSchema,
  CreateVisitSchema,
  UpdateVisitSchema,
  VisitStatus,
} from '@realfy/shared';
import { parseOrThrow } from '../../common/validation/zod';

@Injectable()
export class InteractionsService {
  private readonly logger = new Logger(InteractionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── Create Interaction ───────────────────────────────

  async createInteraction(leadId: string, body: unknown) {
    const validated: any = parseOrThrow(CreateInteractionSchema, body, 'Invalid interaction data');

    // Verify lead exists in tenant
    const lead = await this.prisma.client.lead.findFirst({
      where: { id: leadId },
    });

    if (!lead) {
      throw new NotFoundException({
        error: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Create interaction and update lastContactAt in a transaction
    const [interaction] = await this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.leadInteraction.create({
        data: {
          tenantId,
          leadId,
          type: validated.type,
          notes: validated.notes ?? null,
          contactedBy: validated.contactedBy ?? null,
          occurredAt: validated.occurredAt ?? new Date(),
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      await tx.lead.update({
        where: { id: leadId },
        data: { lastContactAt: new Date() },
      });

      return [created];
    });

    this.logger.log(`Created interaction`, {
      interactionId: interaction.id,
      leadId,
      tenantId,
      type: validated.type,
    });

    return interaction;
  }

  // ─── List Interactions ────────────────────────────────

  async findInteractions(leadId: string, query: unknown) {
    const filters: any = parseOrThrow(InteractionFilterSchema, query, 'Invalid filter parameters');

    // Verify lead exists in tenant
    const lead = await this.prisma.client.lead.findFirst({
      where: { id: leadId },
    });

    if (!lead) {
      throw new NotFoundException({
        error: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.leadInteraction.findMany({
        where: { leadId },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { occurredAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.leadInteraction.count({ where: { leadId } }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  // ─── Create Visit ────────────────────────────────────

  async createVisit(leadId: string, body: unknown) {
    const validated: any = parseOrThrow(CreateVisitSchema, body, 'Invalid visit data');

    // Verify lead exists in tenant
    const lead = await this.prisma.client.lead.findFirst({
      where: { id: leadId },
    });

    if (!lead) {
      throw new NotFoundException({
        error: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Create visit and update lastContactAt in a transaction
    const [visit] = await this.prisma.client.$transaction(async (tx: any) => {
      const created = await tx.leadVisit.create({
        data: {
          tenantId,
          leadId,
          scheduledAt: validated.scheduledAt,
          propertyId: validated.propertyId ?? null,
          notes: validated.notes ?? null,
          conductedBy: validated.conductedBy ?? null,
          status: VisitStatus.Programada,
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          property: {
            select: { id: true, title: true, street: true, number: true, city: true },
          },
        },
      });

      await tx.lead.update({
        where: { id: leadId },
        data: { lastContactAt: new Date() },
      });

      return [created];
    });

    this.logger.log(`Created visit`, {
      visitId: visit.id,
      leadId,
      tenantId,
      scheduledAt: validated.scheduledAt,
    });

    return visit;
  }

  // ─── List Visits ──────────────────────────────────────

  async findVisits(leadId: string, query: unknown) {
    const filters: any = parseOrThrow(InteractionFilterSchema, query, 'Invalid filter parameters');

    // Verify lead exists in tenant
    const lead = await this.prisma.client.lead.findFirst({
      where: { id: leadId },
    });

    if (!lead) {
      throw new NotFoundException({
        error: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.leadVisit.findMany({
        where: { leadId },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          property: {
            select: { id: true, title: true, street: true, number: true, city: true },
          },
        },
        orderBy: { scheduledAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.leadVisit.count({ where: { leadId } }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  // ─── Update Visit ────────────────────────────────────

  async updateVisit(leadId: string, visitId: string, body: unknown) {
    const validated: any = parseOrThrow(UpdateVisitSchema, body, 'Invalid visit update data');

    // Verify lead exists in tenant
    const lead = await this.prisma.client.lead.findFirst({
      where: { id: leadId },
    });

    if (!lead) {
      throw new NotFoundException({
        error: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    // Verify visit exists and belongs to this lead
    const visit = await this.prisma.client.leadVisit.findFirst({
      where: { id: visitId, leadId },
    });

    if (!visit) {
      throw new NotFoundException({
        error: 'VISIT_NOT_FOUND',
        message: 'Visit not found',
      });
    }

    // Auto-set completedAt when status changes to Completada and completedAt not provided
    const updateData: any = { ...validated };
    if (
      updateData.status === VisitStatus.Completada &&
      !updateData.completedAt
    ) {
      updateData.completedAt = new Date();
    }

    const updated = await this.prisma.client.leadVisit.update({
      where: { id: visitId },
      data: updateData,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        property: {
          select: { id: true, title: true, street: true, number: true, city: true },
        },
      },
    });

    this.logger.log(`Updated visit`, {
      visitId,
      leadId,
      tenantId: lead.tenantId,
      fieldsUpdated: Object.keys(validated),
    });

    return updated;
  }
}
