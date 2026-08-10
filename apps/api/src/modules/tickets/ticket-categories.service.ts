import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreateTicketCategorySchema,
  UpdateTicketCategorySchema,
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
export class TicketCategoriesService {
  private readonly logger = new Logger(TicketCategoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── Create ───────────────────────────────────────────

  async create(body: unknown) {
    let validated: any;
    try {
      validated = CreateTicketCategorySchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid category data',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // Check for duplicate name within tenant
    const existing = await this.prisma.client.ticketCategory.findFirst({
      where: { tenantId, name: validated.name },
    });
    if (existing) {
      throw new BadRequestException({
        error: 'DUPLICATE_CATEGORY',
        message: `Category "${validated.name}" already exists`,
      });
    }

    const category = await this.prisma.client.ticketCategory.create({
      data: {
        tenantId,
        name: validated.name,
        icon: validated.icon ?? null,
        color: validated.color ?? null,
        sortOrder: validated.sortOrder ?? 0,
      },
    });

    this.logger.log(`Category created: id=${category.id}, name=${category.name}`);
    return category;
  }

  // ─── List ─────────────────────────────────────────────

  async findAll(activeOnly = true) {
    const where: any = {};
    if (activeOnly) {
      where.isActive = true;
    }

    return this.prisma.client.ticketCategory.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ─── Update ───────────────────────────────────────────

  async update(id: string, body: unknown) {
    let validated: any;
    try {
      validated = UpdateTicketCategorySchema.parse(body);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid category data',
          details: err.errors,
        });
      }
      throw err;
    }

    const existing = await this.prisma.client.ticketCategory.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        error: 'CATEGORY_NOT_FOUND',
        message: `Category ${id} not found`,
      });
    }

    const category = await this.prisma.client.ticketCategory.update({
      where: { id },
      data: validated,
    });

    this.logger.log(`Category updated: id=${category.id}`);
    return category;
  }

  // ─── Soft Delete ──────────────────────────────────────

  async softDelete(id: string) {
    const existing = await this.prisma.client.ticketCategory.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        error: 'CATEGORY_NOT_FOUND',
        message: `Category ${id} not found`,
      });
    }

    const category = await this.prisma.client.ticketCategory.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.log(`Category soft-deleted: id=${category.id}`);
    return category;
  }
}
