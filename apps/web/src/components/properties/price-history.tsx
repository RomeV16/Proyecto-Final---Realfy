'use client';

import { useTranslations } from 'next-intl';

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

/* ──────────── Component ──────────── */

export function PriceHistory({ entries }: PriceHistoryProps) {
  const t = useTranslations('properties.priceHistory');

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-2">
          <svg className="w-6 h-6 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
          </svg>
        </div>
        <p className="text-sm text-slate-400">{t('empty')}</p>
      </div>
    );
  }

  // Sort newest first
  const sorted = [...entries].sort(
    (a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()
  );

  // Compute change direction per entry (compared to the next older entry)
  function getDirection(idx: number): 'up' | 'down' | 'same' | null {
    if (idx >= sorted.length - 1) return null; // oldest entry, no comparison
    const current = Number(sorted[idx].price);
    const prev = Number(sorted[idx + 1].price);
    if (current > prev) return 'up';
    if (current < prev) return 'down';
    return 'same';
  }

  function formatPrice(price: string | number, currency: string): string {
    const symbol = currency === 'USD' ? 'US$' : '$';
    return `${symbol} ${Number(price).toLocaleString('es-AR')}`;
  }

  return (
    <div className="space-y-1">
      <div className="relative pl-6">
        {/* Vertical line */}
        <div className="absolute left-[9px] top-3 bottom-3 w-px bg-slate-200" />

        {sorted.map((entry, idx) => {
          const direction = getDirection(idx);
          const date = new Date(entry.changedAt);

          return (
            <div key={entry.id} className="relative flex items-start gap-3 py-3">
              {/* Timeline dot */}
              <div className={`
                absolute left-0 top-4 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center z-10
                ${direction === 'up'
                  ? 'border-emerald-400 bg-emerald-50'
                  : direction === 'down'
                    ? 'border-red-400 bg-red-50'
                    : 'border-slate-300 bg-white'
                }
              `}>
                {direction === 'up' && (
                  <svg className="w-2.5 h-2.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                  </svg>
                )}
                {direction === 'down' && (
                  <svg className="w-2.5 h-2.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 ml-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-sm font-semibold tabular-nums ${
                    direction === 'up' ? 'text-emerald-700' : direction === 'down' ? 'text-red-700' : 'text-slate-900'
                  }`}>
                    {formatPrice(entry.price, entry.currency)}
                  </span>
                  <span className="text-xs text-slate-400 shrink-0">
                    {date.toLocaleDateString('es-AR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                {direction && direction !== 'same' && idx < sorted.length - 1 && (
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {direction === 'up' ? t('increased') : t('decreased')}
                    {' '}
                    {(() => {
                      const prev = Number(sorted[idx + 1].price);
                      const curr = Number(entry.price);
                      const pct = prev > 0 ? Math.abs(((curr - prev) / prev) * 100).toFixed(1) : '—';
                      return `${pct}%`;
                    })()}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
