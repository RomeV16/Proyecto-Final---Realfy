'use client';

import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/icon';
import { Sparkline, TrendDelta } from '@/components/ui/micro-viz';

/* ──────────── Types ──────────── */

interface PriceHistoryEntry {
  id: string;
  price: string | number;
  currency: string;
  changedAt: string;
  changedByUserId?: string;
}

interface PriceHistoryProps {
  entries: PriceHistoryEntry[];
}

/* ──────────── Helpers ──────────── */

function formatPrice(price: string | number, currency: string): string {
  const symbol = currency === 'USD' ? 'US$' : '$';
  return `${symbol} ${Number(price).toLocaleString('es-AR')}`;
}

/** Percent change from `prev` to `curr`, rounded to one decimal. */
function pctChange(curr: number, prev: number): number {
  if (!prev) return 0;
  return Number((((curr - prev) / prev) * 100).toFixed(1));
}

/* ──────────── Component ──────────── */

export function PriceHistory({ entries }: PriceHistoryProps) {
  const t = useTranslations('properties.priceHistory');

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-2xl)] bg-[var(--color-bg)]">
          <Icon name="trendingUp" className="h-6 w-6 text-[var(--color-muted)]" strokeWidth={1.5} />
        </div>
        <p className="text-sm text-[var(--color-muted)]">{t('empty')}</p>
      </div>
    );
  }

  // Oldest → newest: what the sparkline and delta math need.
  const chronological = [...entries].sort(
    (a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime(),
  );
  const sparkData = chronological.map((e) => Number(e.price));
  const latest = chronological[chronological.length - 1];
  const first = chronological[0];
  const overallPct = chronological.length > 1 ? pctChange(Number(latest.price), Number(first.price)) : null;

  // Newest → oldest: how the timeline reads top to bottom.
  const timeline = [...chronological].reverse();

  return (
    <div className="space-y-4">
      {/* Trend header — this is a real series, so the sparkline earns its place. */}
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-[var(--color-bg)] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold tabular-nums text-[var(--color-text)]">
            {formatPrice(latest.price, latest.currency)}
          </p>
          {overallPct != null && overallPct !== 0 && (
            <div className="mt-0.5 flex items-center gap-1.5">
              <TrendDelta value={overallPct} />
              <span className="text-[11px] text-[var(--color-muted)]">{t('vsFirstPrice')}</span>
            </div>
          )}
        </div>
        {sparkData.length > 1 && <Sparkline data={sparkData} width={96} height={32} tone="brand" />}
      </div>

      {/* Vertical spine */}
      <div className="relative">
        <div className="absolute left-[13px] top-2 bottom-2 w-px bg-[var(--color-border)]" aria-hidden="true" />
        <div className="space-y-3">
          {timeline.map((entry, idx) => {
            const older = timeline[idx + 1];
            const pct = older ? pctChange(Number(entry.price), Number(older.price)) : null;
            const date = new Date(entry.changedAt);
            const dotColor =
              pct == null || pct === 0
                ? 'var(--color-border)'
                : pct > 0
                  ? 'var(--color-success)'
                  : 'var(--color-danger)';

            return (
              <div key={entry.id} className="relative flex items-start gap-3 pl-7">
                <span
                  className="absolute left-0 top-1 h-[18px] w-[18px] rounded-full border-2 bg-[var(--color-surface)]"
                  style={{ borderColor: dotColor }}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1 pb-0.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold tabular-nums text-[var(--color-text)]">
                      {formatPrice(entry.price, entry.currency)}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--color-muted)]">
                      {date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  {pct != null && pct !== 0 && (
                    <div className="mt-0.5">
                      <TrendDelta value={pct} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
