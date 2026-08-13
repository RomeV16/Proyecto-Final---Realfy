'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/api-client';
import { useEffect, useState } from 'react';
import { Reveal } from '@/components/ui/reveal';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts';

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
  collections: { total: number; pagada: number; pendiente: number; vencida: number; rate: number };
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

/* ──────────────── Formatting ──────────────── */

const fmt = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

const fmtCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1000)}K`;
  return `$${n}`;
};

const monthName = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });

const TYPE_COLORS = ['#bd5a32', '#3d5f49', '#c58a2b', '#8a7e6d', '#a4481f', '#5f8168', '#d8926f'];

/* ──────────────── Small pieces ──────────────── */

function KpiTile({
  label,
  value,
  context,
  accent,
}: {
  label: string;
  value: string;
  context?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="card-lux p-5 flex flex-col justify-between min-h-[128px]">
      <p className="micro">{label}</p>
      <div>
        <p className="numeric-xl" style={accent ? { color: accent } : undefined}>
          {value}
        </p>
        {context && <p className="mt-1.5 text-xs text-[var(--color-muted)]">{context}</p>}
      </div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    Urgente: 'bg-[color-mix(in_srgb,#b23a2b_14%,transparent)] text-[#b23a2b]',
    Alta: 'bg-[color-mix(in_srgb,#c58a2b_16%,transparent)] text-[#9a6b1f]',
    Media: 'bg-[var(--color-surface-sunken)] text-[var(--color-muted)]',
    Baja: 'bg-[var(--color-surface-sunken)] text-[var(--color-muted)]',
  };
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[0.7rem] font-medium ${map[priority] ?? map.Media}`}>
      {priority}
    </span>
  );
}

function AgendaRow({
  href,
  title,
  meta,
  right,
  accent,
}: {
  href: string;
  title: string;
  meta: string;
  right: React.ReactNode;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg px-3 py-3 -mx-1 transition-colors duration-300 hover:bg-[var(--color-surface-sunken)]"
    >
      <span className="h-9 w-[3px] rounded-full shrink-0" style={{ background: accent }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--color-text)] truncate group-hover:text-brand-600 transition-colors">
          {title}
        </p>
        <p className="text-xs text-[var(--color-muted)] truncate">{meta}</p>
      </div>
      <div className="shrink-0 text-right">{right}</div>
    </Link>
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
    <div className="card-lux p-6">
      <div className="flex items-center justify-between mb-4">
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
  children,
}: {
  title: string;
  count: number;
  href: string;
  emptyText: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="micro">{title}</p>
        {count > 3 && (
          <Link href={href} className="text-xs font-medium text-brand-600 link-underline">
            Ver todos ({count})
          </Link>
        )}
      </div>
      {count === 0 ? (
        <p className="text-sm text-[var(--color-muted)] py-2">{emptyText}</p>
      ) : (
        <div className="divide-y divide-[var(--color-border)]">{children}</div>
      )}
    </div>
  );
}

/* ──────────────── Page ──────────────── */

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const lp = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [today, setToday] = useState('');

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setError(false);
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
    if (user) load();
    else setLoading(false);
    return () => {
      cancelled = true;
    };
  }, [user]);

  const accent = tenant?.brandPrimary || '#bd5a32';

  if (isLoading || loading) {
    return (
      <div className="flex items-center justify-center h-72">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="card-lux p-8 text-center">
        <p className="text-sm text-[var(--color-danger)]">{t('errorLoading')}</p>
      </div>
    );
  }

  const s = stats;
  const collectedPct = s.collections.total > 0 ? (s.collections.pagada / s.collections.total) * 100 : 0;
  const pendingPct = s.collections.total > 0 ? (s.collections.pendiente / s.collections.total) * 100 : 0;
  const overduePct = s.collections.total > 0 ? (s.collections.vencida / s.collections.total) * 100 : 0;

  const statusLabel: Record<string, string> = {
    Vencida: 'Vencida',
    Enviada: 'Enviada',
    Aprobada: 'Aprobada',
    Pendiente: 'Pendiente',
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-3">Centro de operaciones</p>
          <h1 className="h1">{t('welcome', { name: user?.firstName || '' })}</h1>
          {tenant?.name && <p className="mt-2 text-sm text-[var(--color-muted)]">{tenant.name}</p>}
        </div>
        {today && (
          <p className="text-sm text-[var(--color-muted)] first-letter:uppercase">{today}</p>
        )}
      </div>

      {/* Hero — rent roll + revenue trend */}
      <Reveal>
        <div className="card-lux overflow-hidden grid lg:grid-cols-[minmax(240px,0.9fr)_1.6fr]">
          <div className="p-7 lg:border-r border-[var(--color-border)] flex flex-col justify-center">
            <p className="micro">Renta mensual de cartera</p>
            <p className="font-display text-[clamp(2.4rem,4vw,3.4rem)] leading-none mt-3" style={{ color: accent }}>
              {fmt(s.monthlyRentRoll)}
            </p>
            <div className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <p className="numeric-xl text-[1.4rem]">{s.activeContracts}</p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">Contratos activos</p>
              </div>
              <div>
                <p className="numeric-xl text-[1.4rem]">{fmt(s.avgRent)}</p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">Alquiler promedio</p>
              </div>
              <div>
                <p className="numeric-xl text-[1.4rem]">{s.collections.rate}%</p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">Tasa de cobranza</p>
              </div>
            </div>
          </div>
          <div className="p-6 pt-7 min-h-[240px]">
            <div className="flex items-center justify-between mb-2">
              <p className="micro">Ingresos · últimos 6 meses</p>
              <div className="flex items-center gap-4 text-xs text-[var(--color-muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: accent }} /> Cobrado
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#d3c6ac]" /> Facturado
                </span>
              </div>
            </div>
            <div className="h-[190px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={s.revenueTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gCol" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={accent} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={accent} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#d3c6ac" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#d3c6ac" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#e4dac7" strokeDasharray="2 4" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#8a7e6d' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    formatter={(v, n) => [fmt(Number(v)), n === 'collected' ? 'Cobrado' : 'Facturado']}
                    contentStyle={{ borderRadius: 10, border: '1px solid #e4dac7', background: '#fbf8f1', fontSize: 12 }}
                    cursor={{ stroke: '#d3c6ac' }}
                  />
                  <Area type="monotone" dataKey="expected" stroke="#c9bca2" strokeWidth={1.5} fill="url(#gExp)" />
                  <Area type="monotone" dataKey="collected" stroke={accent} strokeWidth={2.5} fill="url(#gCol)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </Reveal>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Reveal delay={0}>
          <KpiTile
            label="Ocupación"
            value={`${s.occupancyRate}%`}
            accent={accent}
            context={`${s.occupiedUnits} ocupadas · ${s.vacantUnits} libres`}
          />
        </Reveal>
        <Reveal delay={1}>
          <KpiTile
            label="Cobrado este ciclo"
            value={fmtCompact(s.collections.pagada)}
            context={`${s.collections.rate}% de lo facturado`}
          />
        </Reveal>
        <Reveal delay={2}>
          <KpiTile
            label="Mora"
            value={fmtCompact(s.delinquency.overdueAmount)}
            accent={s.delinquency.overdueAmount > 0 ? '#b23a2b' : undefined}
            context={`${s.delinquency.rate}% de la cartera`}
          />
        </Reveal>
        <Reveal delay={3}>
          <KpiTile
            label="Tickets abiertos"
            value={String(s.tickets.open)}
            context={`${s.tickets.urgent} de prioridad alta`}
          />
        </Reveal>
      </div>

      {/* Lower grid: agenda (left) + composition & collections (right) */}
      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
        {/* Agenda */}
        <Reveal className="space-y-6">
          <SectionCard
            title="Requiere tu atención"
            action={<span className="micro">Próximos 90 días</span>}
          >
            <div className="space-y-5 min-h-[380px]">
              <AgendaGroup
                title="Vencimientos de contrato"
                count={s.agenda.expiring.length}
                href={`${lp}/contracts`}
                emptyText="Sin contratos por vencer en los próximos 90 días."
              >
                {s.agenda.expiring.slice(0, 3).map((c) => (
                  <AgendaRow
                    key={c.id}
                    href={`${lp}/contracts/${c.id}`}
                    title={c.property}
                    meta={c.tenant}
                    accent="#c58a2b"
                    right={
                      <span className="text-xs font-medium text-[#9a6b1f]">
                        vence en {c.daysLeft}d
                      </span>
                    }
                  />
                ))}
              </AgendaGroup>

              <AgendaGroup
                title="Cobranzas pendientes"
                count={s.agenda.collections.length}
                href={`${lp}/liquidaciones`}
                emptyText="No hay cobranzas pendientes."
              >
                {s.agenda.collections.slice(0, 3).map((c) => (
                  <AgendaRow
                    key={c.id}
                    href={`${lp}/liquidaciones`}
                    title={c.property}
                    meta={`${monthName(c.period)} · ${statusLabel[c.status] ?? c.status}`}
                    accent={c.status === 'Vencida' ? '#b23a2b' : '#c58a2b'}
                    right={<span className="text-sm font-medium tabular-nums">{fmt(c.amount)}</span>}
                  />
                ))}
              </AgendaGroup>

              <AgendaGroup
                title="Tickets prioritarios"
                count={s.agenda.tickets.length}
                href={`${lp}/tickets`}
                emptyText="No hay tickets abiertos."
              >
                {s.agenda.tickets.slice(0, 3).map((tk) => (
                  <AgendaRow
                    key={tk.id}
                    href={`${lp}/tickets/${tk.id}`}
                    title={tk.title}
                    meta={tk.property}
                    accent="#bd5a32"
                    right={<PriorityBadge priority={tk.priority} />}
                  />
                ))}
              </AgendaGroup>
            </div>
          </SectionCard>
        </Reveal>

        {/* Composition + collections */}
        <Reveal delay={1} className="space-y-6">
          <SectionCard title="Composición de cartera">
            <div className="flex items-center gap-5">
              <div className="h-[150px] w-[150px] shrink-0">
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
                      {s.propertiesByType.map((_, i) => (
                        <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v, n) => [`${v}`, String(n)]}
                      contentStyle={{ borderRadius: 10, border: '1px solid #e4dac7', background: '#fbf8f1', fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5 min-w-0">
                {s.propertiesByType.map((p, i) => (
                  <div key={p.type} className="flex items-center gap-2 text-sm">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }}
                    />
                    <span className="text-[var(--color-text)] truncate flex-1">{p.type}</span>
                    <span className="tabular-nums text-[var(--color-muted)]">{p.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Cobranzas">
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-[var(--color-muted)]">Cobrado</span>
                  <span className="font-medium tabular-nums">{fmt(s.collections.pagada)}</span>
                </div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
                  <span className="h-full bg-[#3d5f49]" style={{ width: `${collectedPct}%` }} />
                  <span className="h-full bg-[#c58a2b]" style={{ width: `${pendingPct}%` }} />
                  <span className="h-full bg-[#b23a2b]" style={{ width: `${overduePct}%` }} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                {[
                  { label: 'Cobrado', v: s.collections.pagada, c: '#3d5f49' },
                  { label: 'Pendiente', v: s.collections.pendiente, c: '#c58a2b' },
                  { label: 'Vencido', v: s.collections.vencida, c: '#b23a2b' },
                ].map((x) => (
                  <div key={x.label}>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: x.c }} />
                      <span className="text-xs text-[var(--color-muted)]">{x.label}</span>
                    </div>
                    <p className="text-sm font-medium tabular-nums mt-0.5">{fmtCompact(x.v)}</p>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </Reveal>
      </div>
    </div>
  );
}
