import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreateValuationSchema,
  UpdateValuationSchema,
  ValuationFilterSchema,
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
export class ValuationsService {
  private readonly logger = new Logger(ValuationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── List valuations for a property ─────────────────

  async findAll(propertyId: string, query: unknown) {
    let filters: any;
    try {
      filters = ValuationFilterSchema.parse(query);
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

    await this.ensurePropertyExists(propertyId);

    const where: any = { propertyId };
    if (filters.method) where.method = filters.method;

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.propertyValuation.findMany({
        where,
        orderBy: { valuationDate: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.propertyValuation.count({ where }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  // ─── Detail ─────────────────────────────────────────

  async findOne(propertyId: string, valuationId: string) {
    const valuation = await this.prisma.client.propertyValuation.findFirst({
      where: { id: valuationId, propertyId },
    });

    if (!valuation) {
      throw new NotFoundException({
        error: 'VALUATION_NOT_FOUND',
        message: 'Valuation not found',
      });
    }

    return valuation;
  }

  // ─── Create ─────────────────────────────────────────

  async create(propertyId: string, data: unknown) {
    let validated: any;
    try {
      validated = CreateValuationSchema.parse({
        ...((data as any) || {}),
        propertyId,
      });
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid valuation data',
          details: err.errors,
        });
      }
      throw err;
    }

    await this.ensurePropertyExists(propertyId);

    const tenantId = this.tenantContext.getTenantId()!;

    const valuation = await this.prisma.client.propertyValuation.create({
      data: {
        propertyId,
        valuationDate: new Date(validated.valuationDate),
        value: validated.value,
        currency: validated.currency,
        method: validated.method,
        appraiser: validated.appraiser ?? null,
        notes: validated.notes ?? null,
        tenantId,
      },
    });

    this.logger.log(
      `Valuation created: id=${valuation.id} propertyId=${propertyId} value=${validated.value} method=${validated.method}`,
    );

    return valuation;
  }

  // ─── Update ─────────────────────────────────────────

  async update(propertyId: string, valuationId: string, data: unknown) {
    let validated: any;
    try {
      validated = UpdateValuationSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid valuation data',
          details: err.errors,
        });
      }
      throw err;
    }

    const existing = await this.prisma.client.propertyValuation.findFirst({
      where: { id: valuationId, propertyId },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'VALUATION_NOT_FOUND',
        message: 'Valuation not found',
      });
    }

    const updateData: any = { ...validated };
    if (validated.valuationDate) {
      updateData.valuationDate = new Date(validated.valuationDate);
    }

    const updated = await this.prisma.client.propertyValuation.update({
      where: { id: valuationId },
      data: updateData,
    });

    this.logger.log(
      `Valuation updated: id=${valuationId} propertyId=${propertyId}`,
    );

    return updated;
  }

  // ─── Delete ─────────────────────────────────────────

  async remove(propertyId: string, valuationId: string) {
    const existing = await this.prisma.client.propertyValuation.findFirst({
      where: { id: valuationId, propertyId },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'VALUATION_NOT_FOUND',
        message: 'Valuation not found',
      });
    }

    await this.prisma.client.propertyValuation.delete({
      where: { id: valuationId },
    });

    this.logger.log(
      `Valuation deleted: id=${valuationId} propertyId=${propertyId}`,
    );

    return { deleted: true };
  }

  // ─── Comparable Properties ──────────────────────────

  /**
   * Finds properties comparable to the given one based on:
   * - Same city
   * - Same property type
   * - Similar room count (±1)
   * - Excludes the current property
   * Returns each comparable with its latest valuation.
   */
  async findComparables(propertyId: string) {
    const property = await this.prisma.client.property.findFirst({
      where: { id: propertyId },
    });

    if (!property) {
      throw new NotFoundException({
        error: 'PROPERTY_NOT_FOUND',
        message: 'Property not found',
      });
    }

    // Build comparable filter: same city, same type, rooms ±1
    const where: any = {
      id: { not: propertyId },
      type: property.type,
      isActive: true,
    };

    if (property.city) {
      where.city = { equals: property.city, mode: 'insensitive' };
    }

    if (property.rooms !== null && property.rooms !== undefined) {
      where.rooms = {
        gte: property.rooms - 1,
        lte: property.rooms + 1,
      };
    }

    const comparables = await this.prisma.client.property.findMany({
      where,
      include: {
        valuations: {
          orderBy: { valuationDate: 'desc' },
          take: 1,
        },
      },
      take: 20,
    });

    return comparables.map((comp: any) => ({
      id: comp.id,
      title: comp.title,
      type: comp.type,
      city: comp.city,
      rooms: comp.rooms,
      area: comp.area,
      price: comp.price,
      currency: comp.currency,
      latestValuation: comp.valuations[0] ?? null,
    }));
  }

  // ─── Helpers ────────────────────────────────────────

  private async ensurePropertyExists(propertyId: string) {
    const property = await this.prisma.client.property.findFirst({
      where: { id: propertyId },
    });

    if (!property) {
      throw new NotFoundException({
        error: 'PROPERTY_NOT_FOUND',
        message: 'Property not found',
      });
    }

    return property;
  }
}
