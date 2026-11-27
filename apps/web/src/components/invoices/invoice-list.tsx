'use client';

import { useLocale, useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';
import { toast } from '@/lib/toast';
import { ComprobanteType } from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { Link } from '@/i18n/navigation';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatLocalDate, formatMoneyFixed } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { TestingNotice, useArcaEnvironment } from './arca-environment';
import {
  formatDocNumber,
  isCreditNote,
  signedTotal,
  voucherNumber,
  voucherState,
  type Voucher,
  type VoucherState,
} from './voucher';

interface PaginatedResponse {
  items: Voucher[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Filters {
  type: string;
  page: number;
}

const INITIAL_FILTERS: Filters = { type: '', page: 1 };
const LIMIT = 20;

const STATE_TONE: Record<VoucherState, BadgeVariant> = {
  authorized: 'success',
  credited: 'neutral',
  pending: 'warning',
};

const TH = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]';
const TD = 'px-4 py-3 align-top';
const MONO = 'font-mono tabular-nums';

/** Libro de comprobantes emitidos: una fila fiscal por comprobante, con su CAE y su estado ante ARCA. */
export function InvoiceList() {
  const t = useTranslations('invoices');
  const tCommon = useTranslations('common');
  const tTable = useTranslations('invoices.table');
  const tTypeNames = useTranslations('invoices.typesLong');
  const tTypes = (type: string) => (tTypeNames.has(type) ? tTypeNames(type) : type);
  const tFilters = useTranslations('invoices.filters');
  const tEmpty = useTranslations('invoices.empty');
  const tPag = useTranslations('invoices.pagination');
  const tState = useTranslations('invoices.arcaStates');
  const locale = useLocale();
  const canEmit = useCan('invoices.emit');
  const environment = useArcaEnvironment();

  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.type) params.set('type', filters.type);
      params.set('page', String(filters.page));
      params.set('limit', String(LIMIT));
      setData(await apiClient<PaginatedResponse>(`/invoices?${params.toString()}`));
      setError(null);
    } catch (err) {
      setData(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const pageTotal = items.reduce((sum, item) => sum + signedTotal(item), 0);

  async function handleDownloadPdf(id: string) {
    try {
      await downloadFile(`/invoices/${id}/pdf`, `comprobante-${id}.pdf`);
    } catch {
      toast.error(tCommon('downloadFailed'));
    }
  }

  const money = (item: Voucher) => formatMoneyFixed(signedTotal(item), item.currency ?? 'ARS', locale);
  const stateBadge = (item: Voucher) => {
    const state = voucherState(item);
    return (
      <Badge variant={STATE_TONE[state]} dot>
        {tState(state)}
      </Badge>
    );
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/invoices/pending"
            className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-sunken)]"
          >
            {t('pendingLink')}
          </Link>
          {canEmit && (
            <Link
              href="/invoices/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-brand-500 bg-brand-500 px-3.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
            >
              <Icon name="plus" className="h-4 w-4" />
              {t('newInvoiceBtn')}
            </Link>
          )}
        </div>
      </header>

      <TestingNotice environment={environment} />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          aria-label={tFilters('type')}
          value={filters.type}
          onChange={(e) => setFilters({ type: e.target.value, page: 1 })}
          className="w-56"
        >
          <option value="">{tFilters('typePlaceholder')}</option>
          {Object.values(ComprobanteType).map((ct) => (
            <option key={ct} value={ct}>
              {tTypes(ct)}
            </option>
          ))}
        </Select>
        {filters.type && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(INITIAL_FILTERS)}>
            {tFilters('clear')}
          </Button>
        )}
      </div>

      {loading && <Skeleton className="h-56 w-full" />}
      {!loading && error != null && <ErrorNotice error={error} fallback={t('errors.loadFailed')} />}
      {!loading && error == null && items.length === 0 && (
        <EmptyState
          iconName="invoices"
          variant={filters.type ? 'filtered' : 'default'}
          title={filters.type ? tEmpty('filtered') : tEmpty('title')}
          subtitle={filters.type ? undefined : tEmpty('subtitle')}
        />
      )}

      {!loading && items.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {/* Escritorio: tabla fiscal */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
                <tr>
                  <th scope="col" className={TH}>{tTable('comprobante')}</th>
                  <th scope="col" className={TH}>{tTable('fecha')}</th>
                  <th scope="col" className={TH}>{tTable('receptor')}</th>
                  <th scope="col" className={TH}>{tTable('cae')}</th>
                  <th scope="col" className={`${TH} text-right`}>{tTable('importe')}</th>
                  <th scope="col" className={TH}>{tTable('estado')}</th>
                  <th scope="col" className={`${TH} text-right`}>
                    <span className="sr-only">{tTable('actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {items.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-[var(--color-surface-sunken)]">
                    <td className={TD}>
                      <Link href={`/invoices/${item.id}`} className="group block">
                        <span className="block text-xs text-[var(--color-muted)]">{tTypes(item.type)}</span>
                        <span className={`${MONO} font-medium text-[var(--color-text)] group-hover:text-brand-600`}>
                          {voucherNumber(item)}
                        </span>
                      </Link>
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums text-[var(--color-text)]`}>
                      {formatLocalDate(item.emittedAt ?? item.createdAt, 'numeric', locale)}
                    </td>
                    <td className={TD}>
                      <span className="block max-w-[16rem] truncate text-[var(--color-text)]">
                        {item.receptorName || tTable('noReceptor')}
                      </span>
                      {item.docNro && (
                        <span className={`${MONO} text-xs text-[var(--color-muted)]`}>{formatDocNumber(item.docNro)}</span>
                      )}
                    </td>
                    <td className={TD}>
                      {item.cae ? (
                        <>
                          <span className={`${MONO} block text-[var(--color-text)]`}>{item.cae}</span>
                          {item.caeFchVto && (
                            <span className="text-xs text-[var(--color-muted)]">
                              {tTable('caeDue', { date: formatDate(item.caeFchVto, 'numeric', locale) })}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-[var(--color-muted)]">{tTable('noCae')}</span>
                      )}
                    </td>
                    <td
                      className={`${TD} ${MONO} whitespace-nowrap text-right font-medium ${
                        isCreditNote(item.type) ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]'
                      }`}
                    >
                      {money(item)}
                    </td>
                    <td className={TD}>{stateBadge(item)}</td>
                    <td className={`${TD} text-right`}>
                      <button
                        type="button"
                        onClick={() => void handleDownloadPdf(item.id)}
                        title={tTable('pdf')}
                        aria-label={tTable('pdfOf', { number: voucherNumber(item) })}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-brand-600"
                      >
                        <Icon name="download" className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
                <tr>
                  <td colSpan={4} className="px-4 py-2.5 text-xs text-[var(--color-muted)]">
                    {tTable('pageCount', { count: items.length })}
                  </td>
                  <td className={`${MONO} whitespace-nowrap px-4 py-2.5 text-right font-semibold text-[var(--color-text)]`}>
                    {formatMoneyFixed(pageTotal, items[0]?.currency ?? 'ARS', locale)}
                  </td>
                  <td colSpan={2} className="px-4 py-2.5 text-xs text-[var(--color-muted)]">
                    {tTable('pageTotal')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Móvil: el mismo renglón fiscal, apilado */}
          <ul className="divide-y divide-[var(--color-border)] md:hidden">
            {items.map((item) => (
              <li key={item.id} className="space-y-1.5 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/invoices/${item.id}`} className="min-w-0">
                    <span className="block text-xs text-[var(--color-muted)]">{tTypes(item.type)}</span>
                    <span className={`${MONO} text-sm font-medium text-[var(--color-text)]`}>{voucherNumber(item)}</span>
                  </Link>
                  <span
                    className={`${MONO} shrink-0 text-sm font-semibold ${
                      isCreditNote(item.type) ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]'
                    }`}
                  >
                    {money(item)}
                  </span>
                </div>
                <p className="truncate text-sm text-[var(--color-text)]">
                  {item.receptorName || tTable('noReceptor')}
                  <span className="text-[var(--color-muted)]">
                    {' · '}
                    {formatLocalDate(item.emittedAt ?? item.createdAt, 'numeric', locale)}
                  </span>
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`${MONO} text-xs text-[var(--color-muted)]`}>{item.cae ? `CAE ${item.cae}` : ''}</span>
                  <span className="flex items-center gap-2">
                    {stateBadge(item)}
                    <button
                      type="button"
                      onClick={() => void handleDownloadPdf(item.id)}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text)]"
                    >
                      <Icon name="download" className="h-3.5 w-3.5" />
                      {tTable('pdf')}
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--color-muted)]">
            {tPag('showing', {
              from: (filters.page - 1) * LIMIT + 1,
              to: Math.min(filters.page * LIMIT, data?.total ?? 0),
              total: data?.total ?? 0,
            })}
          </span>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={filters.page <= 1}
              onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
            >
              {tPag('prev')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={filters.page >= totalPages}
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
            >
              {tPag('next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
