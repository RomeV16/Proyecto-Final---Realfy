'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { TicketStatus, TicketPriority } from '@realfy/shared';
import { ResponsiveTable, Column } from '@/components/ui/responsive-table';
import { Button } from '@/components/ui/button';

interface TicketItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  slaDeadline?: string;
  assignedTo?: { id: string; firstName: string; lastName: string };
  category?: { id: string; name: string };
  createdAt: string;
}

interface ListResponse {
  data: TicketItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export default function TicketListPage() {
  const t = useTranslations('tickets');
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [items, setItems] = useState<TicketItem[]>([]);
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
    }
  }, [page, statusFilter, priorityFilter]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const totalPages = Math.ceil(total / limit);
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const now = new Date();

  function clearFilters() {
    setStatusFilter('');
    setPriorityFilter('');
    setPage(1);
  }

  const columns: Column<TicketItem>[] = [
    {
      key: 'title',
      header: 'Título',
      render: (ticket) => (
        <Link
          href={`${localePrefix}/tickets/${ticket.id}`}
          className="text-sm font-semibold text-slate-900 hover:text-brand-600 truncate block max-w-xs"
        >
          {ticket.title}
        </Link>
      ),
    },
    {
      key: 'status',
      header: t('filters.status'),
      render: (ticket) => (
        <span className="text-xs text-slate-700">{t(`statuses.${ticket.status}`)}</span>
      ),
    },
    {
      key: 'priority',
      header: t('filters.priority'),
      render: (ticket) => (
        <span className="text-xs text-slate-700">{t(`priorities.${ticket.priority}`)}</span>
      ),
    },
    {
      key: 'category',
      header: t('filters.category'),
      render: (ticket) => (
        <span className="text-xs text-slate-500">{ticket.category?.name || '—'}</span>
      ),
    },
    {
      key: 'assignedTo',
      header: t('filters.assignee'),
      render: (ticket) =>
        ticket.assignedTo ? (
          <span className="text-xs text-slate-700">
            {ticket.assignedTo.firstName} {ticket.assignedTo.lastName}
          </span>
        ) : (
          <span className="text-xs text-slate-400">{t('card.noAssignee')}</span>
        ),
    },
    {
      key: 'sla',
      header: 'Fecha límite',
      render: (ticket) => {
        const sla = ticket.slaDeadline ? new Date(ticket.slaDeadline) : null;
        if (!sla) return <span className="text-xs text-slate-400">—</span>;
        const overdue = sla < now;
        return (
          <span className={`text-xs ${overdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
            {overdue ? 'Vencido' : sla.toLocaleDateString('es-AR')}
          </span>
        );
      },
    },
    {
      key: 'createdAt',
      header: t('card.created'),
      render: (ticket) => (
        <span className="text-xs text-slate-500">
          {new Date(ticket.createdAt).toLocaleDateString('es-AR')}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
        </div>
        <Link href={`${localePrefix}/tickets/new`} className="shrink-0">
          <Button variant="primary">{t('newTicket')}</Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
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
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">{t('filters.priorityPlaceholder')}</option>
          {Object.values(TicketPriority).map((p) => (
            <option key={p} value={p}>
              {t(`priorities.${p}`)}
            </option>
          ))}
        </select>
        {(statusFilter || priorityFilter) && (
          <Button variant="secondary" size="sm" onClick={clearFilters}>
            {t('filters.clear')}
          </Button>
        )}
      </div>

      <ResponsiveTable<TicketItem>
        items={items}
        columns={columns}
        keyExtractor={(ticket) => ticket.id}
        loading={loading}
        skeletonRows={5}
        empty={{
          title: t('empty.title'),
          subtitle: t('empty.subtitle'),
        }}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">{t('pagination.showing', { from, to, total })}</span>
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
