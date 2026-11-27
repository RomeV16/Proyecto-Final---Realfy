'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { MoneyText } from '@/components/ui/money-text';
import { AGING_COLOR, agingKeyOf, type DelinquentTenant } from './aging';

/**
 * Ranking de deudores, del más atrasado al menos. La posición y el color de los días dicen la gravedad; la
 * barra compara cada deuda con la más grande de la lista.
 */
export function DebtorRanking({ items }: { items: DelinquentTenant[] }) {
  const t = useTranslations('delinquency');
  const largest = items.reduce((max, i) => Math.max(max, Number(i.totalDebt) || 0), 0);

  return (
    <section aria-label={t('ranking.title')} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--color-text)]">{t('ranking.title')}</h2>
        <p className="text-xs text-[var(--color-muted)]">{t('ranking.order')}</p>
      </div>
      <ol className="divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {items.map((item, index) => {
          const color = AGING_COLOR[agingKeyOf(item.daysOverdueMax)];
          const debt = Number(item.totalDebt) || 0;
          const known = !item.personId.startsWith('unknown-');
          return (
            <li
              key={`${item.personId}-${item.propertyId ?? 'sin-propiedad'}`}
              className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-4 py-3.5 sm:grid-cols-[1.75rem_5.5rem_minmax(0,1fr)_minmax(0,1.1fr)] sm:gap-x-5 sm:px-5"
            >
              <span className="font-mono text-sm tabular-nums text-[var(--color-muted)]">
                <span className="sr-only">{t('ranking.position')} </span>
                {String(index + 1).padStart(2, '0')}
              </span>

              <div className="order-3 text-right sm:order-none sm:text-left">
                <p className="text-xl font-semibold leading-none tabular-nums" style={{ color }}>
                  {item.daysOverdueMax}
                </p>
                <p className="mt-1 text-[11px] leading-tight text-[var(--color-muted)]">
                  {t('ranking.daysLabel', { days: item.daysOverdueMax })}
                </p>
              </div>

              <div className="min-w-0">
                {known ? (
                  <Link
                    href={`/persons/${item.personId}`}
                    className="block truncate font-medium text-[var(--color-text)] hover:underline"
                  >
                    {item.fullName}
                  </Link>
                ) : (
                  <p className="truncate font-medium text-[var(--color-text)]">{item.fullName}</p>
                )}
                <p className="truncate text-sm text-[var(--color-muted)]">{item.propertyLabel ?? t('ranking.noProperty')}</p>
              </div>

              <div className="order-4 col-span-3 sm:order-none sm:col-span-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-[var(--color-muted)]">
                    {t('colPenalty')} <MoneyText value={item.totalPenalty} decimals={2} className="tabular-nums" />
                  </span>
                  <MoneyText value={item.totalDebt} decimals={2} className="font-semibold tabular-nums text-[var(--color-text)]" />
                </div>
                <div aria-hidden className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${largest > 0 ? Math.max(2, (debt / largest) * 100) : 0}%`, background: color }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
