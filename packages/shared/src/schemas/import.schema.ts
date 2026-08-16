import { z } from 'zod';

// ─── Import Entity Type ─────────────────────────────────

export const ImportEntityType = z.enum(['property', 'person', 'contract', 'liquidacion']);
export type ImportEntityType = z.infer<typeof ImportEntityType>;

// ─── Column Mapping ─────────────────────────────────────

/** Maps a source CSV column name → target entity field name */
export const ColumnMappingSchema = z.object({
  sourceColumn: z.string().min(1),
  targetField: z.string().min(1),
});
export type ColumnMappingInput = z.infer<typeof ColumnMappingSchema>;

// ─── Import Configuration ───────────────────────────────

export const ImportConfigSchema = z.object({
  entityType: ImportEntityType,
  columnMappings: z.array(ColumnMappingSchema).min(1),
  skipHeaderRow: z.boolean().default(true),
});
export type ImportConfigInput = z.infer<typeof ImportConfigSchema>;

// ─── Validate Request ───────────────────────────────────

export const ImportValidateRequestSchema = z.object({
  fileId: z.string().min(1),
  entityType: ImportEntityType,
  columnMappings: z.array(ColumnMappingSchema).min(1),
});
export type ImportValidateRequestInput = z.infer<typeof ImportValidateRequestSchema>;

// ─── Execute Request ────────────────────────────────────

export const ImportExecuteRequestSchema = z.object({
  fileId: z.string().min(1),
  entityType: ImportEntityType,
  columnMappings: z.array(ColumnMappingSchema).min(1),
});
export type ImportExecuteRequestInput = z.infer<typeof ImportExecuteRequestSchema>;

// ─── Import Row Error ───────────────────────────────────

export const ImportRowErrorSchema = z.object({
  row: z.number(),
  field: z.string(),
  message: z.string(),
  value: z.any().optional(),
});
export type ImportRowError = z.infer<typeof ImportRowErrorSchema>;

// ─── Validation Result ──────────────────────────────────

export const ImportValidationResultSchema = z.object({
  totalRows: z.number(),
  validRows: z.number(),
  errorRows: z.number(),
  errors: z.array(ImportRowErrorSchema),
  preview: z.array(z.record(z.any())).max(10),
});
export type ImportValidationResult = z.infer<typeof ImportValidationResultSchema>;

// ─── Execute Result ─────────────────────────────────────

export const ImportExecuteResultSchema = z.object({
  totalRows: z.number(),
  importedRows: z.number(),
  skippedRows: z.number(),
  errors: z.array(ImportRowErrorSchema),
});
export type ImportExecuteResult = z.infer<typeof ImportExecuteResultSchema>;

// ─── Upload Result ──────────────────────────────────────

export const ImportUploadResultSchema = z.object({
  fileId: z.string(),
  fileName: z.string(),
  headers: z.array(z.string()),
  rowCount: z.number(),
  sampleRows: z.array(z.array(z.string())).max(5),
});
export type ImportUploadResult = z.infer<typeof ImportUploadResultSchema>;

// ─── Target fields per entity type (for frontend mapping dropdowns) ──

export const PROPERTY_IMPORT_FIELDS = [
  'title', 'description', 'type', 'street', 'number', 'floor', 'apartment',
  'city', 'province', 'zipCode', 'country', 'latitude', 'longitude',
  'area', 'rooms', 'bedrooms', 'bathrooms', 'garages', 'age',
  'orientation', 'price', 'currency',
] as const;

export const PERSON_IMPORT_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'phone2',
  'cuit', 'fiscalCondition', 'bankName', 'cbu', 'bankAlias', 'notes',
] as const;

export const CONTRACT_IMPORT_FIELDS = [
  'propertyRef', 'contractType', 'startDate', 'endDate',
  'rentAmount', 'rentCurrency', 'adjustmentType', 'adjustmentPeriod',
  'ownerRef', 'tenantRef', 'guarantorRef',
  'status', 'depositAmount', 'notes',
] as const;

export const LIQUIDACION_IMPORT_FIELDS = [
  'contractRef', 'period', 'amount', 'status',
  'dueDate', 'paymentDate', 'paymentMethod', 'paymentAmount',
] as const;
