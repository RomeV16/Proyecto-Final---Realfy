'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Paged, ReceiptRow } from '@/lib/cash';
import { apiClient } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { inputStyles } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { SendDocument } from '@/components/messaging/send-document';
import { printReceipt } from './print-receipt';

const LIMIT = 50;

/** Recibos de cobro numerados, para consultar, reimprimir y mandar a quien pagó. */
export function ReceiptsPanel() {
  const t = useTranslations('cash');
  const tMethods = useTranslations('liquidaciones.paymentMethods');
  const tCommon = useTranslations('common');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<ReceiptRow> | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      setData(await apiClient<Paged<ReceiptRow>>(`/receipts?${params.toString()}`));
    } catch (err) {
      setError(err);
      setData(null);
    }
  }, [from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: DataTableColumn<ReceiptRow>[] = [
    { key: 'number', header: t('receipts.columns.number'), render: (r) => <span className="font-mono">{r.number}</span> },
    { key: 'date', header: t('receipts.columns.date'), render: (r) => <DateText value={r.issuedAt} kind="instant" /> },
    { key: 'tenant', header: t('receipts.columns.tenant'), render: (r) => r.tenantName ?? '—' },
    { key: 'property', header: t('receipts.columns.property'), render: (r) => r.property ?? '—' },
    {
      key: 'amount',
      header: t('receipts.columns.amount'),
      alignRight: true,
      render: (r) => <MoneyText value={r.amount} currency={r.currency} decimals={2} className="tabular-nums" />,
    },
    {
      key: 'method',
      header: t('receipts.columns.method'),
      render: (r) => (r.method && tMethods.has(r.method) ? tMethods(r.method) : (r.method ?? '—')),
    },
    {
      key: 'receivedBy',
      header: t('receipts.columns.receivedBy'),
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>{r.receivedBy ? t(`receivers.${r.receivedBy}`) : '—'}</span>
          {r.receivedByName && <span className="text-xs text-[var(--color-muted)]">({r.receivedByName})</span>}
          {r.inCustody && <Badge variant="warning">{t('receipts.inCustody')}</Badge>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: t('receipts.columns.actions'),
      render: (r) => (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => void printReceipt(r.id, r.number, tCommon('downloadFailed'))}>
            {t('receipts.print')}
          </Button>
          <SendDocument kind="Receipt" id={r.id} />
        </div>
      ),
    },
  ];

  return (
    <section className="space-y-5" aria-labelledby="cash-receipts-title">
      <div>
        <h2 id="cash-receipts-title" className="text-base font-semibold text-[var(--color-text)]">
          {t('receipts.title')}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('receipts.subtitle')}</p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="cash-receipts-from" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.from')}
          </label>
          <input
            id="cash-receipts-from"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className={inputStyles({ className: 'w-40' })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cash-receipts-to" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.to')}
          </label>
          <input
            id="cash-receipts-to"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className={inputStyles({ className: 'w-40' })}
          />
        </div>
      </div>
      <DataTable
        items={data?.items ?? []}
        columns={columns}
        keyExtractor={(r) => r.id}
        loading={data === null && error == null}
        error={error}
        pagination={
          data && data.totalPages > 1
            ? { page: data.page, totalPages: data.totalPages, total: data.total, limit: data.limit, onPageChange: setPage }
            : undefined
        }
        empty={{ title: t('receipts.empty.title'), subtitle: t('receipts.empty.subtitle'), iconName: 'invoices' }}
      />
    </section>
  );
}
