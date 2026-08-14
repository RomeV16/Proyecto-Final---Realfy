'use client';

import { useTranslations } from 'next-intl';
import { Meter } from '@/components/ui/micro-viz';
import { Skeleton } from '@/components/ui/skeleton';
import { ListTransition } from '@/components/ui/motion';
import { Plate } from './portal-primitives';
import { formatDate, formatMoney, type PortalOverview } from './portal-data';

/**
 * The contract, reduced to the two things a tenant is ever asked about it:
 * how much they pay per month, and how much term is left. The meter turns
 * "hasta 31/01/2028" into something you can read at a glance.
 */
export function ContractCard({
  overview,
  loading,
}: {
  overview: PortalOverview;
  loading: boolean;
}) {
  const t = useTranslations();
  const { contract, monthsElapsed, monthsTotal, termProgress } = overview;

  return (
    <ListTransition
      state={loading ? 'loading' : 'ready'}
      skeleton={<ContractCardSkeleton />}
      empty={null}
    >
      <section className="card-lux p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="micro">{t('portal.contract.monthlyRent')}</p>
            <p className="numeric-xl mt-1.5 !text-2xl sm:!text-3xl">
              {contract ? formatMoney(overview.monthlyRent, overview.currency) : '—'}
            </p>
            <p className="mt-1 truncate text-xs text-[var(--color-muted)]">
              {overview.propertyLabel ?? t('portal.home.unknownProperty')}
            </p>
          </div>
          <Plate icon="contracts" tone="brand" size="md" />
        </div>

        {contract ? (
          <>
            <Meter
              className="mt-5"
              value={termProgress}
              tone="brand"
              label={t('portal.contract.term', { elapsed: monthsElapsed, total: monthsTotal })}
              hint={t('portal.contract.until', { date: formatDate(contract.endDate) })}
            />

            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--color-border)] pt-4">
              <div className="min-w-0">
                <dt className="micro">{t('portal.contract.adjustment')}</dt>
                <dd className="mt-0.5 truncate text-sm text-[var(--color-text)]">
                  {[contract.adjustmentType, contract.adjustmentPeriod].filter(Boolean).join(' · ') ||
                    '—'}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="micro">{t('portal.contract.nextAdjustment')}</dt>
                <dd className="mt-0.5 truncate text-sm text-[var(--color-text)]">
                  {contract.nextAdjustmentDate ? formatDate(contract.nextAdjustmentDate) : '—'}
                </dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="mt-4 text-sm text-[var(--color-muted)]">{t('portal.contract.none')}</p>
        )}
      </section>
    </ListTransition>
  );
}

function ContractCardSkeleton() {
  return (
    <section className="card-lux p-5" aria-hidden="true">
      <div className="flex items-start justify-between gap-4">
        <div className="w-full">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-2.5 h-7 w-40" />
          <Skeleton className="mt-2 h-3 w-32" />
        </div>
        <Skeleton className="h-11 w-11 rounded-[var(--radius-xl)]" />
      </div>
      <Skeleton className="mt-6 h-3 w-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 border-t border-[var(--color-border)] pt-4">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
    </section>
  );
}
