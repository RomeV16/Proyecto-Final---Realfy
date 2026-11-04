'use client';

import { useTranslations } from 'next-intl';
import { BillChannel, BillDocumentStatus } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import {
  BILL_DOCUMENTS_PATH,
  confidencePercent,
  providerMessageKey,
  reasonMessageKey,
  type BillDocumentRow,
} from '@/lib/bill-documents';
import { useCan } from '@/lib/permissions';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { UploadPanel } from './upload-panel';

const LIMIT = 30;
const INITIAL_FILTERS = { status: BillDocumentStatus.RequiereRevision as string, channel: '' };

/** El motivo legible de un documento: el código traducido o, en un rechazo, el texto que escribió quien lo rechazó. */
export function ReasonText({ reason }: { reason: string | null }) {
  const t = useTranslations('billDocuments');
  if (!reason) return <span className="text-[var(--color-muted)]">—</span>;
  const key = reasonMessageKey(reason);
  return <span>{key ? t(key) : reason}</span>;
}

/** El proveedor del catálogo con su nombre, o la clave si no es uno conocido. */
export function ProviderText({ providerKey }: { providerKey: string | null }) {
  const t = useTranslations('billDocuments');
  if (!providerKey) return <span className="text-[var(--color-muted)]">—</span>;
  const key = providerMessageKey(providerKey);
  return <span>{key ? t(key) : providerKey}</span>;
}

/**
 * Boletas recibidas: subida de PDF y lista de documentos con filtros por estado y canal. Por defecto muestra lo que
 * espera revisión, que es el trabajo pendiente.
 */
export function BillDocumentsScreen() {
  const t = useTranslations('billDocuments');
  const canView = useCan('billDocuments.view');
  const canUpload = useCan('serviceBills.manage');
  const list = usePaginatedList<BillDocumentRow, typeof INITIAL_FILTERS>({
    key: 'bill-documents',
    path: BILL_DOCUMENTS_PATH,
    limit: LIMIT,
    initialFilters: INITIAL_FILTERS,
    enabled: canView,
  });

  if (!canView) return <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>;

  const columns: DataTableColumn<BillDocumentRow>[] = [
    {
      key: 'received',
      header: t('columns.received'),
      render: (d) => <DateText value={d.createdAt} kind="datetime" />,
    },
    {
      key: 'document',
      header: t('columns.document'),
      render: (d) => (
        <Link href={`/boletas/recibidas/${d.id}`} className="font-medium text-brand-600 hover:text-brand-700">
          {d.fileName ?? d.origin ?? t('noDocumentName')}
        </Link>
      ),
    },
    { key: 'channel', header: t('columns.channel'), render: (d) => t(`channels.${d.channel as BillChannel}`) },
    { key: 'provider', header: t('columns.provider'), render: (d) => <ProviderText providerKey={d.providerKey} /> },
    { key: 'account', header: t('columns.account'), render: (d) => d.accountNumber ?? '—' },
    {
      key: 'status',
      header: t('columns.status'),
      render: (d) => {
        const pct = confidencePercent(d.confidence);
        return (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge domain="boletaRecibida" status={d.status} />
            {pct !== null && <span className="text-xs tabular-nums text-[var(--color-muted)]">{pct} %</span>}
          </span>
        );
      },
    },
    { key: 'reason', header: t('columns.reason'), render: (d) => <ReasonText reason={d.reason} /> },
    {
      key: 'bills',
      header: t('columns.bills'),
      alignRight: true,
      render: (d) =>
        d._count.bills > 0 ? (
          <Link href={`/boletas/recibidas/${d.id}`} className="text-brand-600 hover:text-brand-700">
            {t('billsCount', { count: d._count.bills })}
          </Link>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="h1">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </header>

      {canUpload && <UploadPanel onUploaded={() => void list.refetch()} />}

      <div className="flex flex-wrap gap-4">
        <FormField label={t('filters.status')} className="w-56">
          {(c) => (
            <Select {...c} value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
              <option value="">{t('filters.allStatuses')}</option>
              {Object.values(BillDocumentStatus).map((status) => (
                <option key={status} value={status}>
                  {t(`statuses.${status}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t('filters.channel')} className="w-56">
          {(c) => (
            <Select {...c} value={list.filters.channel} onChange={(e) => list.setFilter('channel', e.target.value)}>
              <option value="">{t('filters.allChannels')}</option>
              {Object.values(BillChannel).map((channel) => (
                <option key={channel} value={channel}>
                  {t(`channels.${channel}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <DataTable
        columns={columns}
        items={list.items}
        keyExtractor={(d) => d.id}
        loading={list.isLoading}
        error={list.error}
        empty={{
          title: list.hasFilters ? t('empty.filtered') : t('empty.title'),
          subtitle: list.hasFilters ? undefined : t('empty.subtitle'),
          iconName: 'invoices',
        }}
        pagination={{ page: list.page, totalPages: list.totalPages, total: list.total, limit: list.limit, onPageChange: list.setPage }}
      />
    </div>
  );
}
