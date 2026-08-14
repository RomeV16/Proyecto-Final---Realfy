'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ListTransition } from '@/components/ui/motion';
import { Icon, type IconName } from '@/components/ui/icon';
import { Plate, TONE_COLOR, type PortalTone } from './portal-primitives';
import {
  formatDate,
  formatMoney,
  formatPeriod,
  type PortalOverview,
  usePortalPaths,
} from './portal-data';

/**
 * The one answer the tenant opens the portal for: am I up to date, and if not,
 * how much and since when.
 *
 * Three states, never ambiguous — money owed and late (danger), money due but
 * still in time (warning), nothing pending (success). Each carries exactly one
 * action, which is always "look at the invoice that needs paying".
 */

const TONE_BY_STATE: Record<PortalOverview['state'], PortalTone> = {
  overdue: 'danger',
  pending: 'warning',
  clear: 'success',
};

const ICON_BY_STATE: Record<PortalOverview['state'], IconName> = {
  overdue: 'alert',
  pending: 'calendarClock',
  clear: 'check',
};

export function AccountStatus({
  overview,
  loading,
}: {
  overview: PortalOverview;
  loading: boolean;
}) {
  const t = useTranslations();
  const paths = usePortalPaths();

  const { state, balance, currency, focusInvoice, daysToDue } = overview;
  // Nothing billed yet is not the same as being up to date.
  const blank = state === 'clear' && overview.billedCount === 0;
  const tone = blank ? 'neutral' : TONE_BY_STATE[state];
  const color = TONE_COLOR[tone];

  const headline = blank
    ? t('portal.account.emptyTitle')
    : state === 'clear'
      ? t('portal.account.clearTitle')
      : formatMoney(balance, currency);

  const detail = blank
    ? t('portal.account.emptyDetail')
    : state === 'overdue'
      ? t('portal.account.overdueDetail', {
          count: overview.overdueCount,
          days: overview.daysLate,
        })
      : state === 'pending'
        ? t('portal.account.pendingDetail', { count: overview.pendingCount })
        : t('portal.account.clearDetail');

  const focusLine = focusInvoice
    ? state === 'overdue'
      ? t('portal.account.focusOverdue', {
          period: formatPeriod(focusInvoice.period),
          date: formatDate(focusInvoice.dueDate),
        })
      : t('portal.account.focusDue', {
          period: formatPeriod(focusInvoice.period),
          days: Math.max(0, daysToDue ?? 0),
        })
    : null;

  const showSplit = overview.overdueCount > 0 && overview.pendingCount > 0;

  return (
    <ListTransition
      state={loading ? 'loading' : 'ready'}
      skeleton={<AccountStatusSkeleton />}
      empty={null}
    >
      <section className="card-lux relative overflow-hidden p-5 sm:p-6">
        {/* Tinted wash — the state is readable before a single word is. */}
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-[0.18] blur-3xl"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />

        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <Plate icon={blank ? 'invoices' : ICON_BY_STATE[state]} tone={tone} size="sm" />
              <p className="eyebrow">{t('portal.account.label')}</p>
            </div>

            <p
              className="numeric-xl mt-3 break-words !text-[2rem] sm:!text-4xl"
              style={state === 'clear' ? undefined : { color }}
            >
              {headline}
            </p>

            <p className="mt-1.5 text-sm font-medium text-[var(--color-text)]">{detail}</p>
            {/* Reserved even when empty: the panel must not resize between states. */}
            <p className="mt-0.5 min-h-[1.125rem] text-xs text-[var(--color-muted)]">{focusLine}</p>

            {showSplit && (
              <p className="mt-2 text-xs text-[var(--color-muted)]">
                {t('portal.account.split', {
                  overdue: formatMoney(overview.overdueAmount, currency),
                  pending: formatMoney(overview.balance - overview.overdueAmount, currency),
                })}
              </p>
            )}
          </div>

          <div className="shrink-0 md:text-right">
            <Link href={paths.invoices} className="inline-block">
              <Button variant={state === 'clear' ? 'secondary' : 'primary'}>
                <Icon name="invoices" className="h-4 w-4" strokeWidth={1.9} />
                {state === 'clear'
                  ? t('portal.account.viewAllAction')
                  : t('portal.account.payAction')}
              </Button>
            </Link>
            <p className="mt-2 text-xs text-[var(--color-muted)] md:text-right">
              {t('portal.account.paidHistory', { count: overview.paidCount })}
            </p>
          </div>
        </div>
      </section>
    </ListTransition>
  );
}

/** Same skeleton shape as the panel, so the swap doesn't move the page. */
function AccountStatusSkeleton() {
  return (
    <section className="card-lux p-5 sm:p-6" aria-hidden="true">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="w-full">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-9 w-9 rounded-[var(--radius-lg)]" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="mt-4 h-9 w-48" />
          <Skeleton className="mt-2.5 h-4 w-40" />
          <Skeleton className="mt-1.5 h-3 w-52" />
        </div>
        <div className="shrink-0">
          <Skeleton className="h-11 w-40 rounded-lg" />
          <Skeleton className="mt-2 h-3 w-28" />
        </div>
      </div>
    </section>
  );
}
