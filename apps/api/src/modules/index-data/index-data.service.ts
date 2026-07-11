import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreateIndexDataSchema,
  IndexDataFilterSchema,
  IndexType,
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
export class IndexDataService {
  private readonly logger = new Logger(IndexDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── List ───────────────────────────────────────────

  async findAll(query: unknown) {
    let filters: any;
    try {
      filters = IndexDataFilterSchema.parse(query);
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

    if (filters.indexType) where.indexType = filters.indexType;

    if (filters.periodFrom || filters.periodTo) {
      where.period = {};
      if (filters.periodFrom) where.period.gte = new Date(filters.periodFrom);
      if (filters.periodTo) where.period.lte = new Date(filters.periodTo);
    }

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.indexData.findMany({
        where,
        orderBy: { period: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.indexData.count({ where }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  // ─── Create (upsert) ───────────────────────────────

  async create(data: unknown) {
    let validated: any;
    try {
      validated = CreateIndexDataSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid index data',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;
    const period = new Date(validated.period);

    // Upsert by [tenantId, indexType, period] unique constraint
    const record = await this.prisma.client.indexData.upsert({
      where: {
        tenantId_indexType_period: {
          tenantId,
          indexType: validated.indexType,
          period,
        },
      },
      update: {
        value: validated.value,
        source: validated.source ?? null,
      },
      create: {
        tenantId,
        indexType: validated.indexType,
        period,
        value: validated.value,
        source: validated.source ?? null,
      },
    });

    this.logger.log('Created/updated index data', {
      indexDataId: record.id,
      tenantId,
      indexType: validated.indexType,
      period: period.toISOString(),
    });

    return record;
  }

  // ─── Bulk Create ────────────────────────────────────

  async createBulk(data: unknown) {
    if (!Array.isArray(data)) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Body must be an array of index data points',
      });
    }

    const results = [];
    for (const item of data) {
      results.push(await this.create(item));
    }

    this.logger.log('Bulk created index data', {
      count: results.length,
      tenantId: this.tenantContext.getTenantId(),
    });

    return results;
  }

  // ─── Delete ─────────────────────────────────────────

  async delete(id: string) {
    const existing = await this.prisma.client.indexData.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'INDEX_DATA_NOT_FOUND',
        message: 'Index data not found',
      });
    }

    await this.prisma.client.indexData.delete({
      where: { id },
    });

    this.logger.log('Deleted index data', {
      indexDataId: id,
      tenantId: this.tenantContext.getTenantId(),
      indexType: existing.indexType,
      period: existing.period.toISOString(),
    });

    return { deleted: true };
  }

  // ─── Get for period range (used by adjustment calculation) ──

  async getForPeriod(indexType: IndexType, startDate: Date, endDate: Date) {
    return this.prisma.client.indexData.findMany({
      where: {
        indexType: indexType as any,
        period: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { period: 'asc' },
    });
  }

  // ─── Latest per IndexType ────────────────────────────────

  async findLatest(): Promise<{ indexType: IndexType; latest: any; history: any[] }[]> {
    const indexTypes = Object.values(IndexType);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return Promise.all(
      indexTypes.map(async (indexType) => {
        const row = await this.prisma.client.indexData.findFirst({
          where: { indexType: indexType as any },
          orderBy: { period: 'desc' },
        });

        const history = await this.prisma.client.indexData.findMany({
          where: {
            indexType: indexType as any,
            period: { gte: thirtyDaysAgo },
          },
          orderBy: { period: 'asc' },
        });

        return row ? { indexType, latest: row, history } : null;
      }),
    ).then((results) => results.filter((r) => r !== null));
  }
}
