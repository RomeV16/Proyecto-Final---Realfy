import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ImportBatchRequestSchema,
  ImportBatchRowsQuerySchema,
  ImportBatchStatus,
  ImportEntity,
  ImportRowAction,
} from '@realfy/shared';
import type { ImportBatchCounts, ImportRowErrorDetail } from '@realfy/shared';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TenantContextService } from '../../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../../common/validation/zod';
import { OperationalDefaultsService } from '../../tenants/operational-defaults.service';
import { contractImporter } from './contract.importer';
import { personImporter } from './person.importer';
import { propertyImporter } from './property.importer';
import { buildCsv, type TabularColumn } from '../../../common/export/tabular';
import { Db, EntityImporter, ImportContext, ImportRowError } from './import-types';

/** Registro de importadores por entidad: esquema de la fila y upsert por referencia externa. */
export const ENTITY_IMPORTERS: readonly EntityImporter[] = [personImporter, propertyImporter, contractImporter];

interface WorkItem {
  importer: EntityImporter;
  rowNumber: number;
  raw: unknown;
  externalRef: string | null;
}

export interface RowResult {
  entity: ImportEntity;
  externalRef: string | null;
  rowNumber: number;
  action: ImportRowAction;
  entityId: string | null;
  errors: ImportRowErrorDetail[] | null;
}

const ROWS_CSV_COLUMNS: TabularColumn[] = [
  { header: 'Entidad', key: 'entity' },
  { header: 'Fila', key: 'rowNumber' },
  { header: 'Referencia externa', key: 'externalRef' },
  { header: 'Acción', key: 'action' },
  { header: 'Código', key: 'code' },
  { header: 'Campo', key: 'field' },
  { header: 'Mensaje', key: 'message' },
];

/** Evita que una planilla interprete como fórmula un texto que viene del sistema anterior. */
const safeCell = (v: string | null | undefined): string => (v && /^[=+\-@]/.test(v) ? `'${v}` : (v ?? ''));

/** Una línea por error (o una por fila sin errores): lo que se baja para corregir el origen. */
export function rowsToCsv(
  rows: Array<{ entity: string; rowNumber: number; externalRef: string | null; action: string; errors: unknown }>,
): string {
  const lines = rows.flatMap((r) => {
    const base = { entity: r.entity, rowNumber: r.rowNumber, externalRef: safeCell(r.externalRef), action: r.action };
    const errors = Array.isArray(r.errors) ? (r.errors as ImportRowErrorDetail[]) : [];
    if (errors.length === 0) return [{ ...base, code: '', field: '', message: '' }];
    return errors.map((e) => ({ ...base, code: e.code, field: e.field ?? '', message: safeCell(e.message) }));
  });
  return buildCsv(lines, ROWS_CSV_COLUMNS);
}

/** Corta la transacción única (ensayo o todo-o-nada) sin que sea un fallo del lote. */
class RollbackBatch extends Error {}

const TX_OPTIONS = { timeout: 10 * 60 * 1000, maxWait: 30 * 1000 };

/** Pasa un error cualquiera a los detalles que se guardan en el registro de la fila. */
export function toRowErrors(err: unknown): ImportRowErrorDetail[] {
  if (err instanceof ImportRowError) return err.details;
  const e = err as { code?: string; message?: string; meta?: { target?: unknown } };
  if (e?.code === 'P2002') {
    const target = Array.isArray(e.meta?.target) ? e.meta!.target.join(', ') : String(e.meta?.target ?? '');
    return [{ code: 'DUPLICATE_KEY', message: `Another record already uses a unique value (${target})` }];
  }
  return [{ code: 'INTERNAL_ERROR', message: e?.message ?? 'Unexpected error' }];
}

/** Ordena el trabajo: personas, propiedades (los edificios antes que sus unidades) y contratos. */
export function buildWorkItems(body: {
  persons: unknown[];
  properties: unknown[];
  contracts: unknown[];
}): WorkItem[] {
  const refOf = (raw: unknown): string | null => {
    const v = (raw as { externalRef?: unknown } | null)?.externalRef;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const items = (importer: EntityImporter, rows: unknown[]): WorkItem[] =>
    rows.map((raw, i) => ({ importer, rowNumber: i + 1, raw, externalRef: refOf(raw) }));

  const hasParent = (w: WorkItem) => !!(w.raw as { parentExternalRef?: unknown } | null)?.parentExternalRef;
  const properties = items(propertyImporter, body.properties);
  return [
    ...items(personImporter, body.persons),
    ...properties.filter((w) => !hasParent(w)),
    ...properties.filter(hasParent),
    ...items(contractImporter, body.contracts),
  ];
}

export function countResults(results: RowResult[]): ImportBatchCounts {
  const byEntity: Record<string, Record<string, number>> = {};
  for (const r of results) {
    const e = (byEntity[r.entity] ??= { Creado: 0, Actualizado: 0, SinCambios: 0, Error: 0 });
    e[r.action]++;
  }
  return {
    total: results.length,
    errors: results.filter((r) => r.action === ImportRowAction.Error).length,
    byEntity,
  };
}

@Injectable()
export class ImportBatchService {
  private readonly logger = new Logger(ImportBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly operationalDefaults: OperationalDefaultsService,
  ) {}

  private tenantId(): string {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) throw new ForbiddenException({ error: 'TENANT_REQUIRED', message: 'No tenant in context' });
    return tenantId;
  }

  /** Valida y ejecuta (o ensaya) un lote; devuelve el lote con el registro de cada fila. */
  async run(body: unknown) {
    const request = parseOrThrow(ImportBatchRequestSchema, body, 'Invalid import batch');
    const tenantId = this.tenantId();
    const ctx: ImportContext = { tenantId, defaults: await this.operationalDefaults.get(tenantId) };

    const batch = await this.prisma.client.importBatch.create({
      data: {
        tenantId,
        kind: request.kind,
        status: request.dryRun ? ImportBatchStatus.Validando : ImportBatchStatus.Ejecutando,
        dryRun: request.dryRun,
        atomic: request.atomic,
        createdById: this.tenantContext.getUserId() ?? null,
      },
    });

    const items = buildWorkItems(request);
    try {
      const results =
        request.dryRun || request.atomic
          ? await this.runInOneTransaction(ctx, items, request.dryRun)
          : await this.runPerRow(ctx, items);
      const counts = countResults(results);
      const status = request.dryRun
        ? ImportBatchStatus.Validado
        : request.atomic && counts.errors > 0
          ? ImportBatchStatus.Fallido
          : ImportBatchStatus.Completado;

      await this.persistRows(tenantId, batch.id, results);
      const finished = await this.prisma.client.importBatch.update({
        where: { id: batch.id },
        data: { status, counts: counts as any, finishedAt: new Date() },
      });
      this.logger.log(
        `Import batch ${batch.id}: dryRun=${request.dryRun} atomic=${request.atomic} status=${status} rows=${counts.total} errors=${counts.errors}`,
      );
      return { ...finished, rows: results };
    } catch (err) {
      await this.prisma.client.importBatch.update({
        where: { id: batch.id },
        data: { status: ImportBatchStatus.Fallido, finishedAt: new Date() },
      });
      throw err;
    }
  }

  /** Aplica una fila: valida con el esquema de su entidad y hace el upsert. Lanza ImportRowError. */
  private async applyRow(db: Db, ctx: ImportContext, item: WorkItem, seen: Set<string>): Promise<RowResult> {
    const base = { entity: item.importer.entity, externalRef: item.externalRef, rowNumber: item.rowNumber };
    const parsed = item.importer.schema.safeParse(item.raw);
    if (!parsed.success) {
      throw ImportRowError.fromDetails(
        parsed.error.issues.map((i) => ({
          code: 'VALIDATION_ERROR' as const,
          message: i.message,
          ...(i.path.length ? { field: i.path.join('.') } : {}),
        })),
      );
    }
    const key = `${item.importer.entity}:${parsed.data.externalRef}`;
    if (seen.has(key)) {
      throw new ImportRowError('DUPLICATE_IN_BATCH', `externalRef "${parsed.data.externalRef}" appears more than once in the batch`, 'externalRef');
    }
    const outcome = await item.importer.upsert(db, ctx, parsed.data);
    seen.add(key);
    return { ...base, action: outcome.action as ImportRowAction, entityId: outcome.entityId, errors: null };
  }

  private failed(item: WorkItem, err: unknown): RowResult {
    return {
      entity: item.importer.entity,
      externalRef: item.externalRef,
      rowNumber: item.rowNumber,
      action: ImportRowAction.Error,
      entityId: null,
      errors: toRowErrors(err),
    };
  }

  /** Una transacción por fila: un error sólo deshace esa fila. */
  private async runPerRow(ctx: ImportContext, items: WorkItem[]): Promise<RowResult[]> {
    const seen = new Set<string>();
    const results: RowResult[] = [];
    for (const item of items) {
      try {
        results.push(await this.prisma.client.$transaction((tx: Db) => this.applyRow(tx, ctx, item, seen), TX_OPTIONS));
      } catch (err) {
        results.push(this.failed(item, err));
      }
    }
    return results;
  }

  /**
   * Todo en una transacción, con un punto de guarda por fila para seguir tras un
   * error. Se deshace entera en el ensayo y cuando, siendo todo-o-nada, alguna fila falla.
   */
  private async runInOneTransaction(ctx: ImportContext, items: WorkItem[], dryRun: boolean): Promise<RowResult[]> {
    const results: RowResult[] = [];
    try {
      await this.prisma.client.$transaction(async (tx: Db) => {
        const seen = new Set<string>();
        for (const item of items) {
          await tx.$executeRawUnsafe('SAVEPOINT import_row');
          try {
            results.push(await this.applyRow(tx, ctx, item, seen));
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT import_row');
          } catch (err) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT import_row');
            results.push(this.failed(item, err));
          }
        }
        if (dryRun || results.some((r) => r.action === ImportRowAction.Error)) throw new RollbackBatch();
      }, TX_OPTIONS);
    } catch (err) {
      if (!(err instanceof RollbackBatch)) throw err;
    }
    return results;
  }

  private async persistRows(tenantId: string, batchId: string, results: RowResult[]) {
    const CHUNK = 500;
    for (let i = 0; i < results.length; i += CHUNK) {
      await this.prisma.client.importRowLog.createMany({
        data: results.slice(i, i + CHUNK).map((r) => ({
          tenantId,
          batchId,
          entity: r.entity,
          externalRef: r.externalRef,
          rowNumber: r.rowNumber,
          action: r.action,
          entityId: r.entityId,
          errors: (r.errors ?? undefined) as any,
        })),
      });
    }
  }

  // ─── Consulta ───────────────────────────────────────

  async list(limit = 50) {
    return this.prisma.client.importBatch.findMany({
      where: { tenantId: this.tenantId() },
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async findOne(id: string) {
    const batch = await this.prisma.client.importBatch.findFirst({ where: { id, tenantId: this.tenantId() } });
    if (!batch) throw new NotFoundException({ error: 'IMPORT_BATCH_NOT_FOUND', message: 'Import batch not found' });
    return batch;
  }

  async rows(id: string, query: unknown, page: { limit?: number; offset?: number } = {}) {
    await this.findOne(id);
    const filters = parseOrThrow(ImportBatchRowsQuerySchema, query, 'Invalid rows filter');
    const where = { batchId: id, tenantId: this.tenantId(), ...filters };
    const [data, total] = await Promise.all([
      this.prisma.client.importRowLog.findMany({
        where,
        orderBy: [{ entity: 'asc' }, { rowNumber: 'asc' }],
        take: Math.min(Math.max(page.limit ?? 500, 1), 5000),
        skip: Math.max(page.offset ?? 0, 0),
      }),
      this.prisma.client.importRowLog.count({ where }),
    ]);
    return { data, total };
  }

  /** Las filas del lote (filtradas) como CSV para descargar. */
  async rowsCsv(id: string, query: unknown): Promise<{ buffer: Buffer; fileName: string }> {
    await this.findOne(id);
    const filters = parseOrThrow(ImportBatchRowsQuerySchema, query, 'Invalid rows filter');
    const rows = await this.prisma.client.importRowLog.findMany({
      where: { batchId: id, tenantId: this.tenantId(), ...filters },
      orderBy: [{ entity: 'asc' }, { rowNumber: 'asc' }],
    });
    const suffix = filters.action ? `-${filters.action.toLowerCase()}` : '';
    return {
      buffer: Buffer.from(rowsToCsv(rows), 'utf-8'),
      fileName: `importacion-${id.slice(0, 8)}${suffix}.csv`,
    };
  }
}
