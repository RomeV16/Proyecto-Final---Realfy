'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@/i18n/navigation';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { useCan } from '@/lib/permissions';
import { KEY_HOLDERS_OUT, holderLabel, placeOf, type KeyOut } from '@/lib/sales';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { Select } from '@/components/ui/select';
import { KeyCheckInDialog } from './key-dialogs';

const LIMIT = 50;
const EMPTY_FILTERS = { holder: '', overdue: '' };

/** "Llaves fuera": los juegos que no están en la oficina, quién los tiene desde cuándo y cuáles están atrasados. */
export function KeysOutList() {
  const t = useTranslations('keys');
  const canView = useCan('keys.view');
  const canManage = useCan('keys.manage');
  const queryClient = useQueryClient();
  const [returning, setReturning] = useState<KeyOut | null>(null);
  const list = usePaginatedList<KeyOut, typeof EMPTY_FILTERS>({ key: 'keys-out', path: '/keys/out', limit: LIMIT, initialFilters: EMPTY_FILTERS });

  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  const columns: DataTableColumn<KeyOut>[] = [
    {
      key: 'property',
      header: t('out.columns.property'),
      render: (m) => (
        <div>
          <Link href={`/properties/${m.keySet.propertyId}`} className="font-medium text-[var(--color-text)] underline-offset-2 hover:underline">
            {placeOf(m.keySet.property)}
          </Link>
          <p className="text-xs text-[var(--color-muted)]">{m.keySet.label}</p>
        </div>
      ),
    },
    {
      key: 'holder',
      header: t('out.columns.holder'),
      render: (m) => (
        <div>
          <p className="text-[var(--color-text)]">{holderLabel(m)}</p>
          <p className="text-xs text-[var(--color-muted)]">{t(`holders.${m.holder}`)}</p>
        </div>
      ),
    },
    { key: 'reason', header: t('out.columns.reason'), render: (m) => m.reason ?? '—' },
    { key: 'outAt', header: t('out.columns.outAt'), render: (m) => <DateText value={m.outAt} /> },
    {
      key: 'expected',
      header: t('out.columns.expected'),
      render: (m) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {m.expectedReturnAt ? <DateText value={m.expectedReturnAt} /> : '—'}
          {m.overdue && <Badge variant="danger" size="sm">{t('card.overdue', { days: m.daysOverdue })}</Badge>}
        </div>
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: t('out.columns.actions'),
            render: (m: KeyOut) => (
              <Button type="button" size="sm" variant="secondary" onClick={() => setReturning(m)}>
                {t('card.checkIn')}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t('out.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('out.subtitle')}</p>
      </header>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="keys-holder" className="text-xs font-medium text-[var(--color-muted)]">
            {t('out.filters.holder')}
          </label>
          <Select id="keys-holder" value={list.filters.holder} onChange={(e) => list.setFilter('holder', e.target.value)} className="w-48">
            <option value="">{t('out.filters.all')}</option>
            {KEY_HOLDERS_OUT.map((h) => (
              <option key={h} value={h}>
                {t(`holders.${h}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="keys-overdue" className="text-xs font-medium text-[var(--color-muted)]">
            {t('out.filters.overdue')}
          </label>
          <Select id="keys-overdue" value={list.filters.overdue} onChange={(e) => list.setFilter('overdue', e.target.value)} className="w-48">
            <option value="">{t('out.filters.all')}</option>
            <option value="true">{t('out.filters.overdueOnly')}</option>
          </Select>
        </div>
      </div>
      <DataTable
        items={list.items}
        columns={columns}
        keyExtractor={(m) => m.id}
        loading={list.isLoading}
        error={list.error}
        pagination={
          list.totalPages > 1
            ? { page: list.page, totalPages: list.totalPages, total: list.total, limit: list.limit, onPageChange: list.setPage }
            : undefined
        }
        empty={{ title: t('out.empty'), subtitle: t('out.emptySubtitle'), iconName: 'properties' }}
      />
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
