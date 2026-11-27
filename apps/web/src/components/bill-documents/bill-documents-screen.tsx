'use client';

import { useTranslations } from 'next-intl';
import { BILL_AUTO_CONFIDENCE, BillChannel, BillDocumentStatus } from '@realfy/shared';
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
import { cn } from '@/lib/cn';
import { DateText } from '@/components/ui/date-text';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Icon, type IconName } from '@/components/ui/icon';
import { PaginationBar } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
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

const CHANNEL_ICON: Record<string, IconName> = {
  [BillChannel.Mail]: 'mail',
  [BillChannel.Archivo]: 'import',
  [BillChannel.Consulta]: 'refresh',
  [BillChannel.Portal]: 'externalLink',
};

/** Tono de la barra: verde desde la confianza con la que la boleta se carga sola, rojo cuando la lectura es dudosa. */
export function confidenceTone(confidence: string | null): 'success' | 'warning' | 'danger' {
  const value = Number(confidence);
  if (value >= BILL_AUTO_CONFIDENCE) return 'success';
  return value >= 0.6 ? 'warning' : 'danger';
}

const TONE_CLASS = {
  success: 'bg-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger)]',
} as const;

/** Qué tan segura fue la lectura automática: una barra con el porcentaje al lado. */
export function ConfidenceMeter({ confidence }: { confidence: string | null }) {
  const t = useTranslations('billDocuments');
  const pct = confidencePercent(confidence);
  if (pct === null) return null;
  const tone = TONE_CLASS[confidenceTone(confidence)];
  return (
    <span className="inline-flex items-center gap-1.5" title={t('confidenceLabel', { pct })}>
      <span className="sr-only">{t('confidenceLabel', { pct })}</span>
      <span aria-hidden="true" className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </span>
      <span aria-hidden="true" className="font-mono text-xs tabular-nums text-[var(--color-muted)]">
        {pct} %
      </span>
    </span>
  );
}

/** Un documento en la bandeja: de quién es, qué archivo trajo, por qué espera y cuándo llegó. */
function InboxItem({ doc }: { doc: BillDocumentRow }) {
  const t = useTranslations('billDocuments');
  const waiting = doc.status === BillDocumentStatus.RequiereRevision;
  return (
    <li>
      <Link
        href={`/boletas/recibidas/${doc.id}`}
        className={cn(
          'grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-[var(--color-surface-sunken)]',
          'sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start',
          waiting && 'bg-[color-mix(in_oklab,var(--color-warning)_5%,var(--color-surface))]',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] text-[var(--color-muted)]',
            waiting && 'border-[color-mix(in_oklab,var(--color-warning)_45%,var(--color-border))] text-[var(--color-text)]',
          )}
          title={t(`channels.${doc.channel as BillChannel}`)}
        >
          <Icon name={CHANNEL_ICON[doc.channel] ?? 'invoices'} className="h-4 w-4" aria-hidden="true" />
        </span>

        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className={cn('text-sm text-[var(--color-text)]', waiting ? 'font-semibold' : 'font-medium')}>
              {doc.providerKey ? <ProviderText providerKey={doc.providerKey} /> : t('unknownProvider')}
            </span>
            <span className="text-xs text-[var(--color-muted)]">
              {t(`channels.${doc.channel as BillChannel}`)}
              {doc.accountNumber ? ` · ${t('accountShort', { account: doc.accountNumber })}` : ''}
            </span>
          </span>
          <span className="block truncate text-sm text-brand-600">{doc.fileName ?? doc.origin ?? t('noDocumentName')}</span>
          {doc.reason && (
            <span className="block text-xs text-[var(--color-muted)]">
              <ReasonText reason={doc.reason} />
            </span>
          )}
        </span>

        <span className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-start-3 sm:flex-col sm:items-end sm:gap-y-1.5">
          <DateText value={doc.createdAt} kind="datetime" className="text-xs tabular-nums text-[var(--color-muted)]" />
          <span className="flex flex-wrap items-center gap-2">
            <ConfidenceMeter confidence={doc.confidence} />
            <StatusBadge domain="boletaRecibida" status={doc.status} />
          </span>
          {doc._count.bills > 0 && (
            <span className="text-xs text-[var(--color-muted)]">{t('billsCount', { count: doc._count.bills })}</span>
          )}
        </span>
      </Link>
    </li>
  );
}

/**
 * Boletas recibidas: una bandeja con lo que llegó (por archivo, mail o consulta), qué tan bien se leyó y qué espera
 * revisión, y al costado la subida de PDF. Por defecto muestra lo que espera revisión, que es el trabajo pendiente.
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="h1">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </header>

      <div className={cn('grid grid-cols-1 gap-6', canUpload && 'xl:grid-cols-[minmax(0,1fr)_22rem]')}>
        <section aria-label={t('inbox.label')} className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <FormField label={t('filters.status')} className="w-full sm:w-52">
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
            <FormField label={t('filters.channel')} className="w-full sm:w-52">
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
            {!list.isLoading && list.error == null && list.total > 0 && (
              <p className="pb-3 text-sm text-[var(--color-muted)] sm:ml-auto">{t('inbox.count', { count: list.total })}</p>
            )}
          </div>

          {list.isLoading && <Skeleton className="h-56 w-full" />}
          {!list.isLoading && list.error != null && <ErrorNotice error={list.error} fallback={t('loadError')} />}
          {!list.isLoading && list.error == null && list.items.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--color-border)]">
              <EmptyState
                iconName="inbox"
                variant={list.hasFilters ? 'filtered' : 'default'}
                title={list.hasFilters ? t('empty.filtered') : t('empty.title')}
                subtitle={list.hasFilters ? t('empty.filteredHint') : t('empty.subtitle')}
              />
            </div>
          )}
          {!list.isLoading && list.error == null && list.items.length > 0 && (
            <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              {list.items.map((doc) => (
                <InboxItem key={doc.id} doc={doc} />
              ))}
            </ul>
          )}
          <PaginationBar
            page={list.page}
            totalPages={list.totalPages}
            total={list.total}
            limit={list.limit}
            onPageChange={list.setPage}
          />
        </section>

        {canUpload && (
          <aside className="min-w-0">
            <UploadPanel onUploaded={() => void list.refetch()} />
          </aside>
        )}
      </div>
    </div>
  );
}
