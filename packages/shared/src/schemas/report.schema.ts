import { z } from 'zod';

// ─── Report Type Enum ───────────────────────────────────

export const ReportType = z.enum([
  'ownerStatement',
  'propertyProfitability',
  'cashFlow',
  'commissionSummary',
  'pipelineAnalytics',
  'morosidad',
]);

// ─── Report Filter Schemas ──────────────────────────────

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');

/** Base filters shared by all report types */
const BaseReportFilterSchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
});

/** Owner Statement — ownerId required */
export const OwnerStatementFilterSchema = BaseReportFilterSchema.extend({
  ownerId: z.string().uuid(),
});

/** Property Profitability — propertyId optional */
export const PropertyProfitabilityFilterSchema = BaseReportFilterSchema.extend({
  propertyId: z.string().uuid().optional(),
});

/** Cash Flow — from/to default to current year (handled in service) */
export const CashFlowFilterSchema = BaseReportFilterSchema;

/** Commission Summary — contractId optional */
export const CommissionSummaryFilterSchema = BaseReportFilterSchema.extend({
  contractId: z.string().uuid().optional(),
});

/** Pipeline Analytics — pipelineId optional, date range optional */
export const PipelineAnalyticsFilterSchema = BaseReportFilterSchema.extend({
  pipelineId: z.string().uuid().optional(),
});

/** Morosidad — overdue liquidaciones, optional property/contract scoping */
export const MorosidadFilterSchema = BaseReportFilterSchema.extend({
  propertyId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
});

/** Unified report filter — discriminated by report type in the controller */
export const ReportFilterSchema = BaseReportFilterSchema.extend({
  type: ReportType,
  ownerId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  pipelineId: z.string().uuid().optional(),
});

// ─── Report Schedule Schemas ────────────────────────────

export const ReportScheduleFrequency = z.enum(['daily', 'weekly', 'monthly']);

export const CreateReportScheduleSchema = z.object({
  reportType: ReportType,
  frequency: ReportScheduleFrequency,
  recipients: z.array(z.string().email()).min(1),
  filters: z.record(z.any()).optional(),
  format: z.enum(['excel', 'pdf']).default('excel'),
});

export const UpdateReportScheduleSchema = z.object({
  reportType: ReportType.optional(),
  frequency: ReportScheduleFrequency.optional(),
  recipients: z.array(z.string().email()).min(1).optional(),
  filters: z.record(z.any()).optional(),
  format: z.enum(['excel', 'pdf']).optional(),
  isActive: z.boolean().optional(),
});
