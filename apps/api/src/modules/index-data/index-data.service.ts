import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { TenantIsolationError } from '../../common/tenant/tenant-isolation.error';
import {
  CreateIndexDataSchema,
  IndexDataFilterSchema,
  IndexType,
} from '@realfy/shared';

/**
 * Identificador bajo el que el scraper guarda los índices publicados por el
 * BCRA y el INDEC. Son datos públicos, iguales para todas las inmobiliarias:
 * cada una los ve junto con sus propias cargas manuales, y la carga manual
 * tiene prioridad para el mismo tipo y período (DEF-01).
 */
export const SYSTEM_TENANT_ID = '__system__';

interface IndexRow {
  tenantId: string;
  indexType: string;
  period: Date;
}

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

/**
 * Entre una fila propia y una de sistema para el mismo (tipo, período), gana
 * la propia. Conserva el orden de entrada para el resto.
 */
export function mergeVisibleRows<T extends IndexRow>(rows: T[], tenantId: string): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.indexType}|${row.period.toISOString()}`;
    const current = byKey.get(key);
    if (!current || (current.tenantId === SYSTEM_TENANT_ID && row.tenantId === tenantId)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

@Injectable()
export class IndexDataService {
  private readonly logger = new Logger(IndexDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Las lecturas de índices unen la inmobiliaria actual con los valores de
   * sistema, así que no pueden pasar por la extensión de aislamiento (que
   * fija un único tenantId). Se usa el cliente base con el filtro explícito y,
   * fiel al ADR-0006, sin inmobiliaria en contexto se falla cerrado.
   */
  private requireTenantId(operation: string): string {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) throw new TenantIsolationError('IndexData', operation);
    return tenantId;
  }

  private visibleTo(tenantId: string) {
    return { tenantId: { in: [tenantId, SYSTEM_TENANT_ID] } };
  }

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

    const tenantId = this.requireTenantId('findMany');
    const where: any = this.visibleTo(tenantId);

    if (filters.indexType) where.indexType = filters.indexType;

    if (filters.periodFrom || filters.periodTo) {
      where.period = {};
      if (filters.periodFrom) where.period.gte = new Date(filters.periodFrom);
      if (filters.periodTo) where.period.lte = new Date(filters.periodTo);
    }

    // La unión propia + sistema se resuelve en memoria: el volumen de índices
    // es chico (una fila por día o por mes y por tipo) y la paginación se
    // aplica después de quitar los duplicados por período.
    const rows = await this.prisma.baseClient.indexData.findMany({
      where,
      orderBy: { period: 'desc' },
    });
    const visible = mergeVisibleRows(rows, tenantId);

    const skip = (filters.page - 1) * filters.limit;
    const total = visible.length;

    return {
      items: visible.slice(skip, skip + filters.limit),
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
    // Solo las filas propias se pueden borrar: las de sistema no son de nadie.
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

  /**
   * Valores de un índice entre dos fechas, inclusive, en orden ascendente:
   * los propios de la inmobiliaria más los de sistema, con prioridad para los
   * propios. Es el único punto de lectura para el cálculo de ajustes
   * (`ContractAdjustmentService`, `ContractsService`).
   *
   * `tenantId` se pasa cuando no hay petición en curso (barridos del
   * sistema); `client` permite leer dentro de una transacción.
   */
  async getForPeriod(
    indexType: IndexType,
    startDate: Date,
    endDate: Date,
    options: { tenantId?: string; client?: { indexData: { findMany: (args: any) => Promise<any[]> } } } = {},
  ) {
    const tenantId = options.tenantId ?? this.requireTenantId('findMany');
    const client = options.client ?? this.prisma.baseClient;

    const rows = await client.indexData.findMany({
      where: {
        ...this.visibleTo(tenantId),
        indexType: indexType as any,
        period: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { period: 'asc' },
    });

    return mergeVisibleRows(rows, tenantId);
  }

  // ─── Latest per IndexType ────────────────────────────────

  async findLatest(): Promise<{ indexType: IndexType; latest: any; history: any[] }[]> {
    const tenantId = this.requireTenantId('findMany');
    const indexTypes = Object.values(IndexType);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return Promise.all(
      indexTypes.map(async (indexType) => {
        // Dos filas alcanzan para resolver el empate propio/sistema del último período.
        const newest = await this.prisma.baseClient.indexData.findMany({
          where: { ...this.visibleTo(tenantId), indexType: indexType as any },
          orderBy: { period: 'desc' },
          take: 2,
        });
        const row = mergeVisibleRows(newest, tenantId)[0];

        const history = mergeVisibleRows(
          await this.prisma.baseClient.indexData.findMany({
            where: {
              ...this.visibleTo(tenantId),
              indexType: indexType as any,
              period: { gte: thirtyDaysAgo },
            },
            orderBy: { period: 'asc' },
          }),
          tenantId,
        );

        return row ? { indexType, latest: row, history } : null;
      }),
    ).then((results) => results.filter((r) => r !== null));
  }
}
