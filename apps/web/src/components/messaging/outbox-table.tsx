'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { OutboxItem } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import { canCancelMessage, canRetryMessage, relatedHref } from '@/lib/messaging';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn, type DataTablePagination } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { StatusBadge } from '@/components/ui/status-badge';
import { useErrorText } from '@/components/cash/use-cash-data';
import { useMessageText } from './use-message-text';

interface Props {
  items: OutboxItem[];
  loading: boolean;
  error?: unknown;
  /** Se llama después de reintentar o cancelar, para volver a leer la lista. */
  onChanged: () => void;
  pagination?: DataTablePagination;
  /** Sin las columnas del documento y de los intentos (la lista de un documento, dentro de su diálogo). */
  compact?: boolean;
  /** Título del estado vacío, si no es el de la bandeja de salida. */
  emptyTitle?: string;
}

/**
 * Mensajes de la bandeja de salida: cuándo, a quién, por qué canal, qué plantilla y de qué documento, con su
 * estado y el motivo si quedó frenado. Administración y Gerencia reintentan o cancelan desde acá.
 */
export function OutboxTable({ items, loading, error, onChanged, pagination, compact, emptyTitle }: Props) {
  const t = useTranslations('messaging');
  const text = useMessageText();
  const confirm = useConfirm();
  const errorText = useErrorText();
  const canManage = useCan('messaging.manage');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(item: OutboxItem, action: 'retry' | 'cancel') {
    const ok = await confirm({
      title: t(`${action}.title`),
      body: t(`${action}.body`, { to: item.to }),
      confirmLabel: t(`${action}.confirm`),
      cancelLabel: t(`${action}.keep`),
      tone: action === 'cancel' ? 'danger' : 'default',
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      await apiClient<OutboxItem>(`/outbox/${item.id}/${action}`, { method: 'POST' });
      toast.success(t(`${action}.done`));
      onChanged();
    } catch (err) {
      toast.error(errorText(err, t(`${action}.error`)));
    } finally {
      setBusyId(null);
    }
  }

  const columns: DataTableColumn<OutboxItem>[] = [
    {
      key: 'date',
      header: t('columns.date'),
      render: (m) => <DateText value={m.createdAt} kind="datetime" className="whitespace-nowrap" />,
    },
    {
      key: 'recipient',
      header: t('columns.recipient'),
      render: (m) => (
        <div className="min-w-0">
          <p className="text-[var(--color-text)]">
            {m.personId ? (
              <Link href={`/persons/${m.personId}`} className="hover:underline">
                {m.personName ?? t('noRecipient')}
              </Link>
            ) : (
              (m.personName ?? t('noRecipient'))
            )}
          </p>
          <p className="break-all text-xs text-[var(--color-muted)]">{m.to}</p>
        </div>
      ),
    },
    { key: 'channel', header: t('columns.channel'), render: (m) => text.channel(m.channel) },
    { key: 'template', header: t('columns.template'), render: (m) => text.template(m.templateKey) },
    ...(compact
      ? []
      : [
          {
            key: 'related',
            header: t('columns.related'),
            render: (m: OutboxItem) => {
              if (!m.relatedType) return '—';
              const href = relatedHref(m.relatedType, m.relatedId);
              const label = text.related(m.relatedType);
              return href ? (
                <Link href={href} className="text-[var(--color-brand-600)] hover:underline">
                  {label}
                </Link>
              ) : (
                label
              );
            },
          },
        ]),
    { key: 'status', header: t('columns.status'), render: (m) => <StatusBadge domain="mensaje" status={m.status} /> },
    {
      key: 'detail',
      header: t('columns.detail'),
      render: (m) => {
        const explanation = text.explain(m);
        return explanation ? <p className="max-w-xs text-xs text-[var(--color-muted)]">{explanation}</p> : '—';
      },
    },
    ...(compact
      ? []
      : [{ key: 'attempts', header: t('columns.attempts'), alignRight: true, render: (m: OutboxItem) => m.attempts }]),
    ...(canManage
      ? [
          {
            key: 'actions',
            header: t('columns.actions'),
            render: (m: OutboxItem) => (
              <div className="flex flex-wrap gap-2">
                {canRetryMessage(m.status) && (
                  <Button type="button" size="sm" variant="secondary" disabled={busyId === m.id} onClick={() => void act(m, 'retry')}>
                    {t('actions.retry')}
                  </Button>
                )}
                {canCancelMessage(m.status) && (
                  <Button type="button" size="sm" variant="ghost" disabled={busyId === m.id} onClick={() => void act(m, 'cancel')}>
                    {t('actions.cancel')}
                  </Button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <DataTable
      items={items}
      columns={columns}
      keyExtractor={(m) => m.id}
      loading={loading}
      error={error}
      pagination={pagination}
      empty={{ title: emptyTitle ?? t('empty.title'), subtitle: compact ? undefined : t('empty.subtitle'), iconName: 'mail' }}
    />
  );
}
