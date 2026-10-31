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
import { parseOrThrow } from '../../common/validation/zod';

@Injectable()
export class TicketCategoriesService {
  private readonly logger = new Logger(TicketCategoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── Create ───────────────────────────────────────────

  async create(body: unknown) {
    const validated: any = parseOrThrow(CreateTicketCategorySchema, body, 'Invalid category data');

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
    const validated: any = parseOrThrow(UpdateTicketCategorySchema, body, 'Invalid category data');

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
