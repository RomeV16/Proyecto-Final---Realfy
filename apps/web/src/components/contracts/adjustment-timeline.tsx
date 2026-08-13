'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Sparkline, TrendDelta } from '@/components/ui/micro-viz';

/* ──────────── Types ──────────── */

interface AdjustmentEntry {
  id: string;
  periodNumber: number;
  scheduledDate: string;
  previousAmount?: string | number | null;
  newAmount?: string | number | null;
  percentageChange?: string | number | null;
  adjustmentType: string;
  status: string;
}

interface AdjustmentTimelineProps {
  adjustments: AdjustmentEntry[];
  schedules?: { id: string; periodNumber: number; scheduledDate: string; status: string }[];
  /** Contract currency — defaults to peso formatting when omitted. */
  currency?: string;
}

/* ──────────── Helpers ──────────── */

function formatCurrency(amount: string | number | null | undefined, currency?: string): string {
  if (amount == null) return '—';
  const prefix = currency === 'USD' ? 'US$ ' : '$ ';
  return prefix + Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}

/** Badge variant + spine dot colour share the same status→tone map. */
const STATUS_TONE: Record<string, 'success' | 'info' | 'neutral' | 'warning'> = {
  Applied: 'success',
  Calculated: 'info',
  Skipped: 'neutral',
};

const TONE_VAR: Record<'success' | 'info' | 'neutral' | 'warning', string> = {
  success: 'var(--color-success)',
  info: 'var(--color-info)',
  warning: 'var(--color-warning)',
  neutral: 'var(--color-muted)',
};

/* ──────────── Component ──────────── */

export function AdjustmentTimeline({ adjustments, schedules, currency }: AdjustmentTimelineProps) {
  const t = useTranslations('contracts.timeline');
  const tAdj = useTranslations('contracts.adjustmentTypes');

  // Merge adjustments + pending schedules into a unified timeline
  const appliedPeriods = new Set(adjustments.map((a) => a.periodNumber));
  const pendingSchedules = (schedules || [])
    .filter((s) => s.status === 'Pending' && !appliedPeriods.has(s.periodNumber))
    .map((s) => ({
      id: s.id,
      periodNumber: s.periodNumber,
      scheduledDate: s.scheduledDate,
      previousAmount: null as number | null,
      newAmount: null as number | null,
      percentageChange: null as number | null,
      adjustmentType: '',
      status: 'Pending',
      isPending: true,
    }));

  const items = [
    ...adjustments.map((a) => ({ ...a, isPending: false })),
    ...pendingSchedules,
  ].sort((a, b) => a.periodNumber - b.periodNumber);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-2xl)] bg-[var(--color-bg)]">
          <Icon name="calendarClock" className="h-6 w-6 text-[var(--color-muted)]" strokeWidth={1.5} />
        </div>
        <p className="text-sm text-[var(--color-muted)]">{t('empty')}</p>
      </div>
    );
  }

  // Real series — rent after each applied adjustment, chronologically.
  const appliedChrono = items
    .filter((i) => !i.isPending && i.newAmount != null)
    .sort((a, b) => a.periodNumber - b.periodNumber);
  const sparkData = appliedChrono.map((i) => Number(i.newAmount));
  const lastApplied = appliedChrono[appliedChrono.length - 1];
  const lastPct = lastApplied?.percentageChange != null ? Number(lastApplied.percentageChange) : null;

  const timeline = [...items].reverse();

  return (
    <div className="space-y-4">
      {sparkData.length > 1 && lastApplied && (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-[var(--color-bg)] px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold tabular-nums text-[var(--color-text)]">
              {formatCurrency(lastApplied.newAmount, currency)}
            </p>
            {lastPct != null && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <TrendDelta value={lastPct} invert />
                <span className="text-[11px] text-[var(--color-muted)]">{t('vsLastAdjustment')}</span>
              </div>
            )}
          </div>
          <Sparkline data={sparkData} width={96} height={32} tone="brand" />
        </div>
      )}

      {/* Vertical spine */}
      <div className="relative">
        <div className="absolute left-[13px] top-2 bottom-2 w-px bg-[var(--color-border)]" aria-hidden="true" />
        <div className="space-y-3">
          {timeline.map((item) => {
            const pct = item.percentageChange != null ? Number(item.percentageChange) : null;
            const tone = item.isPending ? 'warning' : (STATUS_TONE[item.status] ?? 'neutral');

            const statusKey =
              item.status === 'Applied' ? 'applied'
                : item.status === 'Calculated' ? 'calculated'
                  : item.status === 'Skipped' ? 'skipped'
                    : 'pending';

            return (
              <div key={item.id} className="relative flex items-start gap-3 pl-7">
                <span
                  className={cn(
                    'absolute left-0 top-1 h-[18px] w-[18px] rounded-full border-2',
                    item.isPending ? 'border-dashed bg-[var(--color-surface)]' : 'bg-[var(--color-surface)]',
                  )}
                  style={{ borderColor: TONE_VAR[tone] }}
                  aria-hidden="true"
                />
                <div
                  className={cn(
                    'min-w-0 flex-1 rounded-[var(--radius-lg)] border p-3',
                    item.isPending
                      ? 'border-dashed border-[var(--color-border)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)]',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      {t('period', { num: item.periodNumber })}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {item.adjustmentType && <Badge variant="neutral">{tAdj(item.adjustmentType)}</Badge>}
                      <Badge variant={tone} dot={!item.isPending}>
                        {t(statusKey)}
                      </Badge>
                    </div>
                  </div>

                  <p className="mb-2 text-xs text-[var(--color-muted)]">{formatDate(item.scheduledDate)}</p>

                  {!item.isPending && item.previousAmount != null && item.newAmount != null && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="tabular-nums text-[var(--color-muted)]">
                        {formatCurrency(item.previousAmount, currency)}
                      </span>
                      <Icon name="arrowRight" className="h-3.5 w-3.5 text-[var(--color-muted)]" strokeWidth={2} />
                      <span className="font-semibold tabular-nums text-[var(--color-text)]">
                        {formatCurrency(item.newAmount, currency)}
                      </span>
                      {pct != null && <TrendDelta value={pct} invert />}
                    </div>
                  )}

                  {item.isPending && <p className="text-xs italic text-[var(--color-muted)]">{t('scheduled')}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
