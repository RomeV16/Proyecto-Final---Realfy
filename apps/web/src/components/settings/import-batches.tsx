'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ImportRowAction, type ImportBatchCounts } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';

interface ImportBatch {
  id: string;
  kind: string;
  status: string;
  dryRun: boolean;
  atomic: boolean;
  counts: ImportBatchCounts | null;
  startedAt: string;
}

interface RowError {
  code: string;
  message: string;
  field?: string;
}

interface ImportRow {
  id: string;
  entity: string;
  externalRef: string | null;
  rowNumber: number;
  action: string;
  errors: RowError[] | null;
}

const ROW_LIMIT = 500;

function AdminOnlyNotice() {
  const t = useTranslations('importBatches');
  return <p className="text-sm text-slate-500">{t('adminOnly')}</p>;
}

function modeKey(batch: Pick<ImportBatch, 'dryRun' | 'atomic'>): 'dryRun' | 'atomic' | 'execute' {
  return batch.dryRun ? 'dryRun' : batch.atomic ? 'atomic' : 'execute';
}

/** Lotes de importación, del más reciente al más antiguo, con sus totales. */
export function ImportBatchList() {
  const t = useTranslations('importBatches');
  const canView = useCan('imports.manage');
  const query = useQuery({
    queryKey: ['import-batches', 'list'],
    queryFn: () => apiClient<ImportBatch[]>('/import/batches'),
    enabled: canView,
  });

  if (!canView) return <AdminOnlyNotice />;

  const columns: DataTableColumn<ImportBatch>[] = [
    {
      key: 'startedAt',
      header: t('columns.startedAt'),
      render: (b) => (
        <Link href={`/configuracion/importaciones/${b.id}`} className="font-medium text-brand-600 hover:text-brand-700">
          <DateText value={b.startedAt} kind="datetime" />
        </Link>
      ),
    },
    { key: 'kind', header: t('columns.kind'), render: (b) => b.kind },
    { key: 'mode', header: t('columns.mode'), render: (b) => t(`mode.${modeKey(b)}`) },
    { key: 'status', header: t('columns.status'), render: (b) => <StatusBadge domain="importacion" status={b.status} /> },
    { key: 'rows', header: t('columns.rows'), alignRight: true, render: (b) => b.counts?.total ?? 0 },
    {
      key: 'errors',
      header: t('columns.errors'),
      alignRight: true,
      render: (b) => (
        <span className={b.counts?.errors ? 'font-semibold text-red-700' : undefined}>{b.counts?.errors ?? 0}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('subtitle')}</p>
      </div>
      <DataTable
        columns={columns}
        items={query.data ?? []}
        keyExtractor={(b) => b.id}
        loading={query.isLoading}
        error={query.error}
        empty={{ title: t('empty.title'), subtitle: t('empty.subtitle'), iconName: 'import' }}
      />
    </div>
  );
}

/** Un lote: totales por entidad y el registro de sus filas, filtrable por acción. */
export function ImportBatchDetail({ id }: { id: string }) {
  const t = useTranslations('importBatches');
  const canView = useCan('imports.manage');
  const [action, setAction] = useState('');
  const [downloading, setDownloading] = useState(false);

  const batch = useQuery({
    queryKey: ['import-batches', id],
    queryFn: () => apiClient<ImportBatch>(`/import/batches/${id}`),
    enabled: canView,
  });
  const rows = useQuery({
    queryKey: ['import-batches', id, 'rows', action],
    queryFn: () =>
      apiClient<{ data: ImportRow[]; total: number }>(
        `/import/batches/${id}/rows?limit=${ROW_LIMIT}${action ? `&action=${action}` : ''}`,
      ),
    enabled: canView,
  });

  if (!canView) return <AdminOnlyNotice />;
  if (batch.error) return <ErrorNotice error={batch.error} fallback={t('loadError')} />;

  async function download() {
    setDownloading(true);
    try {
      await downloadFile(
        `/import/batches/${id}/rows/csv${action ? `?action=${action}` : ''}`,
        `importacion-${action ? action.toLowerCase() : 'filas'}.csv`,
        { preferServerName: true },
      );
    } catch {
      toast.error(t('detail.downloadFailed'));
    } finally {
      setDownloading(false);
    }
  }

  const columns: DataTableColumn<ImportRow>[] = [
    { key: 'entity', header: t('columns.entity'), render: (r) => t(`entities.${r.entity}`) },
    { key: 'row', header: t('columns.row'), alignRight: true, render: (r) => r.rowNumber },
    { key: 'externalRef', header: t('columns.externalRef'), render: (r) => r.externalRef ?? '—' },
    { key: 'action', header: t('columns.action'), render: (r) => <StatusBadge domain="importFila" status={r.action} /> },
    {
      key: 'detail',
      header: t('columns.detail'),
      render: (r) =>
        r.errors?.length ? (
          <ul className="space-y-1 text-sm">
            {r.errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-xs text-red-700">{e.code}</span>
                {e.field ? <span className="text-slate-500"> · {e.field}</span> : null}
                <span className="block text-slate-600">{e.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          '—'
        ),
    },
  ];

  const counts = batch.data?.counts;
  const shown = rows.data?.data.length ?? 0;
  const total = rows.data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/configuracion/importaciones" className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
          <Icon name="arrowLeft" className="h-4 w-4" />
          {t('back')}
        </Link>
        <h1 className="h1 mt-2">{t('detail.title')}</h1>
        {batch.data ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <StatusBadge domain="importacion" status={batch.data.status} />
            <span>{t(`mode.${modeKey(batch.data)}`)}</span>
            <DateText value={batch.data.startedAt} kind="datetime" />
          </div>
        ) : null}
        {batch.data?.dryRun ? <p className="mt-2 text-sm text-slate-500">{t('detail.dryRunNote')}</p> : null}
        {batch.data?.status === 'Fallido' && batch.data.atomic && !batch.data.dryRun ? (
          <p className="mt-2 text-sm text-red-700">{t('detail.rolledBack')}</p>
        ) : null}
      </div>

      {counts ? (
        <section aria-label={t('detail.summary')} className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('detail.summary')}</h2>
          <dl className="grid gap-4 sm:grid-cols-3">
            {Object.entries(counts.byEntity).map(([entity, byAction]) => (
              <div key={entity}>
                <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{t(`entities.${entity}`)}</dt>
                <dd className="mt-1 space-y-0.5 text-sm tabular-nums">
                  {Object.values(ImportRowAction).map((a) => (
                    <div key={a} className="flex justify-between gap-4">
                      <span>{t(`actions.${a}`)}</span>
                      <span className={a === ImportRowAction.Error && byAction[a] ? 'font-semibold text-red-700' : undefined}>
                        {byAction[a] ?? 0}
                      </span>
                    </div>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-sm text-slate-700">
          <span className="mb-1 block">{t('detail.filter')}</span>
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="min-w-48">
            <option value="">{t('detail.allActions')}</option>
            {Object.values(ImportRowAction).map((a) => (
              <option key={a} value={a}>
                {t(`actions.${a}`)}
              </option>
            ))}
          </Select>
        </label>
        <Button variant="secondary" size="sm" onClick={download} disabled={downloading}>
          <Icon name="download" className="mr-1.5 h-4 w-4" />
          {action === ImportRowAction.Error ? t('detail.downloadErrors') : t('detail.download')}
        </Button>
      </div>

      <DataTable
        columns={columns}
        items={rows.data?.data ?? []}
        keyExtractor={(r) => r.id}
        loading={rows.isLoading}
        error={rows.error}
        empty={{ title: t('detail.noRows'), iconName: 'import' }}
      />
      {total > shown ? (
        <p className="text-sm text-slate-500">{t('detail.showing', { shown, total })}</p>
      ) : null}
    </div>
  );
}
