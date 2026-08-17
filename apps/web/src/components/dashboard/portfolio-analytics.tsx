'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Reveal } from '@/components/ui/reveal';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';

/* ──────────────── Types ──────────────── */

interface OccupancyPoint {
  month: string;
  occupancyPct: number;
}

interface ProfitabilityRow {
  propertyId: string;
  label: string;
  revenue: number;
  expenses: number;
  net: number;
}

/** Cuántas propiedades entran en el gráfico de rentabilidad. */
const TOP_PROPERTIES = 6;

/* ──────────────── Formatting ──────────────── */

/** '2026-08' → 'ago 26' */
function monthLabel(period: string): string {
  const [year, month] = period.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date
    .toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })
    .replace('.', '');
}

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);

const fmtCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1000)}K`;
  return `$${n}`;
};

/** Las etiquetas de propiedad son direcciones: se cortan para no comerse el eje. */
const shortLabel = (label: string) => (label.length > 22 ? `${label.slice(0, 21)}…` : label);

const TOOLTIP_STYLE = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-lg)',
  fontSize: '0.75rem',
  color: 'var(--color-text)',
} as const;

/* ──────────────── Small pieces ──────────────── */

function AnalyticsCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-lux p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="h3">{title}</h3>
        <span className="micro">{hint}</span>
      </div>
      <div className="min-h-[240px]">{children}</div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex h-[240px] items-end gap-3" aria-hidden="true">
      {['60%', '80%', '45%', '92%', '70%', '55%'].map((height, i) => (
        <Skeleton key={i} className="flex-1 rounded-[var(--radius-lg)]" style={{ height }} />
      ))}
    </div>
  );
}

/* ──────────────── Component ──────────────── */

/**
 * Ocupación y rentabilidad de la cartera. Cuelga de los widgets de métricas
 * del panel (`/dashboard/occupancy-trend` y `/dashboard/profitability`), que
 * están restringidos a Admin y Gerencia.
 */
export function PortfolioAnalytics() {
  const t = useTranslations('dashboard.analytics');

  const [occupancy, setOccupancy] = useState<OccupancyPoint[]>([]);
  const [profitability, setProfitability] = useState<ProfitabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError(false);
        const [trend, rows] = await Promise.all([
          apiClient<OccupancyPoint[]>('/dashboard/occupancy-trend?months=12'),
          apiClient<ProfitabilityRow[]>('/dashboard/profitability'),
        ]);
        if (cancelled) return;
        setOccupancy(Array.isArray(trend) ? trend : []);
        setProfitability(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const occupancyData = occupancy.map((point) => ({
    ...point,
    label: monthLabel(point.month),
  }));

  const topProperties = profitability.slice(0, TOP_PROPERTIES).map((row) => ({
    ...row,
    label: shortLabel(row.label),
  }));

  if (error) {
    return (
      <div className="card-lux p-6">
        <p className="text-sm text-[var(--color-muted)]">{t('loadError')}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Reveal>
        <AnalyticsCard title={t('occupancyTitle')} hint={t('lastTwelveMonths')}>
          {loading ? (
            <ChartSkeleton />
          ) : occupancyData.length === 0 ? (
            <EmptyState
              variant="filtered"
              iconName="properties"
              title={t('occupancyEmpty')}
              subtitle={t('occupancyEmptyHint')}
            />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={occupancyData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="gOccupancy" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="2 4" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: 'var(--color-muted)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(value: number) => `${value}%`}
                  tick={{ fontSize: 12, fill: 'var(--color-muted)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value) => [`${value}%`, t('occupancyLabel')]}
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ stroke: 'var(--color-border)' }}
                />
                <Area
                  type="monotone"
                  dataKey="occupancyPct"
                  stroke="var(--color-brand-500)"
                  strokeWidth={2.5}
                  fill="url(#gOccupancy)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </AnalyticsCard>
      </Reveal>

      <Reveal delay={1}>
        <AnalyticsCard title={t('profitabilityTitle')} hint={t('topProperties', { count: TOP_PROPERTIES })}>
          {loading ? (
            <ChartSkeleton />
          ) : topProperties.length === 0 ? (
            <EmptyState
              variant="filtered"
              iconName="liquidaciones"
              title={t('profitabilityEmpty')}
              subtitle={t('profitabilityEmptyHint')}
            />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={topProperties}
                layout="vertical"
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                barGap={2}
              >
                <CartesianGrid
                  horizontal={false}
                  stroke="var(--color-border)"
                  strokeDasharray="2 4"
                />
                <XAxis
                  type="number"
                  tickFormatter={fmtCompact}
                  tick={{ fontSize: 12, fill: 'var(--color-muted)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={132}
                  tick={{ fontSize: 12, fill: 'var(--color-muted)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value, name) => [
                    fmtCurrency(Number(value)),
                    name === 'revenue' ? t('revenue') : t('expenses'),
                  ]}
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: 'color-mix(in oklab, var(--color-brand-500) 8%, transparent)' }}
                />
                <Legend
                  formatter={(value) => (
                    <span className="text-xs text-[var(--color-muted)]">
                      {value === 'revenue' ? t('revenue') : t('expenses')}
                    </span>
                  )}
                />
                <Bar
                  dataKey="revenue"
                  fill="var(--color-brand-500)"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={12}
                />
                <Bar
                  dataKey="expenses"
                  fill="color-mix(in oklab, var(--color-warning) 70%, var(--color-surface))"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={12}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </AnalyticsCard>
      </Reveal>
    </div>
  );
}
