'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { TicketStatus, TicketPriority } from '@realfy/shared';
import { StatusBadge } from '@/components/ui/status-badge';
import { TicketPriorityBadge } from '@/components/tickets/ticket-priority-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { msSince, useElapsedText } from '@/components/tickets/elapsed';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { formatLocalDate } from '@/lib/format';

interface TicketItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  slaDeadline?: string;
  assignedTo?: { id: string; firstName: string; lastName: string };
  category?: { id: string; name: string };
  property?: { id: string; title: string };
  createdAt: string;
}

interface ListResponse {
  data: TicketItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** Estados en los que el plazo de respuesta ya no corre. */
const CLOSED_STATUSES = [
  TicketStatus.Resuelto,
  TicketStatus.Cerrado,
  TicketStatus.Cancelado,
] as string[];

const PRIORITY_ORDER: Record<string, number> = {
  [TicketPriority.Urgente]: 0,
  [TicketPriority.Alta]: 1,
  [TicketPriority.Media]: 2,
  [TicketPriority.Baja]: 3,
};

const PRIORITY_BAR: Record<string, string> = {
  [TicketPriority.Urgente]: 'var(--color-danger)',
  [TicketPriority.Alta]: 'var(--color-warning)',
  [TicketPriority.Media]: 'var(--color-info)',
  [TicketPriority.Baja]: 'var(--color-border)',
};

type GroupKey = 'overdue' | 'open' | 'closed';
const GROUPS: GroupKey[] = ['overdue', 'open', 'closed'];

function groupOf(ticket: TicketItem, now: Date): GroupKey {
  if (CLOSED_STATUSES.includes(ticket.status)) return 'closed';
  return ticket.slaDeadline && new Date(ticket.slaDeadline) < now ? 'overdue' : 'open';
}

/** Dentro de cada grupo: primero lo más urgente y, a igual prioridad, lo que vence antes. */
function byPriorityAndDeadline(a: TicketItem, b: TicketItem): number {
  const priority = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
  if (priority !== 0) return priority;
  const da = a.slaDeadline ? new Date(a.slaDeadline).getTime() : Number.POSITIVE_INFINITY;
  const db = b.slaDeadline ? new Date(b.slaDeadline).getTime() : Number.POSITIVE_INFINITY;
  return da - db;
}

/* ──────────── Row ──────────── */

function TicketRow({ ticket, group, now }: { ticket: TicketItem; group: GroupKey; now: Date }) {
  const t = useTranslations('tickets');
  const elapsed = useElapsedText();
  const href = `/tickets/${ticket.id}`;
  const deadline = ticket.slaDeadline ? new Date(ticket.slaDeadline) : null;
  const assignedName = ticket.assignedTo
    ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}`
    : null;
  const context = [ticket.category?.name || t('card.noCategory'), ticket.property?.title].filter(Boolean).join(' · ');

  let deadlineText: string;
  if (group === 'closed') deadlineText = '';
  else if (!deadline) deadlineText = t('list.noDeadline');
  else if (group === 'overdue') deadlineText = t('list.overdueFor', { time: elapsed(msSince(deadline, now)) });
  else deadlineText = t('list.dueIn', { time: elapsed(msSince(deadline, now)) });

  return (
    <li className="relative">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: PRIORITY_BAR[ticket.priority] ?? 'var(--color-border)' }}
      />
      <Link
        href={href}
        className="grid gap-x-4 gap-y-2 py-3.5 pl-5 pr-4 transition-colors hover:bg-[var(--color-surface-sunken)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 md:grid-cols-[minmax(0,1fr)_11rem_13rem_11rem] md:items-center"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <TicketPriorityBadge priority={ticket.priority} />
            <span className="min-w-0 truncate font-medium text-[var(--color-text)]">{ticket.title}</span>
          </div>
          <p className="mt-1 truncate text-xs text-[var(--color-muted)]">{context}</p>
        </div>

        <div className="flex items-center md:justify-start">
          <StatusBadge domain="ticket" status={ticket.status} />
        </div>

        <div className="min-w-0 text-xs">
          {deadlineText && (
            <p
              className={
                group === 'overdue'
                  ? 'flex items-center gap-1.5 font-medium text-[var(--color-danger)]'
                  : 'flex items-center gap-1.5 text-[var(--color-text)]'
              }
            >
              <Icon name="clock" className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span>{deadlineText}</span>
            </p>
          )}
          <p className="mt-0.5 text-[var(--color-muted)]">
            {deadline && group !== 'closed'
              ? t('list.deadlineOn', { date: formatLocalDate(deadline, { day: '2-digit', month: 'short' }) })
              : t('list.openedAgo', { time: elapsed(msSince(ticket.createdAt, now)) })}
          </p>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={assignedName} seed={ticket.assignedTo?.id} size="xs" />
          <span
            className={
              assignedName || group === 'closed'
                ? 'truncate text-xs text-[var(--color-muted)]'
                : 'truncate text-xs font-medium text-[var(--color-warning)]'
            }
          >
            {assignedName || t('card.noAssignee')}
          </span>
        </div>
      </Link>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-[var(--color-border)] px-5 py-4 last:border-b-0">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-32 md:block" />
          <Skeleton className="hidden h-4 w-28 md:block" />
        </div>
      ))}
    </div>
  );
}

/* ──────────── Page ──────────── */

export default function TicketListPage() {
  const t = useTranslations('tickets');
  const tCommon = useTranslations('common');

  const [items, setItems] = useState<TicketItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const limit = 20;

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);

      const res = await apiClient<ListResponse>(`/tickets?${params.toString()}`);
      setItems(res.data || []);
      setTotal(res.meta?.total || 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [page, statusFilter, priorityFilter]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const totalPages = Math.ceil(total / limit);
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const hasFilters = Boolean(statusFilter || priorityFilter);
  const now = new Date();

  function clearFilters() {
    setStatusFilter('');
    setPriorityFilter('');
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        <Link href={'/tickets/new'} className="shrink-0">
          <Button variant="primary">
            <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
            {t('newTicket')}
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-brand-500 focus:outline-none"
        >
          <option value="">{t('filters.statusPlaceholder')}</option>
          {Object.values(TicketStatus).map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => {
            setPriorityFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-brand-500 focus:outline-none"
        >
          <option value="">{t('filters.priorityPlaceholder')}</option>
          {Object.values(TicketPriority).map((p) => (
            <option key={p} value={p}>
              {t(`priorities.${p}`)}
            </option>
          ))}
        </select>
        {hasFilters && (
          <Button variant="secondary" size="sm" onClick={clearFilters}>
            {t('filters.clear')}
          </Button>
        )}
      </div>

      {loading && !loaded ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyState
            variant="filtered"
            iconName="search"
            title={tCommon('noResults')}
            subtitle={t('empty.filtered')}
            action={
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                {t('filters.clear')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            iconName="tickets"
            title={t('empty.title')}
            subtitle={t('empty.subtitle')}
            steps={[t('empty.step1'), t('empty.step2'), t('empty.step3')]}
            action={
              <Link href={'/tickets/new'}>
                <Button variant="primary">
                  <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
                  {t('newTicket')}
                </Button>
              </Link>
            }
          />
        )
      ) : (
        <div className={loading ? 'space-y-6 opacity-60 transition-opacity' : 'space-y-6 transition-opacity'}>
          {GROUPS.map((group) => {
            const rows = items.filter((ticket) => groupOf(ticket, now) === group).sort(byPriorityAndDeadline);
            if (rows.length === 0) return null;
            return (
              <section key={group} aria-label={t(`list.groups.${group}`)}>
                <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <span className={group === 'overdue' ? 'text-[var(--color-danger)]' : undefined}>
                    {t(`list.groups.${group}`)}
                  </span>
                  <span className="text-xs font-normal tabular-nums text-[var(--color-muted)]">{rows.length}</span>
                </h2>
                <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                  {rows.map((ticket) => (
                    <TicketRow key={ticket.id} ticket={ticket} group={group} now={now} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-muted)]">
            {t('pagination.showing', { from, to, total })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              {t('pagination.prev')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              {t('pagination.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
