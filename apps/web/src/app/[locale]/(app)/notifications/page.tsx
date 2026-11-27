'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon, type IconName } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDateTime, formatLocalDate } from '@/lib/format';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type Tone = 'danger' | 'warning' | 'info' | 'success' | 'brand';
type Filter = 'all' | 'unread';

/**
 * Tipo de aviso → ícono y tono. Los tipos llegan de la API y cambian según el módulo, por eso se busca por
 * fragmentos y no contra una lista cerrada.
 */
function kindOf(type: string): { icon: IconName; tone: Tone } {
  const kind = (type || '').toLowerCase();
  if (kind.includes('overdue') || kind.includes('deuda') || kind.includes('debt') || kind.includes('mora'))
    return { icon: 'alert', tone: 'danger' };
  if (kind.includes('venc') || kind.includes('expir') || kind.includes('due'))
    return { icon: 'calendarClock', tone: 'warning' };
  if (kind.includes('pago') || kind.includes('payment')) return { icon: 'wallet', tone: 'success' };
  if (kind.includes('ticket') || kind.includes('reclamo')) return { icon: 'tickets', tone: 'info' };
  if (kind.includes('message') || kind.includes('optedout')) return { icon: 'mail', tone: 'info' };
  return { icon: 'bell', tone: 'brand' };
}

const TONE_COLOR: Record<Tone, string> = {
  danger: 'var(--color-danger)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)',
  success: 'var(--color-success)',
  brand: 'var(--color-brand-500)',
};

function entityHref(n: Notification): string | undefined {
  if (!n.entityId) return undefined;
  const kind = (n.entityType || '').toLowerCase();
  if (kind.includes('ticket')) return `/tickets/${n.entityId}`;
  if (kind.includes('liquidacion')) return '/liquidaciones';
  if (kind.includes('contract') || kind.includes('contrato')) return `/contracts/${n.entityId}`;
  if (kind.includes('propert') || kind.includes('propiedad')) return `/properties/${n.entityId}`;
  if (kind.includes('person') || kind.includes('persona')) return `/persons/${n.entityId}`;
  return undefined;
}

/** Clave del día en la zona horaria de quien mira, para agrupar el listado. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function FeedSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <Skeleton className="h-4 w-24" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function NotificationsPage() {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient<PaginatedResponse<Notification>>('/notifications?limit=50');
      setItems(data.items ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markAsRead = useCallback(
    async (id: string) => {
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      try {
        await apiClient(`/notifications/${id}/read`, { method: 'PATCH' });
      } catch {
        void load();
      }
    },
    [load],
  );

  const markAllAsRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await apiClient('/notifications/mark-all-read', { method: 'PATCH' });
    } catch {
      void load();
    }
  }, [load]);

  const unread = items.filter((n) => !n.isRead).length;

  const groups = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);
    const visible = filter === 'unread' ? items.filter((n) => !n.isRead) : items;
    const out: { key: string; label: string; items: Notification[] }[] = [];
    for (const n of visible) {
      const date = new Date(n.createdAt);
      const key = dayKey(date);
      let group = out.find((g) => g.key === key);
      if (!group) {
        let label: string;
        if (key === dayKey(today)) label = t('page.today');
        else if (key === dayKey(yesterday)) label = t('page.yesterday');
        else label = formatLocalDate(date, { weekday: 'long', day: 'numeric', month: 'long' }, locale);
        group = { key, label, items: [] };
        out.push(group);
      }
      group.items.push(n);
    }
    return out;
  }, [items, filter, t, locale]);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            {unread > 0 ? t('page.unread', { count: unread }) : t('page.allRead')}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void markAllAsRead()} disabled={unread === 0}>
          <Icon name="check" className="h-4 w-4" strokeWidth={2} />
          {t('markAllRead')}
        </Button>
      </div>

      {items.length > 0 && (
        <div className="flex gap-1" role="group" aria-label={t('list.title')}>
          {(['all', 'unread'] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                filter === key
                  ? 'border-[var(--color-text)] bg-[var(--color-text)] text-[var(--color-surface)]'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]',
              )}
            >
              {t(`list.filter.${key}`)}
              {key === 'unread' && unread > 0 && <span className="ml-1.5 tabular-nums">{unread}</span>}
            </button>
          ))}
        </div>
      )}

      {loading && items.length === 0 && !failed && <FeedSkeleton />}

      {failed && (
        <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-[var(--color-muted)]">{t('page.loadError')}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('actions.refresh')}
          </Button>
        </div>
      )}

      {!loading && !failed && items.length === 0 && (
        <EmptyState iconName="bell" title={t('page.emptyTitle')} subtitle={t('page.emptySubtitle')} />
      )}

      {!failed && items.length > 0 && groups.length === 0 && (
        <p className="py-10 text-center text-sm text-[var(--color-muted)]">{t('list.noUnread')}</p>
      )}

      {!failed &&
        groups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            <h2 className="mb-1 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              <span className="first-letter:uppercase">{group.label}</span>
              <span className="font-normal tabular-nums">{group.items.length}</span>
            </h2>
            <ol className="relative ml-4 border-l border-[var(--color-border)]">
              {group.items.map((n) => {
                const kind = kindOf(n.type);
                const href = entityHref(n);
                const color = TONE_COLOR[kind.tone];
                return (
                  <li key={n.id} className="relative py-3 pl-7 pr-1">
                    <span
                      aria-hidden="true"
                      className="absolute -left-4 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)]"
                      style={{
                        backgroundColor: n.isRead
                          ? 'var(--color-surface)'
                          : `color-mix(in oklab, ${color} 14%, var(--color-surface))`,
                        color: n.isRead ? 'var(--color-muted)' : color,
                      }}
                    >
                      <Icon name={kind.icon} className="h-4 w-4" strokeWidth={1.9} />
                    </span>
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                      <div className="min-w-0 flex-1 basis-64">
                        <p
                          className={cn(
                            'flex items-center gap-2 text-sm',
                            n.isRead ? 'text-[var(--color-muted)]' : 'font-semibold text-[var(--color-text)]',
                          )}
                        >
                          {!n.isRead && (
                            <span
                              className="h-2 w-2 shrink-0 rounded-full bg-brand-500"
                              role="img"
                              aria-label={t('detail.unread')}
                            />
                          )}
                          <span className="min-w-0 [overflow-wrap:anywhere]">{n.title}</span>
                        </p>
                        <p className="mt-0.5 text-sm text-[var(--color-muted)] [overflow-wrap:anywhere]">{n.message}</p>
                        <p className="mt-1 text-xs tabular-nums text-[var(--color-muted)]">
                          {formatDateTime(n.createdAt, { hour: '2-digit', minute: '2-digit' }, locale)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!n.isRead && (
                          <Button variant="ghost" size="sm" onClick={() => void markAsRead(n.id)}>
                            {t('page.markRead')}
                          </Button>
                        )}
                        {href && (
                          <Link href={href}>
                            <Button variant="secondary" size="sm">
                              {t('page.view')}
                              <Icon name="arrowRight" className="h-3.5 w-3.5" strokeWidth={2} />
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
    </div>
  );
}
