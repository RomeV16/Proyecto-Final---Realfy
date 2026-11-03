'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { jobPersonName, type InvoiceJob, type PendingPage, type RunSummary } from '@/lib/lessor-invoicing';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { useErrorText } from '@/components/cash/use-cash-data';

const LIMIT = 20;
const ALL = '';

/**
 * Cola de facturación por cuenta del locador: lo pendiente y lo que falló (por ejemplo, ARCA no
 * respondió). "Emitir pendientes" pone en cola lo automático y emite todo; un fallo no afecta al cobro.
 */
export function PendingLessorInvoices() {
  const t = useTranslations('lessorInvoicing');
  const errorText = useErrorText();
  const canView = useCan('lessorInvoicing.view');
  const canEmit = useCan('lessorInvoicing.emit');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(ALL);
  const [data, setData] = useState<PendingPage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (status !== ALL) query.set('status', status);
      setData(await apiClient<PendingPage>(`/invoices/pending?${query.toString()}`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [page, status]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load, version]);

  if (!canView) return <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>;

  async function runAll() {
    setBusy(true);
    try {
      const out = await apiClient<RunSummary>('/invoices/pending/run', { method: 'POST', body: JSON.stringify({ retryAll: true }) });
      toast.success(t('pending.ran', { emitted: out.emitted, failed: out.failed }));
    } catch (err) {
      toast.error(errorText(err, t('pending.runError')));
    } finally {
      setBusy(false);
      setVersion((v) => v + 1);
    }
  }

  const columns: DataTableColumn<InvoiceJob>[] = [
    { key: 'person', header: t('pending.columns.person'), render: (j) => jobPersonName(j) },
    {
      key: 'source',
      header: t('pending.columns.source'),
      render: (j) =>
        j.sourceType === 'OwnerStatement' ? (
          <Link href={`/estados-de-cuenta/${j.sourceId}`} className="text-[var(--color-brand-600)] hover:underline">
            {t('sources.OwnerStatement')}
          </Link>
        ) : (
          t('sources.Payment')
        ),
    },
    { key: 'kind', header: t('pending.columns.kind'), render: (j) => t(`kinds.${j.kind}`) },
    { key: 'status', header: t('pending.columns.status'), render: (j) => <StatusBadge domain="facturaLocador" status={j.status} /> },
    { key: 'attempts', header: t('pending.columns.attempts'), alignRight: true, render: (j) => j.attempts },
    {
      key: 'error',
      header: t('pending.columns.error'),
      render: (j) => (j.lastError ? <span className="text-xs text-[var(--color-danger)]">{j.lastError}</span> : '—'),
    },
    { key: 'createdAt', header: t('pending.columns.createdAt'), render: (j) => formatDate(j.createdAt) },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="h1">{t('pending.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{t('pending.subtitle')}</p>
        </div>
        {canEmit && (
          <Button type="button" disabled={busy} onClick={() => void runAll()}>
            {busy ? t('pending.running') : t('pending.run')}
          </Button>
        )}
      </header>
      <div className="max-w-xs">
        <label className="mb-1 block text-sm text-[var(--color-muted)]" htmlFor="pending-status">
          {t('pending.filter')}
        </label>
        <Select
          id="pending-status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value={ALL}>{t('pending.open')}</option>
          {['Pendiente', 'Fallido', 'Emitido', 'Omitido'].map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        items={data?.items ?? []}
        columns={columns}
        keyExtractor={(j) => j.id}
        loading={data === null && error == null}
        error={data === null ? error : undefined}
        empty={{ iconName: 'invoices', title: t('pending.empty'), subtitle: t('pending.emptySubtitle') }}
        pagination={
          data
            ? { page: data.page, totalPages: data.totalPages, total: data.total, limit: data.limit, onPageChange: setPage }
            : undefined
        }
      />
    </div>
  );
}
