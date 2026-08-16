import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  PROPERTY_IMPORT_FIELDS,
  PERSON_IMPORT_FIELDS,
  PropertyImportRowSchema,
  PersonImportRowSchema,
} from '@realfy/shared';
import type {
  ColumnMappingInput,
  ImportRowError,
  ImportValidationResult,
  ImportExecuteResult,
} from '@realfy/shared';
import { CsvParserService, ParsedCsv } from './csv-parser.service';

/** In-memory store for uploaded CSV data (keyed by fileId). */
const uploadStore = new Map<string, { fileName: string; parsed: ParsedCsv; uploadedAt: number }>();

// Evict uploads older than 30 minutes
const UPLOAD_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class ImportExportService {
  private readonly logger = new Logger(ImportExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly csvParser: CsvParserService,
  ) {}

  // ─── Upload ─────────────────────────────────────────

  upload(buffer: Buffer, fileName: string) {
    this.evictStaleUploads();

    const parsed = this.csvParser.parse(buffer);

    if (parsed.headers.length === 0) {
      throw new BadRequestException({
        error: 'EMPTY_CSV',
        message: 'The uploaded CSV file is empty or has no headers',
      });
    }

    const fileId = crypto.randomUUID();
    uploadStore.set(fileId, { fileName, parsed, uploadedAt: Date.now() });

    this.logger.log(
      `CSV uploaded: fileId=${fileId} fileName=${fileName} headers=${parsed.headers.length} rows=${parsed.rows.length}`,
    );

    return {
      fileId,
      fileName,
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      sampleRows: parsed.rows.slice(0, 5),
    };
  }

  // ─── Validate ───────────────────────────────────────

  validate(
    fileId: string,
    entityType: 'property' | 'person',
    columnMappings: ColumnMappingInput[],
  ): ImportValidationResult {
    const upload = this.getUpload(fileId);
    this.validateMappings(entityType, columnMappings, upload.parsed.headers);

    const errors: ImportRowError[] = [];
    const preview: Record<string, any>[] = [];
    let validCount = 0;

    const schema = entityType === 'property' ? PropertyImportRowSchema : PersonImportRowSchema;

    for (let i = 0; i < upload.parsed.rows.length; i++) {
      const rawRow = upload.parsed.rows[i];
      const mapped = this.mapRow(rawRow, upload.parsed.headers, columnMappings);
      const cleaned = this.cleanEmptyStrings(mapped);
      const result = schema.safeParse(cleaned);

      if (result.success) {
        validCount++;
        if (preview.length < 10) {
          preview.push(result.data);
        }
      } else {
        for (const issue of result.error.issues) {
          errors.push({
            row: i + 1,
            field: issue.path.join('.'),
            message: issue.message,
            value: mapped[issue.path[0] as string],
          });
        }
        // Still add to preview for error highlighting
        if (preview.length < 10) {
          preview.push(mapped);
        }
      }
    }

    this.logger.log(
      `Import validation: fileId=${fileId} entity=${entityType} total=${upload.parsed.rows.length} valid=${validCount} errors=${errors.length}`,
    );

    return {
      totalRows: upload.parsed.rows.length,
      validRows: validCount,
      errorRows: upload.parsed.rows.length - validCount,
      errors,
      preview,
    };
  }

  // ─── Execute ────────────────────────────────────────

  async execute(
    fileId: string,
    entityType: 'property' | 'person',
    columnMappings: ColumnMappingInput[],
  ): Promise<ImportExecuteResult> {
    const upload = this.getUpload(fileId);
    this.validateMappings(entityType, columnMappings, upload.parsed.headers);

    const tenantId = this.tenantContext.getTenantId()!;

    const errors: ImportRowError[] = [];
    let importedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < upload.parsed.rows.length; i++) {
      const rawRow = upload.parsed.rows[i];
      const mapped = this.mapRow(rawRow, upload.parsed.headers, columnMappings);
      const cleaned = this.cleanEmptyStrings(mapped);

      try {
        if (entityType === 'property') {
          const result = PropertyImportRowSchema.safeParse(cleaned);
          if (!result.success) {
            skippedCount++;
            for (const issue of result.error.issues) {
              errors.push({
                row: i + 1,
                field: issue.path.join('.'),
                message: issue.message,
                value: mapped[issue.path[0] as string],
              });
            }
            continue;
          }
          await this.prisma.client.property.create({
            data: { ...result.data, tenantId } as any,
          });
        } else {
          const result = PersonImportRowSchema.safeParse(cleaned);
          if (!result.success) {
            skippedCount++;
            for (const issue of result.error.issues) {
              errors.push({
                row: i + 1,
                field: issue.path.join('.'),
                message: issue.message,
                value: mapped[issue.path[0] as string],
              });
            }
            continue;
          }
          await this.prisma.client.person.create({
            data: { ...result.data, tenantId } as any,
          });
        }
        importedCount++;
      } catch (err: any) {
        skippedCount++;
        errors.push({
          row: i + 1,
          field: '_db',
          message: err.message ?? 'Database error',
        });
      }
    }

    // Clean up the upload from memory
    uploadStore.delete(fileId);

    this.logger.log(
      `Import executed: fileId=${fileId} entity=${entityType} imported=${importedCount} skipped=${skippedCount}`,
    );

    return {
      totalRows: upload.parsed.rows.length,
      importedRows: importedCount,
      skippedRows: skippedCount,
      errors,
    };
  }

  // ─── Helpers ────────────────────────────────────────

  private getUpload(fileId: string) {
    const upload = uploadStore.get(fileId);
    if (!upload) {
      throw new BadRequestException({
        error: 'FILE_NOT_FOUND',
        message: 'Upload not found or expired. Please upload the file again.',
      });
    }
    return upload;
  }

  private validateMappings(
    entityType: 'property' | 'person',
    mappings: ColumnMappingInput[],
    headers: string[],
  ) {
    const validFields =
      entityType === 'property'
        ? PROPERTY_IMPORT_FIELDS
        : PERSON_IMPORT_FIELDS;

    const normalizedHeaders = headers.map((h) => this.normalizeHeaderForMatch(h));

    for (const m of mappings) {
      if (!normalizedHeaders.includes(this.normalizeHeaderForMatch(m.sourceColumn))) {
        throw new BadRequestException({
          error: 'INVALID_MAPPING',
          message: `Source column "${m.sourceColumn}" not found in CSV headers`,
        });
      }
      if (!(validFields as readonly string[]).includes(m.targetField)) {
        throw new BadRequestException({
          error: 'INVALID_MAPPING',
          message: `Target field "${m.targetField}" is not valid for ${entityType} import`,
        });
      }
    }
  }

  /**
   * Normalize header text for comparison: case-insensitive, accent-insensitive,
   * whitespace-collapsed. Keeps column mapping working when the source column
   * name differs from the uploaded header only in case, accents or spacing
   * (e.g. a re-uploaded file with "Título" vs "titulo").
   */
  private normalizeHeaderForMatch(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  /**
   * Map a raw CSV row array to an object using column mappings.
   */
  private mapRow(
    row: string[],
    headers: string[],
    mappings: ColumnMappingInput[],
  ): Record<string, string> {
    const normalizedHeaders = headers.map((h) => this.normalizeHeaderForMatch(h));
    const result: Record<string, string> = {};
    for (const m of mappings) {
      const idx = normalizedHeaders.indexOf(this.normalizeHeaderForMatch(m.sourceColumn));
      if (idx >= 0 && idx < row.length) {
        result[m.targetField] = row[idx].trim();
      }
    }
    return result;
  }

  /**
   * Convert empty strings to undefined so Zod optional fields work properly.
   */
  private cleanEmptyStrings(obj: Record<string, string>): Record<string, any> {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      cleaned[key] = value === '' ? undefined : value;
    }
    return cleaned;
  }

  private evictStaleUploads() {
    const now = Date.now();
    for (const [id, entry] of uploadStore) {
      if (now - entry.uploadedAt > UPLOAD_TTL_MS) {
        uploadStore.delete(id);
      }
    }
  }
}
