'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { formatMoneyCompact, formatMoneyRounded, formatNumber } from '@/lib/format';

export interface ReportChartSeries {
  key: string;
  label: string;
  color: string;
}

export interface ReportChartSpec {
  /** Columna que nombra cada barra. */
  category: string;
  series: { key: string; color: string }[];
  /** Importes en pesos o cantidades sueltas. */
  unit: 'money' | 'count';
  /** Barras acostadas cuando las etiquetas son nombres largos. */
  horizontal?: boolean;
}

const TOOLTIP_STYLE = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  fontSize: 12,
  color: 'var(--color-text)',
} as const;

const AXIS_TICK = { fontSize: 11, fill: 'var(--color-muted)' } as const;

const MAX_LABEL = 28;

/** `enero de 2026` → `ene 26`; el resto se corta para que entre en el eje. */
export function shortCategory(value: string): string {
  const month = /^([a-záéíóúñ]+) de (\d{4})$/i.exec(value);
  if (month) return `${month[1].slice(0, 3)} ${month[2].slice(2)}`;
  return value.length > MAX_LABEL ? `${value.slice(0, MAX_LABEL - 1)}…` : value;
}

/**
 * Gráfico de barras de un reporte ya generado. Recibe las mismas filas que la
 * tabla, así que nunca muestra un número distinto al que se descarga.
 */
export function ReportChart({
  title,
  unitHint,
  rows,
  category,
  series,
  unit,
  horizontal = false,
}: {
  title: string;
  unitHint: string;
  rows: Record<string, string>[];
  category: string;
  series: ReportChartSeries[];
  unit: 'money' | 'count';
  horizontal?: boolean;
}) {
  const data = rows.map((row) => {
    const point: Record<string, string | number> = {
      label: shortCategory(row[category] ?? ''),
      full: row[category] ?? '',
    };
    for (const s of series) point[s.key] = Number(row[s.key] ?? 0) || 0;
    return point;
  });

  const hasValues = data.some((point) => series.some((s) => Number(point[s.key]) !== 0));
  if (!hasValues) return null;

  const formatAxis = (value: number) =>
    unit === 'money' ? formatMoneyCompact(value) : formatNumber(value, { decimals: 0 });
  const formatValue = (value: number) =>
    unit === 'money' ? formatMoneyRounded(value) : formatNumber(value, { decimals: 0 });
  const labelOf = (key: string) => series.find((s) => s.key === key)?.label ?? key;
  const height = horizontal ? Math.max(180, data.length * (series.length > 1 ? 44 : 32) + 40) : 260;

  return (
    <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">{title}</h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">{unitHint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-muted)]">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ height }} role="img" aria-label={title}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout={horizontal ? 'vertical' : 'horizontal'}
            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
            barGap={3}
          >
            <CartesianGrid
              vertical={horizontal}
              horizontal={!horizontal}
              stroke="var(--color-border)"
              strokeDasharray="2 4"
            />
            {horizontal ? (
              <>
                <XAxis type="number" tickFormatter={formatAxis} tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="label" width={182} tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
              </>
            ) : (
              <>
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis width={56} tickFormatter={formatAxis} tick={AXIS_TICK} axisLine={false} tickLine={false} />
              </>
            )}
            <Tooltip
              formatter={(value, name) => [formatValue(Number(value)), labelOf(String(name))]}
              labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.full ?? _label)}
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: 'color-mix(in oklab, var(--color-brand-500) 7%, transparent)' }}
            />
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={s.color}
                radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
                maxBarSize={horizontal ? 14 : 26}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
