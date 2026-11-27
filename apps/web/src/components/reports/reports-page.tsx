'use client';

import { useTranslations } from 'next-intl';
import { useState, useCallback, useEffect, useRef } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { downloadFile } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ResponsiveTable, Column } from '@/components/ui/responsive-table';
import { EntityRow, Badge } from '@/components/ui/entity-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';
import { ReportSchedulingSection } from './report-scheduling';
import { ReportChart, type ReportChartSpec } from './report-chart';
import { formatNumber, formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/permissions';

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

/** Filtro propio de cada reporte: qué parámetro manda y de dónde salen las opciones. */
type EntityFilterKey = 'ownerId' | 'propertyId' | 'contractId' | 'pipelineId';

interface EntityOption {
  id: string;
  label: string;
}

interface PersonItem {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
}
interface PropertyItem {
  id: string;
  title?: string | null;
}
interface ContractItem {
  id: string;
  status?: string | null;
  property?: { title?: string | null } | null;
}
interface PipelineItem {
  id: string;
  name: string;
}

const listOf = <T,>(res: { items?: T[] } | T[] | null | undefined): T[] =>
  Array.isArray(res) ? res : (res?.items ?? []);

const ENTITY_FILTER: Partial<
  Record<ReportType, { key: EntityFilterKey; required: boolean; load: () => Promise<EntityOption[]> }>
> = {
  ownerStatement: {
    key: 'ownerId',
    required: true,
    load: async () =>
      listOf(await apiClient<{ items: PersonItem[] }>('/persons?role=Propietario&limit=100')).map((person) => ({
        id: person.id,
        label: [person.lastName, person.firstName].filter(Boolean).join(', '),
      })),
  },
  propertyProfitability: {
    key: 'propertyId',
    required: false,
    load: async () =>
      listOf(await apiClient<{ items: PropertyItem[] }>('/properties?limit=100')).map((property) => ({
        id: property.id,
        label: property.title ?? '',
      })),
  },
  commissionSummary: {
    key: 'contractId',
    required: false,
    load: async () =>
      listOf(await apiClient<{ items: ContractItem[] }>('/contracts?limit=100')).map((contract) => ({
        id: contract.id,
        label: [contract.property?.title, contract.status].filter(Boolean).join(' · '),
      })),
  },
  pipelineAnalytics: {
    key: 'pipelineId',
    required: false,
    load: async () =>
      listOf(await apiClient<PipelineItem[]>('/pipelines')).map((pipeline) => ({
        id: pipeline.id,
        label: pipeline.name,
      })),
  },
};

const SERIES_COLORS = {
  primary: 'var(--color-brand-500)',
  secondary: 'color-mix(in oklab, var(--color-warning) 75%, var(--color-surface))',
  muted: 'color-mix(in oklab, var(--color-muted) 42%, var(--color-surface))',
} as const;

/** Reportes que además de la tabla se dibujan. */
const CHARTS: Partial<Record<ReportType, ReportChartSpec>> = {
  cashFlow: {
    category: 'mes',
    series: [
      { key: 'ingresos', color: SERIES_COLORS.primary },
      { key: 'egresos', color: SERIES_COLORS.secondary },
    ],
    unit: 'money',
  },
  propertyProfitability: {
    category: 'propiedad',
    series: [
      { key: 'cobrado', color: SERIES_COLORS.primary },
      { key: 'comisiones', color: SERIES_COLORS.secondary },
    ],
    unit: 'money',
    horizontal: true,
  },
  pipelineAnalytics: {
    category: 'etapa',
    series: [{ key: 'leadsActuales', color: SERIES_COLORS.primary }],
    unit: 'count',
    horizontal: true,
  },
};

/** Valores que la API manda como clave interna y necesitan nombre. */
const COMMISSION_TYPES = new Set(['FixedPercent', 'FixedAmount', 'Mixed']);

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

/** Muestra el valor tal cual si no es numérico (columnas de texto en un reporte). */
function formatReportNumber(value: string, decimals: number): string {
  return Number.isNaN(Number(value)) ? value : formatNumber(value, { decimals });
}



function formatCell(key: string, value: string | undefined): string {
  if (CURRENCY_COLUMNS.has(key)) return `$${formatReportNumber(value ?? '0', 2)}`;
  if (COUNT_COLUMNS.has(key)) return formatReportNumber(value ?? '0', 0);
  // "Embudo — Etapa" llega con raya larga: se muestra con un separador liviano.
  if (key === 'etapa') return (value ?? '—').replace(' — ', ' · ');
  return value ?? '—';
}

/** Del 1 de enero a hoy: los meses que todavía no llegaron no aportan filas vacías. */
function yearToDateRange(): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${now.getFullYear()}-01-01`,
    to: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  };
}

const EMPTY_FILTERS = {
  ...yearToDateRange(),
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

  const [reportType, setReportType] = useState<ReportType | ''>('');
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });

  const [data, setData] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [excelDownloading, setExcelDownloading] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);

  const canAccess = useCan('reports.view');
  const canSchedule = useCan('reports.schedule');

  const [options, setOptions] = useState<EntityOption[]>([]);
  // Sólo se muestra el resultado del último pedido: cambiar de reporte o de
  // filtro mientras otro está en viaje no debe pisar lo que se ve.
  const requestSeq = useRef(0);

  const entityFilter = reportType ? ENTITY_FILTER[reportType] : undefined;

  // Las opciones del filtro propio (propietarios, propiedades, …) se cargan al elegir el reporte.
  useEffect(() => {
    let cancelled = false;
    setOptions([]);
    if (!entityFilter) return;
    entityFilter
      .load()
      .then((loaded) => {
        if (!cancelled) setOptions(loaded.filter((option) => option.label));
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entityFilter]);

  /** Query string shared by the JSON fetch and both file downloads. */
  const buildParams = useCallback(
    (type: ReportType, current: typeof filters) => {
      const params = new URLSearchParams();
      if (current.from) params.set('from', current.from);
      if (current.to) params.set('to', current.to);
      const entity = ENTITY_FILTER[type];
      if (entity && current[entity.key]) params.set(entity.key, current[entity.key].trim());
      return params;
    },
    [],
  );

  const runReport = useCallback(
    async (type: ReportType, current: typeof filters) => {
      // El estado de cuenta se emite contra un propietario concreto.
      if (type === 'ownerStatement' && !current.ownerId.trim()) {
        toast.error(t('errors.ownerIdRequired'));
        return;
      }

      const seq = ++requestSeq.current;
      setLoading(true);
      try {
        const res = await apiClient<ReportResult>(`/reports/${type}?${buildParams(type, current).toString()}`);
        if (seq !== requestSeq.current) return;
        // Las filas del reporte son agregaciones sin id propio: la posición es la
        // única clave estable que tienen para la lista.
        setData({
          ...res,
          rows: (res.rows ?? []).map((row, index) => ({ ...row, [ROW_ID]: String(index) })),
        });
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setData(null);
        toast.error(err instanceof ApiRequestError ? err.message : t('errors.loadFailed'));
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [buildParams, t],
  );

  async function handleDownload(format: 'excel' | 'pdf') {
    if (!reportType) return;

    const setDownloading = format === 'excel' ? setExcelDownloading : setPdfDownloading;
    setDownloading(true);

    try {
      const ext = format === 'excel' ? 'xlsx' : 'pdf';
      await downloadFile(
        `/reports/${reportType}/${format}?${buildParams(reportType, filters).toString()}`,
        `reporte-${reportType}-${new Date().toISOString().slice(0, 10)}.${ext}`,
        { preferServerName: true },
      );
    } catch {
      toast.error(t('errors.downloadFailed'));
    } finally {
      setDownloading(false);
    }
  }

  function selectType(rt: ReportType) {
    setReportType(rt);
    setData(null);
    requestSeq.current += 1;
    setLoading(false);
    // Todo reporte que no necesita un dato obligatorio se genera al elegirlo.
    if (!ENTITY_FILTER[rt]?.required) void runReport(rt, filters);
  }

  function updateFilter(key: keyof typeof filters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  /** Elegir propietario, propiedad, contrato o embudo vuelve a generar el reporte. */
  function selectEntity(key: EntityFilterKey, value: string) {
    if (!reportType) return;
    const next = { ...filters, [key]: value };
    setFilters(next);
    if (value || !ENTITY_FILTER[reportType]?.required) void runReport(reportType, next);
  }

  if (!canAccess) {
    return <EmptyState iconName="reports" title={t('forbidden')} subtitle={t('forbiddenHint')} />;
  }

  const columnKeys = reportType ? COLUMN_KEYS[reportType] : [];
  const cellText = (key: string, value: string | undefined) =>
    key === 'tipoComision' && value && COMMISSION_TYPES.has(value)
      ? t(`commissionTypes.${value}`)
      : formatCell(key, value);
  const chart = reportType ? CHARTS[reportType] : undefined;
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
        {cellText(key, row[key])}
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
              onClick={() => void handleDownload('excel')}
              disabled={excelDownloading}
            >
              <Icon name="download" className="h-4 w-4" strokeWidth={2} />
              {excelDownloading ? t('download.downloading') : t('download.excel')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleDownload('pdf')}
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

            {entityFilter && (
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label
                  htmlFor="report-entity"
                  className="text-[0.8rem] font-medium text-[var(--color-text)]"
                >
                  {t(`filters.${entityFilter.key}`)}
                </label>
                <Select
                  id="report-entity"
                  value={filters[entityFilter.key]}
                  onChange={(e) => selectEntity(entityFilter.key, e.target.value)}
                >
                  <option value="">
                    {t(`filters.${entityFilter.key}${entityFilter.required ? 'Choose' : 'All'}`)}
                  </option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={() => reportType && void runReport(reportType, filters)} disabled={loading}>
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
              {t('generatedAt')}: {formatDateTime(data.generatedAt, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {summaryEntries.map(([key, value]) => (
              <StatTile
                key={key}
                label={labelOf(key)}
                value={formatCell(key, value)}
                tone={reportType === 'morosidad' ? 'danger' : 'brand'}
                className="!min-h-0"
              />
            ))}
          </div>
        </div>
      )}

      {/* Chart of the generated report */}
      {data && reportType && chart && rows.length > 0 && (
        <ReportChart
          title={t(`types.${reportType}`)}
          unitHint={t(chart.unit === 'money' ? 'chart.money' : 'chart.count')}
          rows={rows}
          category={chart.category}
          series={chart.series.map((serie) => ({ ...serie, label: labelOf(serie.key) }))}
          unit={chart.unit}
          horizontal={chart.horizontal}
        />
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
              title={cellText(columnKeys[0], row[columnKeys[0]])}
              subtitle={
                columnKeys[1] ? `${labelOf(columnKeys[1])}: ${cellText(columnKeys[1], row[columnKeys[1]])}` : undefined
              }
              meta={
                <EntityRow.Meta
                  items={columnKeys.slice(2).map((key) => ({
                    label: `${labelOf(key)}: ${cellText(key, row[key])}`,
                  }))}
                />
              }
            />
          )}
        />
      ) : (
        <p className="rounded-[var(--radius-xl)] border border-dashed border-[var(--color-border)] px-4 py-6 text-center text-sm text-[var(--color-muted)]">
          {tEmpty('noTypeSubtitle')}
        </p>
      )}

      {/* Scheduled deliveries */}
      {canSchedule && <ReportSchedulingSection reportTypes={REPORT_TYPES} />}
    </div>
  );
}
