import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { MediaService } from '../../common/media/media.service';
import {
  CreatePropertySchema,
  UpdatePropertySchema,
  PropertyFilterSchema,
  CreatePropertyOperationSchema,
  TransitionPropertyStateSchema,
  validateTransition,
  getValidTransitions,
  PropertyState,
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
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly media: MediaService,
  ) {}

  // ─── List ───────────────────────────────────────────

  async findAll(query: unknown) {
    let filters: any;
    try {
      filters = PropertyFilterSchema.parse(query);
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

    if (filters.type) where.type = filters.type;
    if (filters.city) where.city = { contains: filters.city, mode: 'insensitive' };
    if (filters.province) where.province = filters.province;
    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { street: { contains: filters.search, mode: 'insensitive' } },
        { city: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Price range filter on the property's display price
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      where.price = {};
      if (filters.minPrice !== undefined) where.price.gte = filters.minPrice;
      if (filters.maxPrice !== undefined) where.price.lte = filters.maxPrice;
    }
    if (filters.currency) where.currency = filters.currency;

    // Area range
    if (filters.minArea !== undefined || filters.maxArea !== undefined) {
      where.area = {};
      if (filters.minArea !== undefined) where.area.gte = filters.minArea;
      if (filters.maxArea !== undefined) where.area.lte = filters.maxArea;
    }
    if (filters.minRooms !== undefined) where.rooms = { gte: filters.minRooms };
    if (filters.bedrooms !== undefined) where.bedrooms = { gte: filters.bedrooms };

    // Filter by operation type/state via nested operations
    if (filters.operationType || filters.state) {
      where.operations = { some: {} };
      if (filters.operationType) where.operations.some.operationType = filters.operationType;
      if (filters.state) where.operations.some.state = filters.state;
    }

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.property.findMany({
        where,
        include: {
          operations: true,
          media: {
            where: { isPrimary: true },
            take: 1,
          },
        },
        orderBy: { [filters.sortBy]: filters.sortOrder },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.property.count({ where }),
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

  async findOne(id: string) {
    const property = await this.prisma.client.property.findFirst({
      where: { id },
      include: {
        operations: true,
        media: { orderBy: { sortOrder: 'asc' } },
        priceHistory: { orderBy: { changedAt: 'desc' } },
      },
    });

    if (!property) {
      throw new NotFoundException({
        error: 'PROPERTY_NOT_FOUND',
        message: 'Property not found',
      });
    }

    return property;
  }

  // ─── Create ─────────────────────────────────────────

  async create(data: unknown) {
    let validated: any;
    try {
      validated = CreatePropertySchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid property data',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;

    const property = await this.prisma.client.property.create({
      data: {
        ...validated,
        tenantId,
      },
      include: {
        operations: true,
        media: true,
      },
    });

    // If price is set, create initial PriceHistory record
    if (validated.price !== undefined && validated.price !== null) {
      await this.prisma.client.priceHistory.create({
        data: {
          propertyId: property.id,
          price: validated.price,
          currency: validated.currency ?? 'ARS',
          changedByUserId: this.tenantContext.getUserId() ?? null,
          tenantId,
        },
      });
    }

    return property;
  }

  // ─── Update ─────────────────────────────────────────

  async update(id: string, data: unknown) {
    let validated: any;
    try {
      validated = UpdatePropertySchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid property data',
          details: err.errors,
        });
      }
      throw err;
    }

    // Fetch existing to check existence and compare price
    const existing = await this.prisma.client.property.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'PROPERTY_NOT_FOUND',
        message: 'Property not found',
      });
    }

    const updated = await this.prisma.client.property.update({
      where: { id },
      data: validated,
      include: {
        operations: true,
        media: true,
      },
    });

    // Track price changes in PriceHistory
    const priceChanged =
      validated.price !== undefined &&
      String(validated.price) !== String(existing.price);
    const currencyChanged =
      validated.currency !== undefined &&
      validated.currency !== existing.currency;

    if (priceChanged || currencyChanged) {
      const tenantId = this.tenantContext.getTenantId()!;
      await this.prisma.client.priceHistory.create({
        data: {
          propertyId: id,
          price: validated.price ?? Number(existing.price),
          currency: validated.currency ?? existing.currency,
          changedByUserId: this.tenantContext.getUserId() ?? null,
          tenantId,
        },
      });
      this.logger.log(
        `Price history recorded: propertyId=${id} price=${validated.price ?? existing.price} currency=${validated.currency ?? existing.currency}`,
      );
    }

    return updated;
  }

  // ─── Soft Delete ────────────────────────────────────

  async softDelete(id: string) {
    const existing = await this.prisma.client.property.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'PROPERTY_NOT_FOUND',
        message: 'Property not found',
      });
    }

    return this.prisma.client.property.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ─── Operations ─────────────────────────────────────

  async addOperation(propertyId: string, data: unknown) {
    let validated: any;
    try {
      validated = CreatePropertyOperationSchema.parse({
        ...((data as any) || {}),
        propertyId,
      });
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid operation data',
          details: err.errors,
        });
      }
      throw err;
    }

    // Check property exists
    const property = await this.prisma.client.property.findFirst({
      where: { id: propertyId },
    });

    if (!property) {
      throw new NotFoundException({
        error: 'PROPERTY_NOT_FOUND',
        message: 'Property not found',
      });
    }

    // Check uniqueness — the schema has @@unique([propertyId, operationType])
    const existing = await this.prisma.client.propertyOperation.findFirst({
      where: {
        propertyId,
        operationType: validated.operationType,
      },
    });

    if (existing) {
      throw new BadRequestException({
        error: 'OPERATION_ALREADY_EXISTS',
        message: `Property already has a ${validated.operationType} operation`,
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    return this.prisma.client.propertyOperation.create({
      data: {
        propertyId,
        operationType: validated.operationType,
        price: validated.price,
        currency: validated.currency,
        tenantId,
      },
    });
  }

  // ─── State Transitions ──────────────────────────────

  async transitionState(
    propertyId: string,
    operationId: string,
    data: unknown,
  ) {
    let validated: any;
    try {
      validated = TransitionPropertyStateSchema.parse({
        ...((data as any) || {}),
        operationId,
      });
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid state transition data',
          details: err.errors,
        });
      }
      throw err;
    }

    // Fetch the operation
    const operation = await this.prisma.client.propertyOperation.findFirst({
      where: { id: operationId, propertyId },
    });

    if (!operation) {
      throw new NotFoundException({
        error: 'OPERATION_NOT_FOUND',
        message: 'Property operation not found',
      });
    }

    const fromState = operation.state as PropertyState;
    const toState = validated.toState as PropertyState;

    // Validate via shared state machine
    if (!validateTransition(operation.operationType as any, fromState, toState)) {
      const validTargets = getValidTransitions(
        operation.operationType as any,
        fromState,
      );
      this.logger.warn(
        `Invalid state transition attempted: operationId=${operationId} from=${fromState} to=${toState} validTargets=[${validTargets.join(',')}]`,
      );
      throw new BadRequestException({
        error: 'INVALID_STATE_TRANSITION',
        message: `Cannot transition from ${fromState} to ${toState}`,
        validTransitions: validTargets,
        currentState: fromState,
        attemptedState: toState,
      });
    }

    const updated = await this.prisma.client.propertyOperation.update({
      where: { id: operationId },
      data: { state: toState as any },
    });

    this.logger.log(
      `State transition: operationId=${operationId} ${fromState} → ${toState}`,
    );

    return updated;
  }

  // ─── Media ──────────────────────────────────────────

  async uploadMedia(
    propertyId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
  ) {
    // Check property exists first
    const property = await this.prisma.client.property.findFirst({
      where: { id: propertyId },
    });

    if (!property) {
      throw new NotFoundException({
        error: 'PROPERTY_NOT_FOUND',
        message: 'Property not found',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Generate a unique media ID for the S3 key prefix
    const mediaId = crypto.randomUUID();
    const keyPrefix = `${tenantId}/properties/${propertyId}/${mediaId}`;

    // Upload to S3 BEFORE creating DB record — prevents orphan records on upload failure
    const processed = await this.media.processAndUpload(file, keyPrefix);

    // Get current media count for sort order
    const mediaCount = await this.prisma.client.propertyMedia.count({
      where: { propertyId },
    });

    const mediaRecord = await this.prisma.client.propertyMedia.create({
      data: {
        id: mediaId,
        propertyId,
        url: processed.url,
        thumbnailUrl: processed.thumbnailUrl,
        mimeType: 'image/jpeg',
        sizeBytes: processed.sizeBytes,
        width: processed.width,
        height: processed.height,
        sortOrder: mediaCount,
        isPrimary: mediaCount === 0, // first image is primary by default
        tenantId,
      },
    });

    return mediaRecord;
  }

  async deleteMedia(propertyId: string, mediaId: string) {
    const mediaRecord = await this.prisma.client.propertyMedia.findFirst({
      where: { id: mediaId, propertyId },
    });

    if (!mediaRecord) {
      throw new NotFoundException({
        error: 'MEDIA_NOT_FOUND',
        message: 'Media not found',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;
    const keyPrefix = `${tenantId}/properties/${propertyId}/${mediaId}`;

    // Delete from S3 (best-effort) and database
    await this.media.deleteMedia(keyPrefix);
    await this.prisma.client.propertyMedia.delete({
      where: { id: mediaId },
    });

    return { deleted: true };
  }

  async reorderMedia(propertyId: string, mediaIds: string[]) {
    if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'mediaIds must be a non-empty array of media IDs',
      });
    }

    // Verify property exists
    const property = await this.prisma.client.property.findFirst({
      where: { id: propertyId },
    });

    if (!property) {
      throw new NotFoundException({
        error: 'PROPERTY_NOT_FOUND',
        message: 'Property not found',
      });
    }

    // Update sort order for each media record
    const updates = mediaIds.map((id, index) =>
      this.prisma.client.propertyMedia.updateMany({
        where: { id, propertyId },
        data: { sortOrder: index },
      }),
    );

    await Promise.all(updates);

    return this.prisma.client.propertyMedia.findMany({
      where: { propertyId },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
