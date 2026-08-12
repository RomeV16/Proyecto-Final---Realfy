'use client';

import { useState, useEffect, useCallback } from 'react';
import { Spinner } from '@/components/ui/spinner';
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Notificaciones
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Vencimientos, deudas y cambios de estado
          </p>
        </div>
        <button
          onClick={markAllAsRead}
          disabled={!hasUnread}
          className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Marcar todas como leídas
        </button>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
          <p className="text-lg font-semibold text-slate-900">
            No tenés notificaciones
          </p>
          <p className="text-sm text-slate-500 mt-1">
            Te avisaremos cuando haya novedades.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li
              key={n.id}
              className={`rounded-xl border p-4 transition-colors ${
                n.isRead
                  ? 'bg-white border-slate-200'
                  : 'bg-brand-50/40 border-brand-200'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {n.title}
                  </p>
                  <p className="text-sm text-slate-600 mt-0.5">{n.message}</p>
                  <p className="text-xs text-slate-400 mt-1.5">
                    {formatDate(n.createdAt)}
                  </p>
                </div>
                {!n.isRead && (
                  <button
                    onClick={() => markAsRead(n.id)}
                    className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
                  >
                    Marcar como leída
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
