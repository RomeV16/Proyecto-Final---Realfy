/**
 * Pure helper functions for dashboard aggregation logic.
 * Extracted for unit testing — no Prisma or service dependencies.
 */

/**
 * Build the array of end-of-month UTC DateTimes for the last N months.
 * The first entry is N-1 months ago; the last entry is the current month.
 *
 * @param rangeMonths - How many months to include (inclusive of current month)
 * @param now - Reference date (defaults to today)
 */
export function buildMonthRange(
  rangeMonths: number,
  now: Date = new Date(),
): Array<{ label: string; eom: Date }> {
  const result: Array<{ label: string; eom: Date }> = [];

  for (let i = rangeMonths - 1; i >= 0; i--) {
    // First day of the target month (UTC)
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() - i; // may be negative — Date normalises it

    // Last millisecond of the target month in UTC
    const eom = new Date(Date.UTC(year, month + 1, 1) - 1);

    const labelYear = eom.getUTCFullYear();
    const labelMonth = String(eom.getUTCMonth() + 1).padStart(2, '0');
    result.push({ label: `${labelYear}-${labelMonth}`, eom });
  }

  return result;
}

/**
 * Compute occupancy percentage from raw counts.
 * Returns 0 when denominator is 0 to avoid NaN.
 */
export function computeOccupancyPct(occupied: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((occupied / total) * 10000) / 100; // two decimal places
}

// ─── Date range helpers ─────────────────────────────────────────────────────

export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * Return the ISO week label for a date: "YYYY-Www"
 * e.g. 2025-01-06 → "2025-W02"
 */
export function isoWeekLabel(date: Date): string {
  // ISO week: Monday-based. Algorithm from ISO 8601.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay() || 7; // 1=Mon … 7=Sun
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek); // shift to nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Build bucket labels for a date range at the given granularity.
 * Each bucket is identified by its label string.
 * For 'month': labels are 'YYYY-MM'.
 * For 'week':  labels are 'YYYY-Www' (ISO weeks that overlap with the range).
 */
export function buildBuckets(
  range: DateRange,
  granularity: 'month' | 'week',
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const cursor = new Date(range.from.getTime());

  while (cursor <= range.to) {
    const label =
      granularity === 'month'
        ? `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`
        : isoWeekLabel(cursor);

    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
    // Advance by 1 day to cover all dates in range
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return labels;
}

/**
 * Given a date and a granularity, return the bucket label it belongs to.
 */
export function dateToBucket(date: Date, granularity: 'month' | 'week'): string {
  if (granularity === 'month') {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return isoWeekLabel(date);
}

/**
 * Aggregate an array of { date, amount } records into buckets.
 * Returns a Map from bucket-label → total amount.
 */
export function aggregateIntoBuckets(
  records: Array<{ date: Date; amount: number }>,
  granularity: 'month' | 'week',
): Map<string, number> {
  const result = new Map<string, number>();
  for (const r of records) {
    const label = dateToBucket(r.date, granularity);
    result.set(label, (result.get(label) ?? 0) + r.amount);
  }
  return result;
}
