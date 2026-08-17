import { z } from 'zod';

// ─── Dashboard Widget Query Schemas ─────────────────────

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format');

/** Occupancy trend — how many months back the series covers. */
export const OccupancyTrendQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12),
});

/** Shared date range for the profitability and cash-flow widgets. */
export const DashboardRangeQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
});

/** Cash flow — same range plus the bucket size of the series. */
export const DashboardCashFlowQuerySchema = DashboardRangeQuerySchema.extend({
  granularity: z.enum(['month', 'week']).default('month'),
});
