'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { formatMoney, formatMoneyCompact, formatMonthShort, formatPercent, formatPeriod } from '@/lib/format';
import type { InstallmentItem } from '@/lib/fees';
import type { Paginated } from '@/hooks/use-paginated-list';
import { Skeleton } from '@/components/ui/skeleton';
import { summarizeInstallments, summaryMonths, todayKey, type FeeSummaryData } from './fee-summary-data';

const MONTHS = 6;
const CHART_HEIGHT = 120;

const monthDate = (month: string) => `${month}-01T00:00:00.000Z`;

/**
 * Resumen de honorarios de los últimos meses: el total de las cuotas con vencimiento en el período, cuánto se
 * cobró, cuánto falta (y cuánto de eso ya venció) y la evolución mes a mes en barras.
 */
export function FeeSummary() {
  const t = useTranslations('fees');
  const locale = useLocale();
  const months = useMemo(() => summaryMonths(new Date(), MONTHS), []);

  const query = useQuery({
    queryKey: ['fee-installments', 'summary', months],
    queryFn: async () => {
      const pages = await Promise.all(
        months.map((month) => apiClient<Paginated<InstallmentItem>>(`/fees/installments?page=1&limit=200&period=${month}`)),
      );
      return pages.flatMap((page) => page?.items ?? []);
    },
  });

  if (query.isLoading) return <Skeleton className="h-52 w-full rounded-xl" />;
  if (query.error != null || !query.data) {
    return (
      <p role="status" className="rounded-xl border border-dashed border-[var(--color-border)] px-5 py-4 text-sm text-[var(--color-muted)]">
        {t('summary.error')}
      </p>
    );
  }

  const data = summarizeInstallments(query.data, months, todayKey());
  const total = data.collected + data.pending;
  const money = (cents: number) => formatMoney(cents / 100, data.currency, { decimals: 0, locale });
  const monthText = (month: string) => {
    const text = formatPeriod(monthDate(month), undefined, locale);
    return locale === 'es' ? text.toLowerCase() : text;
  };
  const collectedShare = total > 0 ? (data.collected / total) * 100 : 0;

  return (
    <section
      aria-label={t('summary.label')}
      className="grid grid-cols-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]"
    >
      <div className="p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-muted)]">{t('summary.total')}</p>
        <p className="mt-2 break-words font-mono text-[32px] font-medium leading-tight tracking-tight text-[var(--color-text)] tabular-nums">
          {money(total)}
        </p>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{t('summary.totalHint', { count: data.count, from: monthText(months[0]), to: monthText(months[months.length - 1]) })}</p>

        <dl className="mt-5 space-y-3">
          <div>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="text-[var(--color-text)]">{t('summary.collected')}</dt>
              <dd className="font-mono font-medium text-[color-mix(in_oklab,var(--color-success)_70%,var(--color-text))] tabular-nums">
                {money(data.collected)}
                <span className="ml-2 text-xs font-normal text-[var(--color-muted)]">{formatPercent(collectedShare, { decimals: 0, locale })}</span>
              </dd>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]" aria-hidden="true">
              <div className="h-full rounded-full bg-[var(--color-success)]" style={{ width: `${collectedShare}%` }} />
            </div>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-[var(--color-text)]">{t('summary.pending')}</dt>
            <dd className="font-mono font-medium text-[var(--color-text)] tabular-nums">{money(data.pending)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-[var(--color-text)]">{t('summary.overdue')}</dt>
            <dd
              className="font-mono font-medium tabular-nums"
              style={{ color: data.overdue > 0 ? 'color-mix(in oklab, var(--color-danger) 80%, var(--color-text))' : 'var(--color-muted)' }}
            >
              {money(data.overdue)}
            </dd>
          </div>
        </dl>
        {data.otherCurrencies.length > 0 && (
          <p className="mt-4 text-xs text-[var(--color-muted)]">
            {t('summary.otherCurrencies', { currency: data.currency, others: data.otherCurrencies.join(', ') })}
          </p>
        )}
      </div>

      <div className="border-t border-[var(--color-border)] p-5 lg:border-l lg:border-t-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-muted)]">{t('summary.byMonth')}</p>
          <ul className="flex gap-4 text-xs text-[var(--color-muted)]">
            <li className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px] bg-[var(--color-success)]" aria-hidden="true" />
              {t('summary.collected')}
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px] bg-[color-mix(in_oklab,var(--color-brand-500)_45%,var(--color-surface))]" aria-hidden="true" />
              {t('summary.pending')}
            </li>
          </ul>
        </div>
        {total === 0 ? (
          <p className="mt-6 text-sm text-[var(--color-muted)]">{t('summary.empty')}</p>
        ) : (
          <MonthBars data={data} locale={locale} label={(month, collected, pending) => t('summary.barLabel', { month, collected, pending })} money={money} />
        )}
      </div>
    </section>
  );
}

interface BarsProps {
  data: FeeSummaryData;
  locale: string;
  money: (cents: number) => string;
  label: (month: string, collected: string, pending: string) => string;
}

function MonthBars({ data, locale, money, label }: BarsProps) {
  const max = Math.max(...data.buckets.map((b) => b.collected + b.pending), 1);
  return (
    <ol className="mt-4 grid grid-flow-col auto-cols-fr items-end gap-2 sm:gap-4">
      {data.buckets.map((bucket) => {
        const sum = bucket.collected + bucket.pending;
        const height = (value: number) => (value > 0 ? Math.max(3, Math.round((value / max) * CHART_HEIGHT)) : 0);
        const monthName = formatPeriod(monthDate(bucket.month), undefined, locale);
        return (
          <li key={bucket.month} className="flex min-w-0 flex-col items-center" title={label(monthName, money(bucket.collected), money(bucket.pending))}>
            <span className="mb-1 font-mono text-[11px] text-[var(--color-muted)] tabular-nums">
              {sum > 0 ? formatMoneyCompact(Math.round(sum / 100), locale) : '—'}
            </span>
            <div
              className="flex w-full max-w-[52px] flex-col justify-end gap-px"
              style={{ height: CHART_HEIGHT }}
              role="img"
              aria-label={label(monthName, money(bucket.collected), money(bucket.pending))}
            >
              {bucket.pending > 0 && (
                <div
                  className="w-full rounded-t-[3px] bg-[color-mix(in_oklab,var(--color-brand-500)_45%,var(--color-surface))]"
                  style={{ height: height(bucket.pending) }}
                />
              )}
              {bucket.collected > 0 && (
                <div
                  className={bucket.pending > 0 ? 'w-full bg-[var(--color-success)]' : 'w-full rounded-t-[3px] bg-[var(--color-success)]'}
                  style={{ height: height(bucket.collected) }}
                />
              )}
              {sum === 0 && <div className="h-px w-full bg-[var(--color-border)]" />}
            </div>
            <span className="mt-1.5 w-full border-t border-[var(--color-border)] pt-1 text-center text-xs capitalize text-[var(--color-muted)]">
              {formatMonthShort(monthDate(bucket.month), locale)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
