import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { TenantIsolationError } from '../../common/tenant/tenant-isolation.error';
import {
  CreateIndexDataSchema,
  IndexDataFilterSchema,
  IndexType,
} from '@realfy/shared';
import { parseOrThrow } from '../../common/validation/zod';

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
    const filters: any = parseOrThrow(IndexDataFilterSchema, query, 'Invalid filter parameters');

    const tenantId = this.requireTenantId('findMany');

    // Unión propia + sistema resuelta en SQL: DISTINCT ON deja una fila por
    // (tipo, período) prefiriendo la propia, y la paginación se aplica sobre
    // ese conjunto. Antes se traían todas las filas visibles y se paginaba en
    // memoria; con dos años de índices diarios eso eran ~750 filas por
    // petición (docs/calidad/10-stress.md, mejora medida).
    const conditions: Prisma.Sql[] = [
      Prisma.sql`"tenantId" IN (${tenantId}, ${SYSTEM_TENANT_ID})`,
    ];
    if (filters.indexType) {
      conditions.push(Prisma.sql`"indexType" = ${filters.indexType}::"IndexType"`);
    }
    if (filters.periodFrom) {
      conditions.push(Prisma.sql`"period" >= ${new Date(filters.periodFrom)}`);
    }
    if (filters.periodTo) {
      conditions.push(Prisma.sql`"period" <= ${new Date(filters.periodTo)}`);
    }
    const where = Prisma.join(conditions, ' AND ');

    const visible = Prisma.sql`
      SELECT DISTINCT ON ("indexType", "period")
        "id", "tenantId", "indexType", "period", "value", "source", "createdAt"
      FROM "index_data"
      WHERE ${where}
      ORDER BY "indexType", "period", ("tenantId" = ${tenantId}) DESC
    `;

    const skip = (filters.page - 1) * filters.limit;

    const [items, countRows] = await Promise.all([
      this.prisma.baseClient.$queryRaw<any[]>(Prisma.sql`
        SELECT * FROM (${visible}) AS visible
        ORDER BY "period" DESC, "indexType"
        LIMIT ${filters.limit} OFFSET ${skip}
      `),
      this.prisma.baseClient.$queryRaw<{ count: bigint | number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS count FROM (${visible}) AS visible
      `),
    ]);

    const total = Number(countRows[0]?.count ?? 0);

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
    const validated: any = parseOrThrow(CreateIndexDataSchema, data, 'Invalid index data');

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
   * `startExclusive` deja afuera la fecha de inicio: lo usan los ajustes
   * posteriores al primero, cuyo mes inicial ya entró en el anterior (DEF-07).
   */
  async getForPeriod(
    indexType: IndexType,
    startDate: Date,
    endDate: Date,
    options: {
      tenantId?: string;
      client?: { indexData: { findMany: (args: any) => Promise<any[]> } };
      startExclusive?: boolean;
    } = {},
  ) {
    const tenantId = options.tenantId ?? this.requireTenantId('findMany');
    const client = options.client ?? this.prisma.baseClient;

    const rows = await client.indexData.findMany({
      where: {
        ...this.visibleTo(tenantId),
        indexType: indexType as any,
        period: {
          ...(options.startExclusive ? { gt: startDate } : { gte: startDate }),
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
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Dos consultas en total (antes eran dos por tipo de índice, diez en
    // total): el último valor por tipo con DISTINCT ON prefiriendo la fila
    // propia, y el historial de 30 días de todos los tipos de una vez
    // (docs/calidad/10-stress.md, segunda mejora medida).
    const [latestRows, historyRows] = await Promise.all([
      this.prisma.baseClient.$queryRaw<any[]>(Prisma.sql`
        SELECT DISTINCT ON ("indexType")
          "id", "tenantId", "indexType", "period", "value", "source", "createdAt"
        FROM "index_data"
        WHERE "tenantId" IN (${tenantId}, ${SYSTEM_TENANT_ID})
        ORDER BY "indexType", "period" DESC, ("tenantId" = ${tenantId}) DESC
      `),
      this.prisma.baseClient.indexData.findMany({
        where: { ...this.visibleTo(tenantId), period: { gte: thirtyDaysAgo } },
        orderBy: { period: 'asc' },
      }),
    ]);

    const history = mergeVisibleRows(historyRows, tenantId);
    const latestByType = new Map<string, any>(latestRows.map((row) => [row.indexType, row]));

    return Object.values(IndexType)
      .filter((indexType) => latestByType.has(indexType))
      .map((indexType) => ({
        indexType,
        latest: latestByType.get(indexType),
        history: history.filter((row) => row.indexType === indexType),
      }));
  }
}
