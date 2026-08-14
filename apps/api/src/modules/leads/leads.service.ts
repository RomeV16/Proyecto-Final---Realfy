import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreateLeadSchema,
  UpdateLeadSchema,
  MoveLeadStageSchema,
  AssignLeadSchema,
  ConvertLeadSchema,
  LoseLeadSchema,
  LeadFilterSchema,
  LeadStatus,
  PersonRole,
  UserRole,
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

/** Standard includes for lead queries — person, pipeline, currentStage, assignedToUser. */
const LEAD_INCLUDES = {
  person: true,
  pipeline: true,
  currentStage: true,
  assignedToUser: {
    select: { id: true, firstName: true, lastName: true, email: true, role: true },
  },
} as const;

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── List Leads (with filters + pagination) ───────────

  async findAll(query: unknown) {
    let filters: any;
    try {
      filters = LeadFilterSchema.parse(query);
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

    const where: any = {};

    if (filters.pipelineId) where.pipelineId = filters.pipelineId;
    if (filters.currentStageId) where.currentStageId = filters.currentStageId;
    if (filters.assignedToUserId) where.assignedToUserId = filters.assignedToUserId;
    if (filters.source) where.source = filters.source;
    if (filters.status) where.status = filters.status;
    if (filters.isActive !== undefined) where.isActive = filters.isActive;

    // Search across person firstName, lastName, and lead notes
    if (filters.search) {
      where.OR = [
        { person: { firstName: { contains: filters.search, mode: 'insensitive' } } },
        { person: { lastName: { contains: filters.search, mode: 'insensitive' } } },
        { notes: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.lead.findMany({
        where,
        include: LEAD_INCLUDES,
        orderBy: { [filters.sortBy]: filters.sortOrder },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.lead.count({ where }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  // ─── Get Single Lead ──────────────────────────────────

  async findOne(id: string) {
    const lead = await this.prisma.client.lead.findFirst({
      where: { id },
      include: LEAD_INCLUDES,
    });

    if (!lead) {
      throw new NotFoundException({
        error: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    return lead;
  }

  // ─── Create Lead (with person auto-creation + round-robin) ─

  async create(data: unknown) {
    let validated: any;
    try {
      validated = CreateLeadSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid lead data',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Resolve the person — find existing or auto-create
    let personId: string;
    if (validated.personId) {
      // Verify person exists in this tenant
      const person = await this.prisma.client.person.findFirst({
        where: { id: validated.personId },
      });
      if (!person) {
        throw new NotFoundException({
          error: 'PERSON_NOT_FOUND',
          message: 'Person not found',
        });
      }
      personId = person.id;
    } else {
      // Auto-create: find by email OR phone, or create new
      personId = await this._findOrCreatePerson(tenantId, validated);
    }

    // Resolve pipeline and default stage
    const pipeline = await this.prisma.client.pipeline.findFirst({
      where: { id: validated.pipelineId },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!pipeline) {
      throw new NotFoundException({
        error: 'PIPELINE_NOT_FOUND',
        message: 'Pipeline not found',
      });
    }

    // Resolve currentStageId — use provided or find default stage
    let currentStageId = validated.currentStageId;
    if (currentStageId) {
      const stageExists = pipeline.stages.some((s: any) => s.id === currentStageId);
      if (!stageExists) {
        throw new BadRequestException({
          error: 'STAGE_NOT_IN_PIPELINE',
          message: 'The specified stage does not belong to this pipeline',
        });
      }
    } else {
      // Use first stage (lowest sortOrder) as default
      if (pipeline.stages.length === 0) {
        throw new BadRequestException({
          error: 'PIPELINE_HAS_NO_STAGES',
          message: 'Pipeline has no stages — cannot create a lead without a stage',
        });
      }
      currentStageId = pipeline.stages[0].id;
    }

    // Resolve assignedToUserId — use provided or round-robin
    let assignedToUserId = validated.assignedToUserId;
    if (!assignedToUserId) {
      assignedToUserId = await this._roundRobinAssign(tenantId);
    }

    const lead = await this.prisma.client.lead.create({
      data: {
        tenantId,
        personId,
        pipelineId: validated.pipelineId,
        currentStageId,
        propertyId: validated.propertyId ?? null,
        assignedToUserId: assignedToUserId ?? null,
        source: validated.source,
        notes: validated.notes ?? null,
        budget: validated.budget ?? null,
        budgetCurrency: validated.budgetCurrency ?? undefined,
      },
      include: LEAD_INCLUDES,
    });

    this.logger.log(`Created lead`, {
      leadId: lead.id,
      tenantId,
      personId,
      pipelineId: validated.pipelineId,
      currentStageId,
      assignedToUserId: assignedToUserId ?? 'none',
      source: validated.source,
    });

    return lead;
  }

  // ─── Update Lead ──────────────────────────────────────

  async update(id: string, data: unknown) {
    let validated: any;
    try {
      validated = UpdateLeadSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid lead data',
          details: err.errors,
        });
      }
      throw err;
    }

    const existing = await this.prisma.client.lead.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    const lead = await this.prisma.client.lead.update({
      where: { id },
      data: validated,
      include: LEAD_INCLUDES,
    });

    this.logger.log(`Updated lead`, {
      leadId: id,
      tenantId: lead.tenantId,
      fieldsUpdated: Object.keys(validated),
    });

    return lead;
  }

  // ─── Move Stage ───────────────────────────────────────

  async moveStage(id: string, data: unknown) {
    let validated: any;
    try {
      validated = MoveLeadStageSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid stage data',
          details: err.errors,
        });
      }
      throw err;
    }

    const lead = await this.prisma.client.lead.findFirst({
      where: { id },
      include: { pipeline: { include: { stages: true } } },
    });

    if (!lead) {
      throw new NotFoundException({
        error: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    // Validate that the new stage belongs to the same pipeline
    const stageInPipeline = lead.pipeline.stages.some(
      (s: any) => s.id === validated.newStageId,
    );

    if (!stageInPipeline) {
      throw new BadRequestException({
        error: 'STAGE_NOT_IN_PIPELINE',
        message: 'The target stage does not belong to this lead\'s pipeline',
      });
    }

    const updated = await this.prisma.client.lead.update({
      where: { id },
      data: { currentStageId: validated.newStageId },
      include: LEAD_INCLUDES,
    });

    this.logger.log(`Moved lead stage`, {
      leadId: id,
      tenantId: lead.tenantId,
      fromStageId: lead.currentStageId,
      toStageId: validated.newStageId,
      pipelineId: lead.pipelineId,
    });

    return updated;
  }

  // ─── Assign Lead ──────────────────────────────────────

  async assign(id: string, data: unknown) {
    let validated: any;
    try {
      validated = AssignLeadSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid assignment data',
          details: err.errors,
        });
      }
      throw err;
    }

    const lead = await this.prisma.client.lead.findFirst({
      where: { id },
    });

    if (!lead) {
      throw new NotFoundException({
        error: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    const updated = await this.prisma.client.lead.update({
      where: { id },
      data: { assignedToUserId: validated.assignedToUserId },
      include: LEAD_INCLUDES,
    });

    this.logger.log(`Reassigned lead`, {
      leadId: id,
      tenantId: lead.tenantId,
      previousAssignee: lead.assignedToUserId,
      newAssignee: validated.assignedToUserId,
    });

    return updated;
  }

  // ─── Convert Lead ─────────────────────────────────────

  async convert(id: string, data: unknown) {
    let validated: any;
    try {
      validated = ConvertLeadSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid conversion data',
          details: err.errors,
        });
      }
      throw err;
    }

    const lead = await this.prisma.client.lead.findFirst({
      where: { id },
    });

    if (!lead) {
      throw new NotFoundException({
        error: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    if (lead.status === LeadStatus.Convertido) {
      throw new ConflictException({
        error: 'LEAD_ALREADY_CONVERTED',
        message: 'Lead has already been converted',
      });
    }

    if (lead.status === LeadStatus.Perdido) {
      throw new ConflictException({
        error: 'LEAD_ALREADY_LOST',
        message: 'Cannot convert a lost lead',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Set status to Convertido and create the target role on the person
    const updated = await this.prisma.client.lead.update({
      where: { id },
      data: {
        status: LeadStatus.Convertido,
        convertedAt: new Date(),
      },
      include: LEAD_INCLUDES,
    });

    // Create PersonRoleAssignment for the target role (Inquilino or Comprador)
    // Ignore if role already exists (idempotent)
    const existingRole = await this.prisma.client.personRoleAssignment.findFirst({
      where: { personId: lead.personId, role: validated.targetRole },
    });

    if (!existingRole) {
      await this.prisma.client.personRoleAssignment.create({
        data: {
          personId: lead.personId,
          role: validated.targetRole,
          tenantId,
        },
      });
    }

    this.logger.log(`Converted lead`, {
      leadId: id,
      tenantId,
      personId: lead.personId,
      targetRole: validated.targetRole,
    });

    return updated;
  }

  // ─── Lose Lead ────────────────────────────────────────

  async lose(id: string, data: unknown) {
    let validated: any;
    try {
      validated = LoseLeadSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid lost data',
          details: err.errors,
        });
      }
      throw err;
    }

    const lead = await this.prisma.client.lead.findFirst({
      where: { id },
    });

    if (!lead) {
      throw new NotFoundException({
        error: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    if (lead.status === LeadStatus.Perdido) {
      throw new ConflictException({
        error: 'LEAD_ALREADY_LOST',
        message: 'Lead has already been marked as lost',
      });
    }

    if (lead.status === LeadStatus.Convertido) {
      throw new ConflictException({
        error: 'LEAD_ALREADY_CONVERTED',
        message: 'Cannot mark a converted lead as lost',
      });
    }

    const updated = await this.prisma.client.lead.update({
      where: { id },
      data: {
        status: LeadStatus.Perdido,
        lostReason: validated.lostReason,
        lostAt: new Date(),
      },
      include: LEAD_INCLUDES,
    });

    this.logger.log(`Lead marked as lost`, {
      leadId: id,
      tenantId: lead.tenantId,
      lostReason: validated.lostReason,
    });

    return updated;
  }

  // ─── Delete Lead (soft-delete) ────────────────────────

  async remove(id: string) {
    const existing = await this.prisma.client.lead.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'LEAD_NOT_FOUND',
        message: 'Lead not found',
      });
    }

    const deleted = await this.prisma.client.lead.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.log(`Lead soft-deleted`, {
      leadId: id,
      tenantId: existing.tenantId,
    });

    return { deleted: true };
  }

  // ─── Private: Find or Create Person ───────────────────

  private async _findOrCreatePerson(
    tenantId: string,
    data: { firstName: string; lastName: string; email?: string; phone?: string },
  ): Promise<string> {
    // Try to find existing person by email or phone in this tenant
    const orConditions: any[] = [];
    if (data.email) {
      orConditions.push({ email: data.email });
    }
    if (data.phone) {
      orConditions.push({ phone: data.phone });
    }

    if (orConditions.length > 0) {
      const existing = await this.prisma.client.person.findFirst({
        where: { OR: orConditions },
      });

      if (existing) {
        this.logger.log(`Linked lead to existing person`, {
          personId: existing.id,
          tenantId,
          matchedBy: data.email && existing.email === data.email ? 'email' : 'phone',
        });
        return existing.id;
      }
    }

    // Create new person with Lead role
    const person = await this.prisma.client.person.create({
      data: {
        tenantId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email ?? null,
        phone: data.phone ?? null,
      },
    });

    // Assign Lead role
    await this.prisma.client.personRoleAssignment.create({
      data: {
        personId: person.id,
        role: PersonRole.Lead,
        tenantId,
      },
    });

    this.logger.log(`Auto-created person for lead`, {
      personId: person.id,
      tenantId,
      firstName: data.firstName,
      lastName: data.lastName,
    });

    return person.id;
  }

  // ─── Private: Round-Robin Assignment ──────────────────

  private async _roundRobinAssign(tenantId: string): Promise<string | null> {
    // Find all active Ventas users in this tenant
    const ventasUsers = await this.prisma.baseClient.user.findMany({
      where: {
        tenantId,
        role: UserRole.Ventas,
        isActive: true,
      },
      select: { id: true },
    });

    if (ventasUsers.length === 0) {
      return null; // No Ventas users — leave unassigned
    }

    // Count active leads per Ventas user
    const leadCounts = await Promise.all(
      ventasUsers.map(async (user: any) => {
        const count = await this.prisma.client.lead.count({
          where: {
            assignedToUserId: user.id,
            status: { in: [LeadStatus.Nuevo, LeadStatus.Contactado, LeadStatus.Calificado] },
            isActive: true,
          },
        });
        return { userId: user.id, count };
      }),
    );

    // Assign to least-loaded user
    leadCounts.sort((a: any, b: any) => a.count - b.count);
    const leastLoaded = leadCounts[0];

    this.logger.log(`Round-robin assigned lead`, {
      tenantId,
      assignedToUserId: leastLoaded.userId,
      activeLeadCount: leastLoaded.count,
      candidateCount: ventasUsers.length,
    });

    return leastLoaded.userId;
  }
}
