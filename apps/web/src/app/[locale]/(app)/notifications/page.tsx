'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
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

export default function NotificationsPage() {
  const pathname = usePathname();
  const lp = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient<PaginatedResponse<Notification>>(
        '/notifications?limit=50',
      );
      setItems(data.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markAsRead = useCallback(async (id: string) => {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
    );
    await apiClient(`/notifications/${id}/read`, { method: 'PATCH' });
  }, []);

  const markAllAsRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await apiClient('/notifications/mark-all-read', { method: 'PATCH' });
  }, []);

  const entityHref = (n: Notification): string | null => {
    if (!n.entityId) return null;
    const kind = (n.entityType || '').toLowerCase();
    if (kind.includes('ticket')) return `${lp}/tickets/${n.entityId}`;
    if (kind.includes('liquidacion')) return `${lp}/liquidaciones`;
    if (kind.includes('contract') || kind.includes('contrato')) return `${lp}/contracts/${n.entityId}`;
    if (kind.includes('propert') || kind.includes('propiedad')) return `${lp}/properties/${n.entityId}`;
    if (kind.includes('person') || kind.includes('persona')) return `${lp}/persons/${n.entityId}`;
    return null;
  };

  const hasUnread = items.some((n) => !n.isRead);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="h-6 w-6 text-brand-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-3">Avisos</p>
          <h1 className="h1">Notificaciones</h1>
          <p className="text-sm text-[var(--color-muted)] mt-2">
            Vencimientos, deudas y cambios de estado
          </p>
        </div>
        <Button variant="secondary" onClick={markAllAsRead} disabled={!hasUnread}>
          Marcar todas como leídas
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="card-lux p-12 text-center">
          <p className="text-lg font-semibold text-[var(--color-text)]">
            No tenés notificaciones
          </p>
          <p className="text-sm text-[var(--color-muted)] mt-1">
            Te avisaremos cuando haya novedades.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {items.map((n) => {
            const href = entityHref(n);
            const inner = (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex items-start gap-3">
                  {!n.isRead && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-text)]">
                      {n.title}
                    </p>
                    <p className="text-sm text-[var(--color-muted)] mt-0.5">
                      {n.message}
                    </p>
                    <p className="text-xs text-[var(--color-muted)]/70 mt-1.5">
                      {formatDate(n.createdAt)}
                    </p>
                  </div>
                </div>
                {!n.isRead && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      markAsRead(n.id);
                    }}
                    className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
                  >
                    Marcar como leída
                  </button>
                )}
              </div>
            );
            const cls = `block rounded-xl border p-4 transition-all duration-300 ${
              n.isRead
                ? 'bg-[var(--color-surface)] border-[var(--color-border)]'
                : 'bg-brand-50/50 border-brand-200'
            } ${href ? 'hover:border-brand-300 hover:shadow-md hover:shadow-brand-500/5' : ''}`;
            return (
              <li key={n.id}>
                {href ? (
                  <Link href={href} onClick={() => markAsRead(n.id)} className={cls}>
                    {inner}
                  </Link>
                ) : (
                  <div className={cls}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
