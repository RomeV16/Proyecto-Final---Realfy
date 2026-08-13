'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { TicketStatus, TicketPriority } from '@realfy/shared';
import { TicketStatusBadge } from '@/components/tickets/ticket-status-badge';
import { TicketPriorityBadge } from '@/components/tickets/ticket-priority-badge';
import { EntityCard } from '@/components/ui/entity-card';
import { CardGrid } from '@/components/ui/card-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

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

/** Priority drives the accent bar, so a grid can be triaged at a glance. */
const PRIORITY_ACCENT: Record<string, 'danger' | 'warning' | 'info' | 'none'> = {
  [TicketPriority.Urgente]: 'danger',
  [TicketPriority.Alta]: 'warning',
  [TicketPriority.Media]: 'info',
  [TicketPriority.Baja]: 'none',
};

/* ──────────── Card ──────────── */

function TicketCard({
  ticket,
  localePrefix,
  now,
}: {
  ticket: TicketItem;
  localePrefix: string;
  now: Date;
}) {
  const t = useTranslations('tickets');
  const href = `${localePrefix}/tickets/${ticket.id}`;
  const sla = ticket.slaDeadline ? new Date(ticket.slaDeadline) : null;
  const slaOverdue = sla ? sla < now : false;
  const ageDays = Math.max(
    0,
    Math.floor((now.getTime() - new Date(ticket.createdAt).getTime()) / 86_400_000),
  );
  const assignedName = ticket.assignedTo
    ? `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}`
    : null;

  /* The card says what's blocking this ticket, so the grid doubles as a
     worklist. An SLA breach outranks a missing assignee. */
  const alert = slaOverdue
    ? { tone: 'danger' as const, icon: 'clock' as const, text: t('card.slaOverdue') }
    : !assignedName
      ? { tone: 'warning' as const, icon: 'alert' as const, text: t('card.noAssignee') }
      : null;

  return (
    <EntityCard href={href} label={ticket.title} accent={PRIORITY_ACCENT[ticket.priority] ?? 'none'}>
      <EntityCard.Cover
        seed={ticket.id}
        icon="tickets"
        band
        topLeft={<TicketPriorityBadge priority={ticket.priority} onCover />}
        topRight={
          sla && (
            <span className="inline-flex items-center gap-1 rounded-full border border-white/25 bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md">
              <Icon name="clock" className="h-3 w-3" strokeWidth={2} />
              {sla.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
            </span>
          )
        }
      />

      <EntityCard.Body>
        <EntityCard.Title>{ticket.title}</EntityCard.Title>
        <EntityCard.Subtitle>{ticket.category?.name || t('card.noCategory')}</EntityCard.Subtitle>

        <EntityCard.Meta
          items={[
            ...(ticket.property ? [{ icon: 'mapPin' as const, label: ticket.property.title }] : []),
            { icon: 'clock' as const, label: t('card.age', { days: ageDays }) },
          ]}
        />

        {/* Wrapped so the pill hugs its label — Body is a flex column, and a
            bare badge would stretch to the full card width. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <TicketStatusBadge status={ticket.status} />
        </div>

        {alert && (
          <EntityCard.Alert tone={alert.tone} icon={alert.icon}>
            {alert.text}
          </EntityCard.Alert>
        )}
      </EntityCard.Body>

      <EntityCard.Footer>
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={assignedName} seed={ticket.assignedTo?.id} size="sm" />
          <span className="truncate text-xs text-[var(--color-muted)]">
            {assignedName || t('card.noAssignee')}
          </span>
        </div>
        <EntityCard.Actions>
          <EntityCard.Action href={href} icon="arrowRight" variant="ghost">
            {t('card.view')}
          </EntityCard.Action>
        </EntityCard.Actions>
      </EntityCard.Footer>
    </EntityCard>
  );
}

/* ──────────── Page ──────────── */

export default function TicketListPage() {
  const t = useTranslations('tickets');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

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
    loadTickets();
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
        <Link href={`${localePrefix}/tickets/new`} className="shrink-0">
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

      {/* Grid — owns the loading → content → empty transition */}
      <CardGrid
        items={items}
        loading={loading && !loaded}
        busy={loading && loaded}
        columns={3}
        skeletonCount={6}
        keyOf={(ticket) => ticket.id}
        renderItem={(ticket) => (
          <TicketCard ticket={ticket} localePrefix={localePrefix} now={now} />
        )}
        empty={
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
                <Link href={`${localePrefix}/tickets/new`}>
                  <Button variant="primary">
                    <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
                    {t('newTicket')}
                  </Button>
                </Link>
              }
            />
          )
        }
      />

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
