'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

/* ──────────── Types ──────────── */

interface ClosureMetrics {
  contractType: string;
  closureStatus: string;
  startDate: string;
  endDate: string;
  closedOn: string;
  durationDays: number;
  durationMonths: number;
  endedEarly: boolean;
  currency: string;

  billedCount: number;
  paidCount: number;
  onTimeCount: number;
  lateCount: number;
  unpaidCount: number;
  onTimeRate: number;
  averageDelayDays: number;
  maxDelayDays: number;
  billedAmount: number;
  collectedAmount: number;
  outstandingAmount: number;

  penaltyCount: number;
  penaltyAmount: number;
  penaltyWaivedCount: number;

  ticketCount: number;
  ticketsResolved: number;
  ticketsCancelled: number;
  ticketsOpen: number;
  averageResolutionDays: number | null;
  ticketCostAmount: number;

  adjustmentCount: number;
  firstRent: number;
  lastRent: number;
  rentIncreasePct: number;

  rendicionCount: number;
  rendicionNetAmount: number;
}

interface ClosureSummaryRecord {
  summary: string;
  highlights: string[];
  metrics: ClosureMetrics;
  source: 'model' | 'rules';
  model: string | null;
  generatedAt: string;
}

interface ClosureSummaryResponse {
  contractId: string;
  status: string;
  closed: boolean;
  summary: ClosureSummaryRecord | null;
}

/* ──────────── Formatting ──────────── */

function fmtAmount(value: number, currency: string): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: currency || 'ARS',
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtPercent(value: number): string {
  const rendered = Number.isInteger(value)
    ? String(value)
    : value.toFixed(1).replace('.', ',');
  return `${rendered} %`;
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/* ──────────── Small pieces ──────────── */

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-slate-900 tabular-nums">{value}</p>
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-4/5" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────── Component ──────────── */

/**
 * Resumen de gestión al cierre del contrato.
 *
 * Cuelga de `/ai/contracts/:id/closure-summary`, restringido a Admin y
 * Gerencia. Muestra la redacción guardada, las métricas con las que se armó y
 * una línea al pie que aclara quién la escribió — el modelo de lenguaje o las
 * plantillas del sistema — con el modelo y la fecha, para que el texto siempre
 * se pueda leer contra sus números.
 */
export function ClosureSummary({ contractId }: { contractId: string }) {
  const t = useTranslations('contracts.closure');
  const tMetrics = useTranslations('contracts.closure.metrics');

  const [data, setData] = useState<ClosureSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await apiClient<ClosureSummaryResponse>(
        `/ai/contracts/${contractId}/closure-summary`,
      ));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [contractId, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    setError('');
    try {
      setData(
        await apiClient<ClosureSummaryResponse>(
          `/ai/contracts/${contractId}/closure-summary`,
          { method: 'POST' },
        ),
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('generateError'));
    } finally {
      setGenerating(false);
    }
  }

  const record = data?.summary ?? null;
  const metrics = record?.metrics;

  const tiles: Array<{ label: string; value: string }> = [];
  if (metrics) {
    tiles.push({
      label: tMetrics('duration'),
      value: tMetrics('monthsValue', { months: metrics.durationMonths }),
    });
    tiles.push({
      label: tMetrics('onTimeRate'),
      value: fmtPercent(metrics.onTimeRate),
    });
    tiles.push({
      label: tMetrics('payments'),
      value: tMetrics('paymentsValue', {
        onTime: metrics.onTimeCount,
        paid: metrics.paidCount,
      }),
    });
    tiles.push({
      label: tMetrics('averageDelay'),
      value: tMetrics('daysValue', { days: metrics.averageDelayDays }),
    });
    tiles.push({
      label: tMetrics('maxDelay'),
      value: tMetrics('daysValue', { days: metrics.maxDelayDays }),
    });
    tiles.push({
      label: tMetrics('billed'),
      value: fmtAmount(metrics.billedAmount, metrics.currency),
    });
    tiles.push({
      label: tMetrics('collected'),
      value: fmtAmount(metrics.collectedAmount, metrics.currency),
    });
    tiles.push({
      label: tMetrics('outstanding'),
      value: fmtAmount(metrics.outstandingAmount, metrics.currency),
    });
    tiles.push({
      label: tMetrics('penalties'),
      value: tMetrics('penaltiesValue', {
        count: metrics.penaltyCount,
        amount: fmtAmount(metrics.penaltyAmount, metrics.currency),
      }),
    });
    tiles.push({
      label: tMetrics('tickets'),
      value: tMetrics('ticketsValue', {
        resolved: metrics.ticketsResolved,
        count: metrics.ticketCount,
      }),
    });
    if (metrics.averageResolutionDays !== null) {
      tiles.push({
        label: tMetrics('resolutionTime'),
        value: tMetrics('daysValue', { days: metrics.averageResolutionDays }),
      });
    }
    tiles.push({
      label: tMetrics('adjustments'),
      value: String(metrics.adjustmentCount),
    });
    tiles.push({
      label: tMetrics('rentChange'),
      value: `${metrics.rentIncreasePct >= 0 ? '+' : ''}${fmtPercent(metrics.rentIncreasePct)}`,
    });
    tiles.push({
      label: tMetrics('rendiciones'),
      value: tMetrics('rendicionesValue', {
        count: metrics.rendicionCount,
        amount: fmtAmount(metrics.rendicionNetAmount, metrics.currency),
      }),
    });
  }

  const attribution =
    record?.source === 'model' && record.model
      ? t('sourceModel', { model: record.model, date: fmtDateTime(record.generatedAt) })
      : record
        ? t('sourceRules', { date: fmtDateTime(record.generatedAt) })
        : '';

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{t('title')}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{t('hint')}</p>
        </div>
        {data?.closed && (
          <Button variant="secondary" onClick={handleGenerate} disabled={generating}>
            {generating ? (
              <Spinner className="w-4 h-4" />
            ) : (
              <Icon name="sparkles" className="w-4 h-4" strokeWidth={1.75} />
            )}
            {record ? t('regenerate') : t('generate')}
          </Button>
        )}
      </div>

      {loading ? (
        <SummarySkeleton />
      ) : !data ? (
        <EmptyState iconName="alert" title={t('loadError')} subtitle={error || undefined} />
      ) : !data.closed ? (
        <EmptyState
          iconName="calendarClock"
          title={t('openTitle')}
          subtitle={t('openSubtitle')}
        />
      ) : !record ? (
        <EmptyState
          iconName="sparkles"
          title={t('emptyTitle')}
          subtitle={t('emptySubtitle')}
        />
      ) : (
        <div className="space-y-5">
          {/* Redacción */}
          <div className="space-y-3">
            {record.summary.split('\n\n').map((paragraph, i) => (
              <p key={i} className="text-sm leading-relaxed text-slate-700">
                {paragraph}
              </p>
            ))}
          </div>

          {/* Puntos destacados */}
          {record.highlights.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                {t('highlights')}
              </h3>
              <ul className="space-y-1.5">
                {record.highlights.map((highlight, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <Icon
                      name="check"
                      className="w-4 h-4 mt-0.5 shrink-0 text-brand-600"
                      strokeWidth={2}
                    />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Métricas que respaldan el texto */}
          <div className="pt-4 border-t border-slate-200">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              {t('metricsTitle')}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {tiles.map((tile) => (
                <MetricTile key={tile.label} label={tile.label} value={tile.value} />
              ))}
            </div>
          </div>

          {/* Atribución: el texto es de alguien y los números son del sistema. */}
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Icon name="sparkles" className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
            {attribution}
          </p>
        </div>
      )}

      {error && !loading && data && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}
