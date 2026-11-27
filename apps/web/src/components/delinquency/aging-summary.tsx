'use client';

import { useTranslations } from 'next-intl';
import { MoneyText } from '@/components/ui/money-text';
import { AGING_COLOR, type AgingSummary as Summary } from './aging';

/**
 * Cabecera de morosidad: la deuda vencida total y cómo se reparte según la antigüedad del atraso. La barra
 * muestra el peso de cada tramo; debajo, cada tramo con su importe y cuántos inquilinos tiene.
 */
export function AgingSummary({ summary, debtors }: { summary: Summary; debtors: number }) {
  const t = useTranslations('delinquency');
  const filled = summary.buckets.filter((b) => b.amount > 0);

  return (
    <section
      aria-label={t('aging.title')}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">{t('totalDebt')}</p>
          <MoneyText value={summary.total} decimals={2} className="numeric-xl block" />
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {t('tenantCount', { count: debtors })}
            {summary.oldestDays > 0 && <> · {t('aging.oldest', { days: summary.oldestDays })}</>}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">{t('accruedPenalty')}</p>
          <MoneyText
            value={summary.penalty}
            decimals={2}
            className="block text-xl font-semibold tabular-nums text-[var(--color-text)]"
          />
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t('aging.penaltyHint')}</p>
        </div>
      </div>

      <div
        role="img"
        aria-label={t('aging.barLabel')}
        className="mt-6 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
      >
        {filled.map((b) => (
          <span key={b.key} style={{ width: `${b.share}%`, background: AGING_COLOR[b.key] }} className="h-full min-w-1.5" />
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
        {summary.buckets.map((b) => (
          <div key={b.key} className={b.amount > 0 ? undefined : 'opacity-55'}>
            <dt className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: AGING_COLOR[b.key] }} />
              {t(`aging.buckets.${b.key}`)}
            </dt>
            <dd className="mt-1 pl-[18px]">
              <MoneyText value={b.amount} decimals={2} className="block font-semibold tabular-nums text-[var(--color-text)]" />
              <span className="mt-0.5 block text-xs leading-snug text-[var(--color-muted)]">
                {t('aging.bucketCount', { count: b.count })}
                {b.amount > 0 && <> · {t('aging.share', { pct: Math.round(b.share) })}</>}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-[var(--color-muted)]">{t('aging.note')}</p>
    </section>
  );
}
