'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/api-client';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EntityRow } from '@/components/ui/entity-card';
import { StatTile } from '@/components/ui/stat-tile';
import { TicketPriorityBadge } from '@/components/tickets/ticket-priority-badge';
import { DashboardSkeleton } from '@/components/dashboard/dashboard-skeleton';
import { DailyPriorities } from '@/components/dashboard/daily-priorities';
import { PortfolioAnalytics } from '@/components/dashboard/portfolio-analytics';
import { CollectionChart } from '@/components/dashboard/collection-chart';
import { Icon, type IconName } from '@/components/ui/icon';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatMoneyRounded, formatMoneyCompact, formatDate, formatLocalDate } from '@/lib/format';
import { useCan } from '@/lib/permissions';

/* ──────────────── Types ──────────────── */

interface TenantData {
  id: string;
  name: string;
  brandPrimary?: string;
}

interface Stats {
  currency: string;
  monthlyRentRoll: number;
  avgRent: number;
  portfolioValue: number;
  totalProperties: number;
  occupiedUnits: number;
  vacantUnits: number;
  occupancyRate: number;
  activeContracts: number;
  collections: {
    total: number;
    pagada: number;
    pendiente: number;
    vencida: number;
    rate: number;
    /** Mes del ciclo en curso (`2026-11`) y cuántas liquidaciones tiene; la API puede no mandarlos. */
    period?: string;
    count?: number;
  };
  delinquency: { overdueAmount: number; rate: number };
  tickets: { open: number; urgent: number };
  pendingLiquidaciones: number;
  totalServices: number;
  expiringContracts: { within30: number; within60: number; within90: number };
  propertiesByType: { type: string; count: number }[];
  revenueTrend: { month: string; expected: number; collected: number }[];
  agenda: {
    expiring: { id: string; property: string; tenant: string; endDate: string; daysLeft: number }[];
    collections: { id: string; property: string; period: string; amount: number; status: string }[];
    tickets: { id: string; title: string; priority: string; status: string; property: string }[];
  };
}

const TYPE_COLORS = ['#bd5a32', '#3d5f49', '#c58a2b', '#8a7e6d', '#a4481f', '#5f8168', '#d8926f'];

const monthName = (date: Date) => formatLocalDate(date, { month: 'long' });

const percentOf = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 100) : null;

/** Primer día del mes que la API informa como ciclo en curso; sin ese dato, el del navegador. */
function cycleMonth(period: string | undefined, fallback: Date | null): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period ?? '');
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : fallback;
}

/* ──────────────── Small pieces ──────────────── */

/** Tinted icon plate used as the leading visual of every agenda row. */
function RowIcon({
  icon,
  tone,
}: {
  icon: IconName;
  tone: 'brand' | 'warning' | 'danger' | 'success';
}) {
  const color = tone === 'brand' ? 'var(--color-brand-500)' : `var(--color-${tone})`;
  return (
    <span
      className="flex h-10 w-10 items-center justify-center rounded-full"
      style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, var(--color-surface))`, color }}
    >
      <Icon name={icon} className="h-5 w-5" strokeWidth={1.9} />
    </span>
  );
}

function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card-lux p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="h3">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function AgendaGroup({
  title,
  count,
  href,
  emptyText,
  seeAll,
  children,
}: {
  title: string;
  count: number;
  href: string;
  emptyText: string;
  seeAll: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="micro">{title}</p>
        {count > 3 && (
          <Link href={href} className="text-xs font-medium text-brand-600 link-underline">
            {seeAll}
          </Link>
        )}
      </div>
      {count === 0 ? (
        <p className="rounded-[var(--radius-lg)] bg-[var(--color-surface-sunken)] px-3 py-3 text-sm text-[var(--color-muted)]">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-2.5">{children}</div>
      )}
    </div>
  );
}

/** Un dato chico del bloque de cartera: valor, nombre y aclaración. */
function Fact({
  value,
  label,
  hint,
  href,
}: {
  value: React.ReactNode;
  label: string;
  hint?: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="numeric-xl !text-[1.4rem]">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-[var(--color-text)]">{label}</p>
      {hint && <p className="text-[11px] text-[var(--color-muted)]">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-75">
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
}

/* ──────────────── Page ──────────────── */

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tp = useTranslations('dashboard.panel');
  const { user, isLoading } = useAuth();

  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setError(false);
        setLoading(true);
        const [tn, st] = await Promise.all([
          apiClient<TenantData>('/tenants/me').catch(() => null),
          apiClient<Stats>('/dashboard/stats'),
        ]);
        if (cancelled) return;
        if (tn) setTenant(tn);
        setStats(st);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    // Wait for the auth context to hydrate the user before fetching; the guard
    // below keeps the skeleton on screen until then (no premature error state).
    if (user) void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const accent = tenant?.brandPrimary || '#bd5a32';
  // Los widgets de ocupación y rentabilidad van contra endpoints de Admin/Gerencia.
  const canSeeAnalytics = useCan('dashboard.analytics');

  if (error) {
    return (
      <div className="card-lux p-8 text-center">
        <p className="text-sm text-[var(--color-danger)]">{t('errorLoading')}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 text-sm font-medium text-brand-600 link-underline"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  const showSkeleton = isLoading || loading || !stats;
  const s = stats;
  const collectedPct = s && s.collections.total > 0 ? (s.collections.pagada / s.collections.total) * 100 : 0;
  const pendingPct = s && s.collections.total > 0 ? (s.collections.pendiente / s.collections.total) * 100 : 0;
  const overduePct = s && s.collections.total > 0 ? (s.collections.vencida / s.collections.total) * 100 : 0;

  const statusLabel: Record<string, string> = {
    Vencida: tp('status.overdue'),
    Enviada: tp('status.sent'),
    Aprobada: tp('status.approved'),
    Pendiente: tp('status.pending'),
  };

  const today = now ? formatLocalDate(now, { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  // El mes de los indicadores es el del servidor: cerca de la medianoche del
  // día 1 el navegador puede estar ya en otro mes que la serie.
  const cycle = cycleMonth(s?.collections.period, now);
  const currentMonth = cycle ? monthName(cycle) : '';
  const previousMonth = cycle ? monthName(new Date(cycle.getFullYear(), cycle.getMonth() - 1, 1)) : '';

  // La serie termina en el mes en curso; el anterior es el último mes cerrado.
  const trend = s?.revenueTrend ?? [];
  const currentPoint = trend.at(-1);
  const closedPoint = trend.at(-2);
  const currentRate = currentPoint ? percentOf(currentPoint.collected, currentPoint.expected) : null;
  const closedRate = closedPoint ? percentOf(closedPoint.collected, closedPoint.expected) : null;

  return (
    <div className="relative">
      {/* Skeleton cross-fades out over the content as data arrives — no blink. */}
      <AnimatePresence>
        {showSkeleton && (
          <motion.div
            key="dashboard-skeleton"
            className="absolute inset-0 z-10"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <DashboardSkeleton firstName={user?.firstName} />
          </motion.div>
        )}
      </AnimatePresence>

      {s && (
        <div className="space-y-5 pb-6">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <div>
              <h1 className="h1">
                {user?.firstName ? tp('greeting', { name: user.firstName }) : tp('greetingNoName')}
              </h1>
              {tenant?.name && <p className="mt-1 text-sm text-[var(--color-muted)]">{tenant.name}</p>}
            </div>
            {today && <p className="text-sm text-[var(--color-muted)] first-letter:uppercase">{today}</p>}
          </div>

          {/* Indicadores: cada uno con su unidad, su período y el listado al que lleva */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile
              label={tp('kpi.occupancy')}
              value={`${s.occupancyRate}%`}
              progress={s.occupancyRate}
              tone="brand"
              hint={tp('kpi.occupancyHint', { occupied: s.occupiedUnits, total: s.totalProperties })}
              href={'/properties'}
            />
            <StatTile
              label={currentMonth ? tp('kpi.collected', { month: currentMonth }) : tp('kpi.collectedNoMonth')}
              value={formatMoneyCompact(s.collections.pagada)}
              icon="wallet"
              tone="success"
              hint={
                s.collections.count !== 0 && currentPoint && currentRate !== null
                  ? tp('kpi.collectedHint', {
                      pct: currentRate,
                      amount: formatMoneyCompact(currentPoint.expected),
                    })
                  : tp('kpi.collectedNone')
              }
              href={'/liquidaciones'}
            />
            <StatTile
              label={tp('kpi.overdue')}
              value={formatMoneyCompact(s.delinquency.overdueAmount)}
              icon="alert"
              tone={s.delinquency.overdueAmount > 0 ? 'danger' : 'success'}
              hint={s.delinquency.overdueAmount > 0 ? tp('kpi.overdueHint') : tp('kpi.overdueNone')}
              href={'/delinquency'}
            />
            <StatTile
              label={tp('kpi.tickets')}
              value={s.tickets.open}
              icon="tickets"
              tone={s.tickets.urgent > 0 ? 'warning' : 'neutral'}
              hint={tp('kpi.ticketsHint', { count: s.tickets.urgent })}
              href={'/tickets'}
            />
          </div>

          {/* Cartera: alquiler mensual, y liquidado y cobrado por mes */}
          <div className="card-lux grid overflow-hidden lg:grid-cols-[minmax(260px,0.8fr)_1.6fr]">
            <div className="flex flex-col justify-center border-b border-[var(--color-border)] p-5 sm:p-6 lg:border-b-0 lg:border-r">
              <p className="micro">{tp('rentRoll')}</p>
              <p
                className="font-display mt-2.5 text-[clamp(2.1rem,3.6vw,3rem)] leading-none"
                style={{ color: accent }}
              >
                {formatMoneyRounded(s.monthlyRentRoll)}
              </p>
              <p className="mt-1.5 text-xs text-[var(--color-muted)]">{tp('rentRollHint')}</p>
              <div className="mt-5 grid grid-cols-3 gap-4">
                <Fact value={s.activeContracts} label={tp('activeContracts')} href={'/contracts'} />
                <Fact value={formatMoneyCompact(s.avgRent)} label={tp('avgRent')} hint={tp('perMonth')} />
                <Fact
                  value={closedRate === null ? '—' : `${closedRate}%`}
                  label={previousMonth ? tp('closedRate', { month: previousMonth }) : tp('closedRateNoMonth')}
                  hint={closedRate === null ? tp('closedRateNone') : tp('closedRateHint')}
                />
              </div>
            </div>
            <div className="p-5 sm:p-6">
              <CollectionChart trend={trend} accent={accent} currentMonthName={currentMonth} />
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            <div className="min-w-0 space-y-5">
              {/* Prioridades del día — arranca la jornada por lo que no puede esperar */}
              {canSeeAnalytics && <DailyPriorities />}

              <SectionCard
                title={tp('agenda.title')}
                action={<span className="micro">{tp('agenda.window')}</span>}
              >
                <div className="space-y-5">
                  <AgendaGroup
                    title={tp('agenda.expiring')}
                    count={s.agenda.expiring.length}
                    href={'/contracts'}
                    emptyText={tp('agenda.expiringEmpty')}
                    seeAll={tp('agenda.seeAll', { count: s.agenda.expiring.length })}
                  >
                    {s.agenda.expiring.slice(0, 3).map((c) => (
                      <EntityRow
                        key={c.id}
                        href={`/contracts/${c.id}`}
                        label={c.property}
                        accent={c.daysLeft <= 30 ? 'danger' : 'warning'}
                        leading={<RowIcon icon="contracts" tone={c.daysLeft <= 30 ? 'danger' : 'warning'} />}
                        title={c.property}
                        subtitle={c.tenant}
                        trailing={
                          <EntityRow.Amount
                            value={tp('agenda.days', { count: c.daysLeft })}
                            hint={tp('agenda.toExpiry')}
                            tone={c.daysLeft <= 30 ? 'danger' : 'default'}
                          />
                        }
                        actions={
                          <EntityRow.Action href={`/contracts/${c.id}`} icon="arrowRight" variant="ghost">
                            {tp('agenda.renew')}
                          </EntityRow.Action>
                        }
                      />
                    ))}
                  </AgendaGroup>

                  <AgendaGroup
                    title={tp('agenda.collections')}
                    count={s.agenda.collections.length}
                    href={'/liquidaciones'}
                    emptyText={tp('agenda.collectionsEmpty')}
                    seeAll={tp('agenda.seeAll', { count: s.agenda.collections.length })}
                  >
                    {s.agenda.collections.slice(0, 3).map((c) => {
                      const overdue = c.status === 'Vencida';
                      return (
                        <EntityRow
                          key={c.id}
                          href={'/liquidaciones'}
                          label={c.property}
                          accent={overdue ? 'danger' : 'warning'}
                          leading={<RowIcon icon="liquidaciones" tone={overdue ? 'danger' : 'warning'} />}
                          title={c.property}
                          subtitle={`${formatDate(c.period, { month: 'long', year: 'numeric' })} · ${statusLabel[c.status] ?? c.status}`}
                          trailing={
                            <EntityRow.Amount
                              value={formatMoneyRounded(c.amount)}
                              hint={overdue ? tp('agenda.overdue') : tp('agenda.pending')}
                              tone={overdue ? 'danger' : 'default'}
                            />
                          }
                          actions={
                            <EntityRow.Action href={'/liquidaciones'} icon="arrowRight" variant="ghost">
                              {tp('agenda.collect')}
                            </EntityRow.Action>
                          }
                        />
                      );
                    })}
                  </AgendaGroup>

                  <AgendaGroup
                    title={tp('agenda.tickets')}
                    count={s.agenda.tickets.length}
                    href={'/tickets'}
                    emptyText={tp('agenda.ticketsEmpty')}
                    seeAll={tp('agenda.seeAll', { count: s.agenda.tickets.length })}
                  >
                    {s.agenda.tickets.slice(0, 3).map((tk) => (
                      <EntityRow
                        key={tk.id}
                        href={`/tickets/${tk.id}`}
                        label={tk.title}
                        accent={tk.priority === 'Urgente' ? 'danger' : 'brand'}
                        leading={
                          <RowIcon icon="tickets" tone={tk.priority === 'Urgente' ? 'danger' : 'brand'} />
                        }
                        title={tk.title}
                        subtitle={tk.property}
                        meta={
                          <div className="flex flex-wrap items-center gap-1.5">
                            <TicketPriorityBadge priority={tk.priority} />
                          </div>
                        }
                        actions={
                          <EntityRow.Action href={`/tickets/${tk.id}`} icon="arrowRight" variant="ghost">
                            {tp('agenda.attend')}
                          </EntityRow.Action>
                        }
                      />
                    ))}
                  </AgendaGroup>
                </div>
              </SectionCard>
            </div>

            <div className="min-w-0 space-y-5">
              <SectionCard
                title={tp('collectionStatus.title')}
                action={
                  <Link href={'/liquidaciones'} className="text-xs font-medium text-brand-600 link-underline">
                    {tp('collectionStatus.link')}
                  </Link>
                }
              >
                {s.collections.total > 0 ? (
                  <div className="space-y-4">
                    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
                      <span className="h-full bg-[var(--color-success)]" style={{ width: `${collectedPct}%` }} />
                      <span className="h-full bg-[var(--color-warning)]" style={{ width: `${pendingPct}%` }} />
                      <span className="h-full bg-[var(--color-danger)]" style={{ width: `${overduePct}%` }} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        {
                          label: tp('collectionStatus.collected'),
                          hint: tp('collectionStatus.thisMonth'),
                          v: s.collections.pagada,
                          c: 'var(--color-success)',
                        },
                        {
                          label: tp('collectionStatus.pending'),
                          hint: tp('collectionStatus.thisMonth'),
                          v: s.collections.pendiente,
                          c: 'var(--color-warning)',
                        },
                        {
                          label: tp('collectionStatus.overdue'),
                          hint: tp('collectionStatus.allPeriods'),
                          v: s.collections.vencida,
                          c: 'var(--color-danger)',
                        },
                      ].map((x) => (
                        <div key={x.label}>
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ background: x.c }} />
                            <span className="text-xs text-[var(--color-muted)]">{x.label}</span>
                          </div>
                          <p className="mt-0.5 text-sm font-medium tabular-nums">{formatMoneyCompact(x.v)}</p>
                          <p className="text-[11px] text-[var(--color-muted)]">{x.hint}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="rounded-[var(--radius-lg)] bg-[var(--color-surface-sunken)] px-3 py-3 text-sm text-[var(--color-muted)]">
                    {tp('collectionStatus.empty')}
                  </p>
                )}
              </SectionCard>

              <SectionCard
                title={tp('composition.title')}
                action={<span className="micro">{tp('composition.count', { count: s.totalProperties })}</span>}
              >
                <div className="flex items-center gap-5">
                  <div className="h-[132px] w-[132px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={s.propertiesByType}
                          dataKey="count"
                          nameKey="type"
                          innerRadius="58%"
                          outerRadius="98%"
                          paddingAngle={2}
                          stroke="none"
                        >
                          {s.propertiesByType.map((p, i) => (
                            <Cell key={p.type} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v, n) => [`${v}`, String(n)]}
                          contentStyle={{
                            borderRadius: 10,
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)',
                            color: 'var(--color-text)',
                            fontSize: 12,
                          }}
                          itemStyle={{ color: 'var(--color-text)' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {s.propertiesByType.map((p, i) => (
                      <div key={p.type} className="flex items-center gap-2 text-sm">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }}
                        />
                        <span className="flex-1 truncate text-[var(--color-text)]">{p.type}</span>
                        <span className="tabular-nums text-[var(--color-muted)]">{p.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </SectionCard>

              {/* Ocupación y rentabilidad — sólo para quienes ven las métricas de cartera */}
              {canSeeAnalytics && <PortfolioAnalytics />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
