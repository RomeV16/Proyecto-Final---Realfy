'use client';

import { useTranslations } from 'next-intl';
import type { OutboxItem } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import {
  EMPTY_OUTBOX_FILTERS,
  MESSAGE_CHANNELS,
  MESSAGE_STATUSES,
  recipientName,
  type OutboxFilterValues,
} from '@/lib/messaging';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { listPagination } from '@/components/fees/fee-filters';
import { OutboxTable } from './outbox-table';
import { useMessageText } from './use-message-text';

const LIMIT = 50;

/**
 * Mensajería: la bandeja de salida con cada mail y WhatsApp, filtrable por estado y canal. Llega filtrada por
 * persona (`?personId=`) desde su ficha o por documento (`?relatedType=&relatedId=`) desde el diálogo de envío.
 */
export function OutboxCenter({ initialFilters = EMPTY_OUTBOX_FILTERS }: { initialFilters?: OutboxFilterValues }) {
  const t = useTranslations('messaging');
  const text = useMessageText();
  const canView = useCan('messaging.view');
  const canManage = useCan('messaging.manage');
  const list = usePaginatedList<OutboxItem, OutboxFilterValues>({
    key: 'outbox',
    path: '/outbox',
    limit: LIMIT,
    initialFilters,
  });

  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  const { filters } = list;
  let scope: string | null = null;
  if (filters.personId) {
    const name = recipientName(list.items);
    scope = name ? t('scope.person', { name }) : t('scope.personUnknown');
  } else if (filters.relatedType) {
    scope = t('scope.document', { document: text.related(filters.relatedType) });
  }
  const clearScope = () => {
    list.setFilter('personId', '');
    list.setFilter('relatedType', '');
    list.setFilter('relatedId', '');
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        {canManage && (
          <Link href="/configuracion/mensajeria" className="text-sm text-[var(--color-brand-600)] hover:underline">
            {t('settingsLink')}
          </Link>
        )}
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="outbox-status" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.status')}
          </label>
          <Select
            id="outbox-status"
            value={filters.status}
            onChange={(e) => list.setFilter('status', e.target.value)}
            className="w-44"
          >
            <option value="">{t('filters.all')}</option>
            {MESSAGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="outbox-channel" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.channel')}
          </label>
          <Select
            id="outbox-channel"
            value={filters.channel}
            onChange={(e) => list.setFilter('channel', e.target.value)}
            className="w-40"
          >
            <option value="">{t('filters.all')}</option>
            {MESSAGE_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {text.channel(c)}
              </option>
            ))}
          </Select>
        </div>
        {scope && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 py-1.5 text-sm">
            <span className="text-[var(--color-text)]">{scope}</span>
            <Button type="button" size="sm" variant="ghost" onClick={clearScope}>
              {t('scope.showAll')}
            </Button>
          </div>
        )}
      </div>

      <OutboxTable
        items={list.items}
        loading={list.isLoading}
        error={list.error}
        onChanged={() => void list.refetch()}
        pagination={listPagination(list)}
      />
    </div>
  );
}
