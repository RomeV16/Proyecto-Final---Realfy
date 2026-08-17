'use client';

import { useTranslations } from 'next-intl';
import { useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResponsiveTable, Column } from '@/components/ui/responsive-table';
import { EntityRow, Badge } from '@/components/ui/entity-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { ReportSchedulingSection } from './report-scheduling';

/* ──────────── Types ──────────── */

const REPORT_TYPES = [
  'ownerStatement',
  'propertyProfitability',
  'cashFlow',
  'commissionSummary',
  'pipelineAnalytics',
  'morosidad',
] as const;

type ReportType = (typeof REPORT_TYPES)[number];

/** Clave sintética para identificar filas que no tienen id propio. */
const ROW_ID = '__rowId';

type ReportRow = Record<string, string>;

/** Column keys per report type — matches backend row fields */
const COLUMN_KEYS: Record<ReportType, string[]> = {
  ownerStatement: ['periodo', 'propiedad', 'cobrado', 'comision', 'honorarios', 'deducciones', 'depositoNeto'],
  propertyProfitability: ['propiedad', 'cobrado', 'facturado', 'comisiones', 'ingresoNeto'],
  cashFlow: ['mes', 'ingresos', 'egresos', 'facturado', 'saldoNeto'],
  commissionSummary: ['propiedad', 'propietario', 'periodo', 'tipoComision', 'comision', 'honorarios', 'total'],
  pipelineAnalytics: ['etapa', 'leadsActuales', 'convertidos', 'perdidos', 'tasaConversion', 'promedioConversionDias'],
  morosidad: ['propiedad', 'inquilino', 'periodo', 'vencimiento', 'diasVencidos', 'monto', 'moneda'],
};

/** Money columns — right-aligned and rendered with the currency prefix. */
const CURRENCY_COLUMNS = new Set([
  'cobrado', 'comision', 'honorarios', 'deducciones', 'depositoNeto',
  'facturado', 'comisiones', 'ingresoNeto',
  'ingresos', 'egresos', 'saldoNeto',
  'total', 'monto', 'totalVencido',
]);

/** Plain counts — right-aligned, no currency prefix. */
const COUNT_COLUMNS = new Set([
  'leadsActuales', 'convertidos', 'perdidos', 'promedioConversionDias',
  'diasVencidos', 'cantidadVencidas', 'totalLeads', 'totalConvertidos',
]);

/** Summary keys that are not columns of the report and need their own label. */
const SUMMARY_ONLY_KEYS = new Set([
  'totalVencido', 'cantidadVencidas',
  'totalLeads', 'totalConvertidos', 'tasaConversionGeneral',
]);

/** Report types whose leading column is the identity of the row. */
const ROW_ACCENT: Record<ReportType, 'brand' | 'info' | 'warning' | 'danger'> = {
  ownerStatement: 'brand',
  propertyProfitability: 'brand',
  cashFlow: 'info',
  commissionSummary: 'brand',
  pipelineAnalytics: 'info',
  morosidad: 'danger',
};

interface ReportResult {
  type: string;
  title: string;
  columns: string[];
  rows: ReportRow[];
  summary?: Record<string, string>;
  generatedAt: string;
  filters: Record<string, unknown>;
}

/* ──────────── Helpers ──────────── */

function formatNumber(value: string): string {
  const num = Number(value);
  if (isNaN(num)) return value;
  return num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCount(value: string): string {
  const num = Number(value);
  if (isNaN(num)) return value;
  return num.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function formatCell(key: string, value: string | undefined): string {
  if (CURRENCY_COLUMNS.has(key)) return `$${formatNumber(value ?? '0')}`;
  if (COUNT_COLUMNS.has(key)) return formatCount(value ?? '0');
  return value ?? '—';
}

function currentYearRange(): { from: string; to: string } {
  const year = new Date().getFullYear();
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

const EMPTY_FILTERS = {
  ...currentYearRange(),
  ownerId: '',
  propertyId: '',
  contractId: '',
  pipelineId: '',
};

const SELECT_CLASS =
  'h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)]';

/* ──────────── Component ──────────── */

export function ReportsPage() {
  const t = useTranslations('reports');
  const tColumns = useTranslations('reports.columns');
  const tSummary = useTranslations('reports.summaryLabels');
  const tEmpty = useTranslations('emptyStates.reports');
  const { user } = useAuth();

  const [reportType, setReportType] = useState<ReportType | ''>('');
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });

  const [data, setData] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [excelDownloading, setExcelDownloading] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);

  const canAccess = ['Admin', 'Gerente', 'Liquidaciones'].includes(user?.role || '');
  const canSchedule = ['Admin', 'Gerente'].includes(user?.role || '');

  /** Query string shared by the JSON fetch and both file downloads. */
  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (reportType === 'ownerStatement' && filters.ownerId) {
      params.set('ownerId', filters.ownerId.trim());
    }
    if (reportType === 'propertyProfitability' && filters.propertyId) {
      params.set('propertyId', filters.propertyId.trim());
    }
    if (reportType === 'commissionSummary' && filters.contractId) {
      params.set('contractId', filters.contractId.trim());
    }
    if (reportType === 'pipelineAnalytics' && filters.pipelineId) {
      params.set('pipelineId', filters.pipelineId.trim());
    }
    return params;
  }, [filters, reportType]);

  const fetchReport = useCallback(async () => {
    if (!reportType) return;

    // El estado de cuenta se emite contra un propietario concreto.
    if (reportType === 'ownerStatement' && !filters.ownerId.trim()) {
      toast.error(t('errors.ownerIdRequired'));
      return;
    }

    setLoading(true);
    try {
      const res = await apiClient<ReportResult>(`/reports/${reportType}?${buildParams().toString()}`);
      // Las filas del reporte son agregaciones sin id propio: la posición es la
      // única clave estable que tienen para la lista.
      setData({
        ...res,
        rows: (res.rows ?? []).map((row, index) => ({ ...row, [ROW_ID]: String(index) })),
      });
    } catch (err) {
      setData(null);
      toast.error(err instanceof ApiRequestError ? err.message : t('errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [reportType, filters.ownerId, buildParams, t]);

  async function handleDownload(format: 'excel' | 'pdf') {
    if (!reportType) return;

    const setDownloading = format === 'excel' ? setExcelDownloading : setPdfDownloading;
    setDownloading(true);

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
      const response = await fetch(
        `${apiBase}/reports/${reportType}/${format}?${buildParams().toString()}`,
        { credentials: 'include' },
      );

      if (!response.ok) throw new Error(`${format} download failed`);

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const ext = format === 'excel' ? 'xlsx' : 'pdf';
      const fileName =
        match?.[1] || `reporte-${reportType}-${new Date().toISOString().slice(0, 10)}.${ext}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('errors.downloadFailed'));
    } finally {
      setDownloading(false);
    }
  }

  function selectType(rt: ReportType) {
    setReportType(rt);
    setData(null);
  }

  function updateFilter(key: keyof typeof filters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  if (!canAccess) {
    return <EmptyState iconName="reports" title={t('forbidden')} subtitle={t('forbiddenHint')} />;
  }

  const columnKeys = reportType ? COLUMN_KEYS[reportType] : [];
  const labelOf = (key: string) =>
    SUMMARY_ONLY_KEYS.has(key) && !columnKeys.includes(key)
      ? tSummary(key)
      : tColumns(`${reportType}.${key}`);

  const columns: Column<ReportRow>[] = columnKeys.map((key) => ({
    key,
    header: labelOf(key),
    alignRight: CURRENCY_COLUMNS.has(key) || COUNT_COLUMNS.has(key),
    render: (row) => (
      <span
        className={cn(
          CURRENCY_COLUMNS.has(key) || COUNT_COLUMNS.has(key)
            ? 'tabular-nums text-[var(--color-text)]'
            : 'text-[var(--color-text)]',
        )}
      >
        {formatCell(key, row[key])}
      </span>
    ),
  }));

  const summaryEntries = data?.summary ? Object.entries(data.summary) : [];
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        {data && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleDownload('excel')}
              disabled={excelDownloading}
            >
              <Icon name="download" className="h-4 w-4" strokeWidth={2} />
              {excelDownloading ? t('download.downloading') : t('download.excel')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleDownload('pdf')}
              disabled={pdfDownloading}
            >
              <Icon name="download" className="h-4 w-4" strokeWidth={2} />
              {pdfDownloading ? t('download.downloading') : t('download.pdf')}
            </Button>
          </div>
        )}
      </div>

      {/* Report type picker */}
      <div className="space-y-4 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <p className="eyebrow">{t('selectType')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {REPORT_TYPES.map((rt) => {
            const selected = reportType === rt;
            return (
              <button
                key={rt}
                type="button"
                aria-pressed={selected}
                onClick={() => selectType(rt)}
                className={cn(
                  'rounded-[var(--radius-lg)] border p-4 text-left transition-colors duration-200',
                  selected
                    ? 'border-brand-500 bg-[color-mix(in_oklab,var(--color-brand-500)_8%,var(--color-surface))]'
                    : 'border-[var(--color-border)] hover:border-brand-500/40 hover:bg-[var(--color-bg)]',
                )}
              >
                <p
                  className={cn(
                    'text-sm font-medium',
                    selected ? 'text-[var(--color-brand-700)]' : 'text-[var(--color-text)]',
                  )}
                >
                  {t(`types.${rt}`)}
                </p>
                <p className="mt-1 text-xs text-[var(--color-muted)]">{t(`typeDescriptions.${rt}`)}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      {reportType && (
        <div className="space-y-4 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="report-from" className="text-[0.8rem] font-medium text-[var(--color-text)]">
                {t('filters.from')}
              </label>
              <input
                id="report-from"
                type="date"
                value={filters.from}
                onChange={(e) => updateFilter('from', e.target.value)}
                className={SELECT_CLASS}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="report-to" className="text-[0.8rem] font-medium text-[var(--color-text)]">
                {t('filters.to')}
              </label>
              <input
                id="report-to"
                type="date"
                value={filters.to}
                onChange={(e) => updateFilter('to', e.target.value)}
                className={SELECT_CLASS}
              />
            </div>

            {reportType === 'ownerStatement' && (
              <Input
                label={`${t('filters.ownerId')} *`}
                value={filters.ownerId}
                onChange={(e) => updateFilter('ownerId', e.target.value)}
                placeholder={t('filters.ownerIdPlaceholder')}
                hint={t('filters.required')}
                required
              />
            )}

            {reportType === 'propertyProfitability' && (
              <Input
                label={t('filters.propertyId')}
                value={filters.propertyId}
                onChange={(e) => updateFilter('propertyId', e.target.value)}
                placeholder={t('filters.propertyIdPlaceholder')}
              />
            )}

            {reportType === 'commissionSummary' && (
              <Input
                label={t('filters.contractId')}
                value={filters.contractId}
                onChange={(e) => updateFilter('contractId', e.target.value)}
                placeholder={t('filters.contractIdPlaceholder')}
              />
            )}

            {reportType === 'pipelineAnalytics' && (
              <Input
                label={t('filters.pipelineId')}
                value={filters.pipelineId}
                onChange={(e) => updateFilter('pipelineId', e.target.value)}
                placeholder={t('filters.pipelineIdPlaceholder')}
              />
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={fetchReport} disabled={loading}>
              <Icon name="reports" className="h-4 w-4" strokeWidth={2} />
              {t('generate')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFilters({ ...EMPTY_FILTERS })}
            >
              {t('filters.clear')}
            </Button>
          </div>
        </div>
      )}

      {/* Summary of the generated report */}
      {data && summaryEntries.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow">{t('summary')}</p>
            <Badge variant="neutral">{t('rowCount', { count: rows.length })}</Badge>
            <span className="text-xs text-[var(--color-muted)]">
              {t('generatedAt')}: {new Date(data.generatedAt).toLocaleString('es-AR')}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {summaryEntries.map(([key, value]) => (
              <StatTile
                key={key}
                label={labelOf(key)}
                value={formatCell(key, value)}
                tone={reportType === 'morosidad' ? 'danger' : 'brand'}
              />
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {reportType ? (
        <ResponsiveTable<ReportRow>
          items={rows}
          columns={columns}
          keyExtractor={(row) => row[ROW_ID]}
          loading={loading}
          skeletonRows={5}
          empty={{
            iconName: 'reports',
            title: tEmpty('emptyResultTitle'),
            subtitle: tEmpty('emptyResultSubtitle'),
          }}
          cardRenderer={(row) => (
            <EntityRow
              accent={ROW_ACCENT[reportType]}
              title={formatCell(columnKeys[0], row[columnKeys[0]])}
              subtitle={
                columnKeys[1] ? `${labelOf(columnKeys[1])}: ${formatCell(columnKeys[1], row[columnKeys[1]])}` : undefined
              }
              meta={
                <EntityRow.Meta
                  items={columnKeys.slice(2).map((key) => ({
                    label: `${labelOf(key)}: ${formatCell(key, row[key])}`,
                  }))}
                />
              }
            />
          )}
        />
      ) : (
        <EmptyState
          iconName="reports"
          title={tEmpty('noTypeTitle')}
          subtitle={tEmpty('noTypeSubtitle')}
        />
      )}

      {/* Scheduled deliveries */}
      {canSchedule && <ReportSchedulingSection reportTypes={REPORT_TYPES} />}
    </div>
  );
}
