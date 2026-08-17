'use client';

import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { ComprobanteType } from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ResponsiveTable, Column } from '@/components/ui/responsive-table';
import { EntityRow } from '@/components/ui/entity-card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';

/* ──────────── Types ──────────── */

interface ComprobanteItem {
  id: string;
  type: string;
  puntoDeVenta: number;
  numero: number;
  comprobanteNumber?: number;
  receptorName?: string;
  receptorCuit?: string;
  amount?: string | number;
  impTotal?: string | number;
  currency?: string;
  cae?: string;
  createdAt: string;
}

interface PaginatedResponse {
  items: ComprobanteItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ──────────── Helpers ──────────── */

function formatCompNumber(pdv: number, num: number): string {
  return `${String(pdv).padStart(4, '0')}-${String(num).padStart(8, '0')}`;
}

function formatCurrency(amount: string | number | undefined): string {
  if (amount == null) return '—';
  return '$ ' + Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/** Comprobante type → badge tone. Credit/debit notes read as adjustments, so
 * they get the danger/warning tones; regular invoices stay brand-neutral. */
function invoiceTypeVariant(type: string): 'brand' | 'danger' | 'warning' {
  if (type.startsWith('NotaCredito')) return 'danger';
  if (type.startsWith('NotaDebito')) return 'warning';
  return 'brand';
}

/* ──────────── Filters ──────────── */

interface Filters {
  type: string;
  page: number;
}

const INITIAL_FILTERS: Filters = { type: '', page: 1 };
const LIMIT = 20;

/* ──────────── Component ──────────── */

export function InvoiceList() {
  const t = useTranslations('invoices');
  const tTable = useTranslations('invoices.table');
  const tTypes = useTranslations('invoices.types');
  const tFilters = useTranslations('invoices.filters');
  const tEmpty = useTranslations('invoices.empty');
  const tPag = useTranslations('invoices.pagination');

  const pathname = usePathname();
  const router = useRouter();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.type) params.set('type', filters.type);
      params.set('page', String(filters.page));
      params.set('limit', String(LIMIT));
      const qs = params.toString();
      const res = await apiClient<PaginatedResponse>(`/invoices?${qs}`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const items = data?.items || [];
  const totalPages = data?.totalPages || 1;

  async function handleDownloadPdf(id: string) {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/invoices/${id}/pdf`,
        { credentials: 'include' as RequestCredentials },
      );
      if (!response.ok) throw new Error('PDF download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comprobante-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Silent fail for now
    }
  }

  // NC types for filter grouping
  const ncTypes = [ComprobanteType.NotaCreditoA, ComprobanteType.NotaCreditoB, ComprobanteType.NotaCreditoC];

  const columns: Column<ComprobanteItem>[] = [
    {
      key: 'fecha',
      header: tTable('fecha'),
      render: (item) => <span className="text-slate-600">{formatDate(item.createdAt)}</span>,
    },
    {
      key: 'tipo',
      header: tTable('tipo'),
      render: (item) => <Badge variant={invoiceTypeVariant(item.type)}>{tTypes(item.type)}</Badge>,
    },
    {
      key: 'numero',
      header: tTable('numero'),
      render: (item) => (
        <span className="font-mono text-slate-700 tabular-nums">
          {formatCompNumber(item.puntoDeVenta, item.numero ?? item.comprobanteNumber ?? 0)}
        </span>
      ),
    },
    {
      key: 'receptor',
      header: tTable('receptor'),
      render: (item) => <span className="text-slate-700 max-w-[200px] truncate block">{item.receptorName || '—'}</span>,
    },
    {
      key: 'importe',
      header: tTable('importe'),
      alignRight: true,
      render: (item) => (
        <span className="font-semibold tabular-nums text-slate-900">
          {ncTypes.includes(item.type as ComprobanteType) ? '- ' : ''}{formatCurrency(item.impTotal ?? item.amount)}
        </span>
      ),
    },
    {
      key: 'cae',
      header: tTable('cae'),
      render: (item) =>
        item.cae ? (
          <Badge variant="success" dot className="font-mono tabular-nums">
            {item.cae}
          </Badge>
        ) : (
          <Badge variant="warning" dot>
            {tTable('caePending')}
          </Badge>
        ),
    },
    {
      key: 'actions',
      header: tTable('actions'),
      alignRight: true,
      render: (item) => (
        <div className="flex items-center justify-end gap-1">
          <Link
            href={`${localePrefix}/invoices/${item.id}`}
            className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
            title={tTable('view')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          </Link>
          <button
            onClick={() => handleDownloadPdf(item.id)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
            title={tTable('pdf')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(`${localePrefix}/invoices/new`)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t('newInvoiceBtn')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={filters.type}
          onChange={(e) => setFilters({ ...filters, type: e.target.value, page: 1 })}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        >
          <option value="">{tFilters('typePlaceholder')}</option>
          {Object.values(ComprobanteType).map((ct) => (
            <option key={ct} value={ct}>{tTypes(ct)}</option>
          ))}
        </select>

        {filters.type && (
          <button
            onClick={() => setFilters(INITIAL_FILTERS)}
            className="text-xs text-brand-600 hover:text-brand-700"
          >
            {tFilters('clear')}
          </button>
        )}
      </div>

      {/* Responsive table */}
      <ResponsiveTable<ComprobanteItem>
        items={items}
        columns={columns}
        keyExtractor={(item) => item.id}
        loading={loading}
        skeletonRows={5}
        empty={{
          title: filters.type ? tEmpty('filtered') : tEmpty('title'),
          subtitle: tEmpty('subtitle'),
          iconName: 'invoices',
        }}
        cardRenderer={(item) => {
          const isCredit = ncTypes.includes(item.type as ComprobanteType);
          const amountLabel = `${isCredit ? '- ' : ''}${formatCurrency(item.impTotal ?? item.amount)}`;
          const displayTitle = item.receptorName || tTypes(item.type);
          const href = `${localePrefix}/invoices/${item.id}`;

          return (
            <EntityRow
              href={href}
              label={displayTitle}
              accent={invoiceTypeVariant(item.type)}
              leading={<Avatar name={displayTitle} seed={item.id} size="sm" />}
              title={displayTitle}
              subtitle={formatCompNumber(item.puntoDeVenta, item.numero ?? item.comprobanteNumber ?? 0)}
              meta={
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <EntityRow.Meta items={[{ icon: 'calendar', label: formatDate(item.createdAt) }]} />
                  <span
                    className={`text-sm font-bold tabular-nums sm:hidden ${
                      isCredit ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]'
                    }`}
                  >
                    {amountLabel}
                  </span>
                </div>
              }
              trailing={<EntityRow.Amount value={amountLabel} tone={isCredit ? 'danger' : 'default'} />}
              alert={
                !item.cae ? (
                  <EntityRow.Alert tone="warning" icon="alert">
                    {tTable('caePending')}
                  </EntityRow.Alert>
                ) : undefined
              }
              actions={
                <>
                  <EntityRow.Action href={href} icon="view" variant="quiet">
                    {tTable('view')}
                  </EntityRow.Action>
                  <EntityRow.Action
                    onClick={(e) => { e.preventDefault(); handleDownloadPdf(item.id); }}
                    icon="download"
                    variant="quiet"
                  >
                    {tTable('pdf')}
                  </EntityRow.Action>
                </>
              }
            />
          );
        }}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-slate-200 sm:rounded-none sm:border-x-0 sm:border-b-0 sm:border-t sm:border-slate-100">
          <span className="text-xs text-slate-500">
            {tPag('showing', {
              from: (filters.page - 1) * LIMIT + 1,
              to: Math.min(filters.page * LIMIT, data?.total || 0),
              total: data?.total || 0,
            })}
          </span>
          <div className="flex gap-1">
            <button
              disabled={filters.page <= 1}
              onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {tPag('prev')}
            </button>
            <button
              disabled={filters.page >= totalPages}
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {tPag('next')}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
