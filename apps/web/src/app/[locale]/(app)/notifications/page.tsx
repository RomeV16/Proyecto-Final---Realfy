'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EntityRow, Badge } from '@/components/ui/entity-card';
import { RowList } from '@/components/ui/card-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon, type IconName } from '@/components/ui/icon';
import { apiClient } from '@/lib/api-client';

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

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Notification kind → icon, tone and accent. The type strings come from the
 * API and vary by module, so this matches on substrings rather than an enum.
 */
function kindOf(type: string): {
  icon: IconName;
  tone: 'danger' | 'warning' | 'info' | 'success' | 'brand';
} {
  const kind = (type || '').toLowerCase();
  if (kind.includes('venc') || kind.includes('expir')) return { icon: 'calendarClock', tone: 'warning' };
  if (kind.includes('deuda') || kind.includes('debt') || kind.includes('mora'))
    return { icon: 'alert', tone: 'danger' };
  if (kind.includes('pago') || kind.includes('payment')) return { icon: 'wallet', tone: 'success' };
  if (kind.includes('ticket') || kind.includes('reclamo')) return { icon: 'tickets', tone: 'info' };
  return { icon: 'bell', tone: 'brand' };
}

export default function NotificationsPage() {
  const pathname = usePathname();
  const lp = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient<PaginatedResponse<Notification>>('/notifications?limit=50');
      setItems(data.items);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markAsRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    await apiClient(`/notifications/${id}/read`, { method: 'PATCH' });
  }, []);

  const markAllAsRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await apiClient('/notifications/mark-all-read', { method: 'PATCH' });
  }, []);

  const entityHref = (n: Notification): string | undefined => {
    if (!n.entityId) return undefined;
    const kind = (n.entityType || '').toLowerCase();
    if (kind.includes('ticket')) return `${lp}/tickets/${n.entityId}`;
    if (kind.includes('liquidacion')) return `${lp}/liquidaciones`;
    if (kind.includes('contract') || kind.includes('contrato')) return `${lp}/contracts/${n.entityId}`;
    if (kind.includes('propert') || kind.includes('propiedad')) return `${lp}/properties/${n.entityId}`;
    if (kind.includes('person') || kind.includes('persona')) return `${lp}/persons/${n.entityId}`;
    return undefined;
  };

  const unread = items.filter((n) => !n.isRead).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-3">Avisos</p>
          <h1 className="h1">Notificaciones</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            {unread > 0
              ? `Tenés ${unread} ${unread === 1 ? 'aviso sin leer' : 'avisos sin leer'}`
              : 'Vencimientos, deudas y cambios de estado'}
          </p>
        </div>
        <Button variant="secondary" onClick={markAllAsRead} disabled={unread === 0}>
          <Icon name="check" className="h-4 w-4" strokeWidth={2} />
          Marcar todas como leídas
        </Button>
      </div>

      <RowList
        items={items}
        loading={loading && !loaded}
        busy={loading && loaded}
        skeletonCount={5}
        keyOf={(n) => n.id}
        renderItem={(n) => {
          const kind = kindOf(n.type);
          const href = entityHref(n);
          return (
            <EntityRow
              href={href}
              label={n.title}
              accent={n.isRead ? 'none' : kind.tone}
              className={n.isRead ? 'opacity-75' : undefined}
              leading={
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: `color-mix(in oklab, var(--color-${
                      kind.tone === 'brand' ? 'brand-500' : kind.tone
                    }) 14%, var(--color-surface))`,
                    color: `var(--color-${kind.tone === 'brand' ? 'brand-500' : kind.tone})`,
                  }}
                >
                  <Icon name={kind.icon} className="h-5 w-5" strokeWidth={1.9} />
                </span>
              }
              title={
                <span className="inline-flex items-center gap-2">
                  <span className="truncate">{n.title}</span>
                  {!n.isRead && <Badge variant={kind.tone} dot>Nuevo</Badge>}
                </span>
              }
              subtitle={n.message}
              meta={<EntityRow.Meta items={[{ icon: 'clock', label: formatDate(n.createdAt) }]} />}
              actions={
                <>
                  {!n.isRead && (
                    <EntityRow.Action
                      icon="check"
                      variant="quiet"
                      onClick={(e) => {
                        e.preventDefault();
                        markAsRead(n.id);
                      }}
                    >
                      Marcar leída
                    </EntityRow.Action>
                  )}
                  {href && (
                    <EntityRow.Action href={href} icon="arrowRight" variant="ghost">
                      Ver
                    </EntityRow.Action>
                  )}
                </>
              }
            />
          );
        }}
        empty={
          <EmptyState
            iconName="bell"
            title="No tenés notificaciones"
            subtitle="Te avisaremos cuando haya vencimientos, deudas o cambios de estado en tus contratos."
          />
        }
      />
    </div>
  );
}
