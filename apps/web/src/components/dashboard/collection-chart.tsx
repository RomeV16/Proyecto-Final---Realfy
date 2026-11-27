'use client';

import { useTranslations } from 'next-intl';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { formatMoneyCompact, formatMoneyRounded } from '@/lib/format';

export interface RevenuePoint {
  month: string;
  expected: number;
  collected: number;
}

const EXPECTED_COLOR = 'color-mix(in oklab, var(--color-muted) 42%, var(--color-surface))';

const TOOLTIP_STYLE = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 10,
  fontSize: 12,
  color: 'var(--color-text)',
} as const;

interface TickProps {
  x?: number | string;
  y?: number | string;
  index?: number;
  payload?: { value: string };
}

/** Etiqueta del mes; el mes en curso lleva la aclaración debajo. */
function MonthTick({
  x = 0,
  y = 0,
  index,
  payload,
  last,
  inProgress,
}: TickProps & { last: number; inProgress: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fontSize={12} fill="var(--color-muted)">
        {payload?.value}
      </text>
      {index === last && (
        <text dy={25} textAnchor="middle" fontSize={10} fill="var(--color-muted)">
          {inProgress}
        </text>
      )}
    </g>
  );
}

/**
 * Liquidado y cobrado por mes. El último punto de la serie es el mes en curso:
 * se dibuja atenuado y con su etiqueta, porque todavía no cerró y compararlo
 * con los meses completos lo haría leer como una caída.
 */
export function CollectionChart({
  trend,
  accent,
  currentMonthName,
}: {
  trend: RevenuePoint[];
  accent: string;
  currentMonthName: string;
}) {
  const t = useTranslations('dashboard.panel.chart');
  const last = trend.length - 1;
  const current = trend[last];
  const hasData = trend.some((point) => point.expected > 0 || point.collected > 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <p className="micro">{t('title')}</p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-[var(--color-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: EXPECTED_COLOR }} />
            {t('expected')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: accent }} />
            {t('collected')}
          </span>
        </div>
      </div>

      {hasData ? (
        <div className="h-[200px]" role="img" aria-label={t('title')}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 8, right: 4, left: 0, bottom: 14 }} barGap={3}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="2 4" />
              <XAxis dataKey="month" tick={(props: TickProps) => (
                  <MonthTick {...props} last={last} inProgress={t('inProgress')} />
                )} axisLine={false} tickLine={false} interval={0} />
              <YAxis
                width={52}
                tickFormatter={(value: number) => formatMoneyCompact(value)}
                tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value, name) => [
                  formatMoneyRounded(Number(value)),
                  name === 'collected' ? t('collected') : t('expected'),
                ]}
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: 'color-mix(in oklab, var(--color-brand-500) 7%, transparent)' }}
              />
              <Bar dataKey="expected" fill={EXPECTED_COLOR} radius={[3, 3, 0, 0]} maxBarSize={22}>
                {trend.map((point, index) => (
                  <Cell key={point.month} fillOpacity={index === last ? 0.5 : 1} />
                ))}
              </Bar>
              <Bar dataKey="collected" fill={accent} radius={[3, 3, 0, 0]} maxBarSize={22}>
                {trend.map((point, index) => (
                  <Cell key={point.month} fillOpacity={index === last ? 0.5 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="rounded-[var(--radius-lg)] bg-[var(--color-surface-sunken)] px-3 py-6 text-center text-sm text-[var(--color-muted)]">
          {t('empty')}
        </p>
      )}

      {hasData && current && (
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          {current.expected > 0
            ? t('currentNote', { month: currentMonthName })
            : t('currentEmpty', { month: currentMonthName })}
        </p>
      )}
    </div>
  );
}
