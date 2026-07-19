'use client';

import { useTranslations } from 'next-intl';

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
}

function formatCurrency(amount: string | number | null | undefined): string {
  if (amount == null) return '—';
  return Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}

export function AdjustmentTimeline({ adjustments, schedules }: AdjustmentTimelineProps) {
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
      status: 'Pending' as const,
    }));

  const items = [
    ...adjustments.map((a) => ({ ...a, isPending: false })),
    ...pendingSchedules.map((s) => ({
      id: s.id,
      periodNumber: s.periodNumber,
      scheduledDate: s.scheduledDate,
      previousAmount: null,
      newAmount: null,
      percentageChange: null,
      adjustmentType: '',
      status: s.status,
      isPending: true,
    })),
  ].sort((a, b) => a.periodNumber - b.periodNumber);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
          <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
          </svg>
        </div>
        <p className="text-sm text-slate-500">{t('empty')}</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200" />

      <div className="space-y-4">
        {items.map((item) => {
          const isPending = item.isPending;
          const pctChange = item.percentageChange != null ? Number(item.percentageChange) : null;
          const isIncrease = pctChange != null && pctChange > 0;

          const statusKey = item.status === 'Applied' ? 'applied'
            : item.status === 'Calculated' ? 'calculated'
            : item.status === 'Skipped' ? 'skipped'
            : 'pending';

          return (
            <div key={item.id} className="relative pl-10">
              {/* Dot */}
              <div className={`absolute left-2.5 top-1.5 w-3 h-3 rounded-full border-2 ${
                isPending
                  ? 'bg-white border-slate-300 border-dashed'
                  : item.status === 'Applied'
                    ? 'bg-emerald-500 border-emerald-500'
                    : item.status === 'Calculated'
                      ? 'bg-blue-500 border-blue-500'
                      : 'bg-slate-300 border-slate-300'
              }`} />

              <div className={`bg-white rounded-lg border p-3 ${
                isPending ? 'border-dashed border-slate-300' : 'border-slate-200'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-slate-900">
                    {t('period', { num: item.periodNumber })}
                  </span>
                  <div className="flex items-center gap-2">
                    {item.adjustmentType && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                        {tAdj(item.adjustmentType)}
                      </span>
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      statusKey === 'applied' ? 'bg-emerald-100 text-emerald-700'
                        : statusKey === 'calculated' ? 'bg-blue-100 text-blue-700'
                        : statusKey === 'skipped' ? 'bg-slate-100 text-slate-500'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {t(statusKey)}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-slate-500 mb-2">
                  {formatDate(item.scheduledDate)}
                </div>

                {!isPending && item.previousAmount != null && item.newAmount != null && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500 tabular-nums">
                      $ {formatCurrency(item.previousAmount)}
                    </span>
                    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      $ {formatCurrency(item.newAmount)}
                    </span>
                    {pctChange != null && (
                      <span className={`text-xs font-medium ${isIncrease ? 'text-red-600' : 'text-emerald-600'}`}>
                        {isIncrease ? '↑' : '↓'} {Math.abs(pctChange).toFixed(1)}%
                      </span>
                    )}
                  </div>
                )}

                {isPending && (
                  <p className="text-xs text-slate-400 italic">{t('scheduled')}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
