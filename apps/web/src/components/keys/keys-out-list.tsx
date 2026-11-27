'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@/i18n/navigation';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { useCan } from '@/lib/permissions';
import { KEY_HOLDERS_OUT, holderLabel, placeOf, type KeyOut } from '@/lib/sales';
import { toUtcDay } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateText } from '@/components/ui/date-text';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { PaginationBar } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { KeyCheckInDialog } from './key-dialogs';

const LIMIT = 50;
const EMPTY_FILTERS = { overdue: '' };
const DAY_MS = 86_400_000;

/** Días calendario desde que salió el juego (0 = hoy). */
function daysOut(outAt: string): number {
  const out = toUtcDay(outAt);
  if (out === null) return 0;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - out) / DAY_MS));
}

function KeyCard({ movement, onReturn }: { movement: KeyOut; onReturn?: () => void }) {
  const t = useTranslations('keys');
  const holder = holderLabel(movement) || t('board.unknownHolder');
  return (
    <li
      className={cn(
        'rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-3.5 shadow-sm',
        movement.overdue
          ? 'border-[color-mix(in_oklab,var(--color-danger)_45%,var(--color-border))]'
          : 'border-[var(--color-border)]',
      )}
    >
      <div className="flex items-center gap-2.5">
        <Avatar name={holder} seed={holder} size="sm" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text)]">{holder}</p>
      </div>

      <div className="mt-2.5">
        <Link
          href={`/properties/${movement.keySet.propertyId}`}
          className="text-sm text-[var(--color-text)] underline-offset-2 hover:text-[var(--color-brand-600)] hover:underline"
        >
          {placeOf(movement.keySet.property)}
        </Link>
        <p className="text-xs text-[var(--color-muted)]">
          {t('board.keySet', { label: movement.keySet.label })} · {t('card.copies', { count: movement.keySet.copies })}
        </p>
      </div>

      <dl className="mt-2.5 space-y-1 border-t border-[var(--color-border)] pt-2.5 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--color-muted)]">{t('board.since')}</dt>
          <dd className="text-right text-[var(--color-text)]">
            <DateText value={movement.outAt} style="medium" />
            <span className="text-[var(--color-muted)]"> · {t('board.daysOut', { days: daysOut(movement.outAt) })}</span>
          </dd>
        </div>
        {movement.reason && (
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-[var(--color-muted)]">{t('out.columns.reason')}</dt>
            <dd className="min-w-0 truncate text-right text-[var(--color-text)]" title={movement.reason}>
              {movement.reason}
            </dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[var(--color-muted)]">{t('out.columns.expected')}</dt>
          <dd className="flex flex-wrap items-center justify-end gap-1.5 text-right text-[var(--color-text)]">
            {movement.expectedReturnAt ? (
              <DateText value={movement.expectedReturnAt} style="medium" />
            ) : (
              <span className="text-[var(--color-muted)]">{t('board.noReturnDate')}</span>
            )}
            {movement.overdue && (
              <Badge variant="danger" size="sm">
                {t('card.overdue', { days: movement.daysOverdue })}
              </Badge>
            )}
          </dd>
        </div>
      </dl>

      {onReturn && (
        <Button type="button" size="sm" variant="secondary" className="mt-3 w-full" onClick={onReturn}>
          {t('card.checkIn')}
        </Button>
      )}
    </li>
  );
}

/** "Llaves fuera": un tablero con una columna por tipo de tenedor; cada tarjeta dice quién tiene qué juego y desde cuándo. */
export function KeysOutList() {
  const t = useTranslations('keys');
  const canView = useCan('keys.view');
  const canManage = useCan('keys.manage');
  const queryClient = useQueryClient();
  const [returning, setReturning] = useState<KeyOut | null>(null);
  const list = usePaginatedList<KeyOut, typeof EMPTY_FILTERS>({
    key: 'keys-out',
    path: '/keys/out',
    limit: LIMIT,
    initialFilters: EMPTY_FILTERS,
    enabled: canView,
  });

  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  const overdueOnly = list.filters.overdue === 'true';
  const overdueCount = list.items.filter((m) => m.overdue).length;
  const columns = KEY_HOLDERS_OUT.map((holder) => ({
    holder,
    items: list.items
      .filter((m) => m.holder === holder)
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.outAt.localeCompare(b.outAt)),
  }));
  const empty = !list.isLoading && list.error == null && list.items.length === 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">{t('out.title')}</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-[var(--color-muted)]">{t('out.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!list.isLoading && list.total > 0 && (
            <p className="text-sm text-[var(--color-muted)]">
              {t('board.summary', { count: list.total })}
              {overdueCount > 0 && (
                <span className="font-medium text-[var(--color-danger)]">
                  {' · '}
                  {t('board.overdueCount', { count: overdueCount })}
                </span>
              )}
            </p>
          )}
          <button
            type="button"
            aria-pressed={overdueOnly}
            onClick={() => list.setFilter('overdue', overdueOnly ? '' : 'true')}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
              overdueOnly
                ? 'border-[var(--color-danger)] bg-[var(--color-danger)] text-white'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {t('out.filters.overdueOnly')}
          </button>
        </div>
      </header>

      {list.error != null && <ErrorNotice error={list.error} />}

      {list.isLoading && (
        <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {KEY_HOLDERS_OUT.map((holder) => (
            <div key={holder} className="space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-36 w-full rounded-[var(--radius-lg)]" />
            </div>
          ))}
        </div>
      )}

      {empty &&
        (overdueOnly ? (
          <EmptyState
            variant="filtered"
            iconName="properties"
            title={t('board.noOverdue')}
            action={
              <Button type="button" variant="secondary" size="sm" onClick={() => list.setFilter('overdue', '')}>
                {t('board.showAll')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            iconName="properties"
            title={t('out.empty')}
            subtitle={t('out.emptySubtitle')}
            action={
              <Link
                href="/properties"
                className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-sunken)]"
              >
                {t('board.goToProperties')}
              </Link>
            }
          />
        ))}

      {!list.isLoading && list.error == null && list.items.length > 0 && (
        <div
          className={cn(
            'grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4',
            list.isFetching && 'pointer-events-none opacity-60 transition-opacity duration-200',
          )}
        >
          {columns.map(({ holder, items }) => (
            <section
              key={holder}
              aria-labelledby={`keys-col-${holder}`}
              className="rounded-[var(--radius-xl)] bg-[var(--color-surface-sunken)] p-3"
            >
              <h2
                id={`keys-col-${holder}`}
                className="flex items-center justify-between px-1 pb-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]"
              >
                {t(`board.columns.${holder}`)}
                <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--color-text)]">
                  {items.length}
                </span>
              </h2>
              {items.length === 0 ? (
                <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-3 py-5 text-center text-xs text-[var(--color-muted)]">
                  {t('board.emptyColumn')}
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {items.map((m) => (
                    <KeyCard key={m.id} movement={m} onReturn={canManage ? () => setReturning(m) : undefined} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      <PaginationBar page={list.page} totalPages={list.totalPages} total={list.total} limit={list.limit} onPageChange={list.setPage} />

      {returning && (
        <KeyCheckInDialog
          keySetId={returning.keySet.id}
          label={returning.keySet.label}
          onClose={() => setReturning(null)}
          onDone={() => void queryClient.invalidateQueries({ queryKey: ['keys-out'] })}
        />
      )}
    </div>
  );
}
