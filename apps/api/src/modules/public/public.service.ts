import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  PublicPropertyFilterSchema,
  CreatePublicInquirySchema,
  PropertyState,
  PropertyOperationType,
  PipelineType,
  LeadSource,
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

/** Property columns exposed on the public portal — no address number, no geo, no relations beyond media/operations. */
const PROPERTY_LIST_SELECT = {
  id: true,
  title: true,
  type: true,
  price: true,
  currency: true,
  city: true,
  province: true,
  street: true,
  area: true,
  rooms: true,
  bedrooms: true,
  bathrooms: true,
  garages: true,
} as const;

@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Properties: List ─────────────────────────────────

  async findProperties(tenantId: string, query: unknown) {
    let filters: any;
    try {
      filters = PublicPropertyFilterSchema.parse(query);
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

    const availability: any = { state: PropertyState.Disponible };
    if (filters.operation) availability.operationType = filters.operation;

    const where: any = {
      tenantId,
      isActive: true,
      operations: { some: availability },
    };
    if (filters.type) where.type = filters.type;
    if (filters.city) where.city = { contains: filters.city, mode: 'insensitive' };

    const skip = (filters.page - 1) * filters.limit;

    const [rows, total] = await Promise.all([
      this.prisma.baseClient.property.findMany({
        where,
        select: {
          ...PROPERTY_LIST_SELECT,
          operations: {
            where: availability,
            orderBy: { operationType: 'asc' },
            select: { operationType: true, price: true, currency: true },
          },
          media: {
            orderBy: { sortOrder: 'asc' },
            select: { url: true, thumbnailUrl: true, isPrimary: true },
          },
          _count: { select: { media: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.baseClient.property.count({ where }),
    ]);

    return {
      items: rows.map((row: any) => this._toListItem(row)),
      total,
      page: filters.page,
      limit: filters.limit,
    };
  }

  // ─── Properties: Detail ───────────────────────────────

  async findProperty(tenantId: string, propertyId: string) {
    const property = await this.prisma.baseClient.property.findFirst({
      where: {
        id: propertyId,
        tenantId,
        isActive: true,
        operations: { some: { state: PropertyState.Disponible } },
      },
      select: {
        ...PROPERTY_LIST_SELECT,
        description: true,
        amenities: true,
        operations: {
          where: { state: PropertyState.Disponible },
          orderBy: { operationType: 'asc' },
          select: { operationType: true, price: true, currency: true },
        },
        media: {
          orderBy: { sortOrder: 'asc' },
          select: { url: true, thumbnailUrl: true, sortOrder: true, isPrimary: true },
        },
      },
    });

    if (!property) {
      throw new NotFoundException({
        error: 'PROPERTY_NOT_FOUND',
        message: 'Property not found',
      });
    }

    const item = this._toListItem(property);

    return {
      ...item,
      description: property.description ?? null,
      amenities: property.amenities,
      media: property.media.map((m: any) => ({
        url: m.url,
        thumbnailUrl: m.thumbnailUrl,
        sortOrder: m.sortOrder,
        isPrimary: m.isPrimary,
      })),
    };
  }

  // ─── Inquiries ─────────────────────────────────────────

  async createInquiry(tenantId: string, body: unknown) {
    let validated: any;
    try {
      validated = CreatePublicInquirySchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid inquiry data',
          details: err.errors,
        });
      }
      throw err;
    }

    // Resolve the linked property, if any — silently drop it if it isn't
    // this tenant's or isn't currently available, rather than failing.
    let property: any = null;
    if (validated.propertyId) {
      property = await this.prisma.baseClient.property.findFirst({
        where: {
          id: validated.propertyId,
          tenantId,
          isActive: true,
          operations: { some: { state: PropertyState.Disponible } },
        },
        select: {
          id: true,
          operations: {
            where: { state: PropertyState.Disponible },
            orderBy: { operationType: 'asc' },
            select: { operationType: true },
          },
        },
      });
    }

    const operationType = property?.operations[0]?.operationType;
    const pipeline = await this._resolvePipeline(tenantId, operationType);
    if (!pipeline) {
      throw new ConflictException({
        error: 'NO_PIPELINE_CONFIGURED',
        message: 'This inmobiliaria has no embudo configured',
      });
    }

    const personId = await this._findOrCreatePerson(tenantId, validated);
    const assignedToUserId = await this._roundRobinAssign(tenantId);

    const lead = await this.prisma.baseClient.lead.create({
      data: {
        tenantId,
        personId,
        pipelineId: pipeline.id,
        currentStageId: pipeline.stageId,
        propertyId: property?.id ?? null,
        assignedToUserId: assignedToUserId ?? null,
        source: LeadSource.WebInquiry,
        notes: validated.message,
      },
      select: { id: true },
    });

    this.logger.log(`Public inquiry created: leadId=${lead.id} tenantId=${tenantId}`);

    return { id: lead.id };
  }

  // ─── Private: shape a property row into the public list/detail item ────

  private _toListItem(row: any) {
    const availableOp = row.operations?.[0];
    const primaryMedia = row.media?.find((m: any) => m.isPrimary) ?? row.media?.[0] ?? null;

    return {
      id: row.id,
      title: row.title,
      type: row.type,
      operationType: availableOp?.operationType ?? null,
      price: availableOp?.price ?? row.price,
      currency: availableOp?.currency ?? row.currency,
      city: row.city,
      province: row.province,
      street: row.street,
      area: row.area,
      rooms: row.rooms,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      garages: row.garages,
      coverUrl: primaryMedia ? primaryMedia.thumbnailUrl ?? primaryMedia.url : null,
      mediaCount: row._count?.media ?? row.media?.length ?? 0,
    };
  }

  // ─── Private: pick the tenant's embudo + first stage for a new lead ────

  /**
   * Prefers the pipeline matching the linked property's operation type
   * (Venta -> Venta pipeline, Alquiler/Temporario -> Alquiler pipeline).
   * Falls back to any active pipeline that has at least one stage.
   */
  private async _resolvePipeline(
    tenantId: string,
    operationType?: PropertyOperationType,
  ): Promise<{ id: string; stageId: string } | null> {
    const preferredType = !operationType
      ? undefined
      : operationType === PropertyOperationType.Venta
        ? PipelineType.Venta
        : PipelineType.Alquiler;

    const pipelines = await this.prisma.baseClient.pipeline.findMany({
      where: { tenantId, isActive: true },
      orderBy: { type: 'asc' },
      select: {
        id: true,
        type: true,
        stages: { orderBy: { sortOrder: 'asc' }, take: 1, select: { id: true } },
      },
    });

    const withStages = pipelines.filter((p: any) => p.stages.length > 0);
    if (withStages.length === 0) return null;

    const chosen =
      (preferredType && withStages.find((p: any) => p.type === preferredType)) ?? withStages[0];

    return { id: chosen.id, stageId: chosen.stages[0].id };
  }

  // ─── Private: find-or-create the person behind the inquiry ─────────────

  private async _findOrCreatePerson(
    tenantId: string,
    data: { firstName: string; lastName: string; email?: string; phone?: string },
  ): Promise<string> {
    const orConditions: any[] = [];
    if (data.email) orConditions.push({ email: data.email });
    if (data.phone) orConditions.push({ phone: data.phone });

    if (orConditions.length > 0) {
      const existing = await this.prisma.baseClient.person.findFirst({
        where: { tenantId, OR: orConditions },
        select: { id: true },
      });
      if (existing) return existing.id;
    }

    const person = await this.prisma.baseClient.person.create({
      data: {
        tenantId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email ?? null,
        phone: data.phone ?? null,
      },
      select: { id: true },
    });

    await this.prisma.baseClient.personRoleAssignment.create({
      data: { personId: person.id, role: PersonRole.Lead, tenantId },
    });

    return person.id;
  }

  // ─── Private: round-robin assignment among active Ventas users ─────────

  private async _roundRobinAssign(tenantId: string): Promise<string | null> {
    const ventasUsers = await this.prisma.baseClient.user.findMany({
      where: { tenantId, role: UserRole.Ventas, isActive: true },
      select: { id: true },
    });

    if (ventasUsers.length === 0) return null;

    const leadCounts = await Promise.all(
      ventasUsers.map(async (user: any) => {
        const count = await this.prisma.baseClient.lead.count({
          where: {
            tenantId,
            assignedToUserId: user.id,
            status: { in: [LeadStatus.Nuevo, LeadStatus.Contactado, LeadStatus.Calificado] },
            isActive: true,
          },
        });
        return { userId: user.id, count };
      }),
    );

    leadCounts.sort((a, b) => a.count - b.count);
    return leadCounts[0].userId;
  }
}
