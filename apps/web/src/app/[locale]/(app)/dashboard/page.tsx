'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/api-client';
import { useEffect, useState } from 'react';
import { Reveal } from '@/components/ui/reveal';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface TenantData {
  id: string;
  name: string;
  cuit: string;
  brandPrimary?: string;
  brandSecondary?: string;
  logoUrl?: string;
}

interface DashboardStats {
  occupancyRate: number;
  totalProperties: number;
  activeContracts: number;
  expiringContracts: {
    within30: number;
    within60: number;
    within90: number;
  };
  collections: {
    pagada: number;
    pendiente: number;
    vencida: number;
    total: number;
  };
  pendingLiquidaciones: number;
  totalServices: number;
}

function StatCard({
  label,
  value,
  suffix,
  accentColor,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  accentColor: string;
}) {
  return (
    <div className="card-lux p-5">
      <p className="micro">{label}</p>
      <p className="numeric-xl mt-3" style={{ color: accentColor }}>
        {value}{suffix && <span className="text-xl ml-0.5 align-top">{suffix}</span>}
      </p>
    </div>
  );
}

function ExpiringBadge({
  label,
  count,
  variant,
}: {
  label: string;
  count: number;
  variant: 'red' | 'yellow' | 'green';
}) {
  const colorMap = {
    red: 'bg-red-50 text-red-700 border-red-200',
    yellow: 'bg-amber-50 text-amber-700 border-amber-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };

  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${colorMap[variant]}`}>
      <span className="text-2xl font-bold tabular-nums">{count}</span>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

function CollectionCard({
  label,
  amount,
  variant,
}: {
  label: string;
  amount: number;
  variant: 'green' | 'yellow' | 'red';
}) {
  const colorMap = {
    green: 'border-l-emerald-500 bg-emerald-50/50',
    yellow: 'border-l-amber-500 bg-amber-50/50',
    red: 'border-l-red-500 bg-red-50/50',
  };

  return (
    <div className={`rounded-lg border border-slate-200 border-l-4 p-4 ${colorMap[variant]}`}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-xl font-bold mt-1 tabular-nums text-slate-900">
        {formatCurrency(amount)}
      </p>
    </div>
  );
}

function OccupancyDonut({ value, color }: { value: number; color: string }) {
  const data = [
    { name: 'occupied', value: Math.max(0, Math.min(100, value)) },
    { name: 'free', value: Math.max(0, 100 - value) },
  ];
  return (
    <div className="relative h-52">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius="68%"
            outerRadius="90%"
            startAngle={90}
            endAngle={-270}
            stroke="none"
          >
            <Cell fill={color} />
            <Cell fill="#e4dac7" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-4xl font-bold tabular-nums" style={{ color }}>
          {value}
          <span className="text-xl">%</span>
        </span>
      </div>
    </div>
  );
}

function CollectionsChart({
  data,
}: {
  data: { name: string; value: number; fill: string }[];
}) {
  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip
            formatter={(value) => formatCurrency(Number(value))}
            cursor={{ fill: '#f1f5f9' }}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function EmptyCard({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group block bg-white rounded-xl border border-slate-200 p-6 hover:border-brand-300 hover:shadow-md hover:shadow-brand-500/5 transition-all duration-200"
    >
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center shrink-0 group-hover:bg-brand-100 transition-colors">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 group-hover:text-brand-600 transition-colors">
            {title}
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">{description}</p>
        </div>
      </div>
    </Link>
  );
}

function IconPlus() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tEmpty = useTranslations('dashboard.emptyState');
  const tEmptyHelp = useTranslations('dashboard.empty');
  const tStats = useTranslations('dashboard.stats');
  const tExpiring = useTranslations('dashboard.expiringContracts');
  const tCollections = useTranslations('dashboard.collections');
  const tCharts = useTranslations('dashboard.charts');
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [tenantLoading, setTenantLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadTenant() {
      try {
        const data = await apiClient<TenantData>('/tenants/me');
        if (!cancelled) {
          setTenant(data);
        }
      } catch {
        // If tenant fetch fails, continue with defaults
      } finally {
        if (!cancelled) setTenantLoading(false);
      }
    }
    if (user) loadTenant();
    else setTenantLoading(false);
    return () => { cancelled = true; };
  }, [user, router, localePrefix]);

  useEffect(() => {
    let cancelled = false;
    async function loadStats() {
      try {
        setStatsError(false);
        const data = await apiClient<DashboardStats>('/dashboard/stats');
        if (!cancelled) {
          setStats(data);
        }
      } catch {
        if (!cancelled) setStatsError(true);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }
    if (user && !tenantLoading && tenant) {
      loadStats();
    } else {
      setStatsLoading(false);
    }
    return () => { cancelled = true; };
  }, [user, tenantLoading, tenant]);

  if (isLoading || tenantLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const accentColor = tenant?.brandPrimary || '#bd5a32';
  const isEmpty = stats?.totalProperties === 0;

  return (
    <div className="space-y-8">
      {/* Welcome header */}
      <div className="flex items-end justify-between gap-4 pb-2">
        <div>
          <p className="eyebrow mb-3">Panel general</p>
          <h1 className="h1">
            {t('welcome', { name: user?.firstName || '' })}
          </h1>
          {tenant?.name && (
            <p className="mt-2 text-[var(--color-muted)] text-sm">
              {tenant.name}
            </p>
          )}
        </div>
      </div>

      {/* Quick stats — 5 cards */}
      {statsLoading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full" />
          <span className="ml-3 text-sm text-slate-500">{t('loading')}</span>
        </div>
      ) : statsError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-sm text-red-600">{t('errorLoading')}</p>
          <button
            onClick={() => { setStatsLoading(true); setStatsError(false); }}
            className="mt-2 text-sm text-red-700 underline hover:no-underline"
          >
            {t('retry')}
          </button>
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <Reveal delay={0}>
              <StatCard
                label={tStats('properties')}
                value={stats.totalProperties}
                accentColor={accentColor}
              />
            </Reveal>
            <Reveal delay={1}>
              <StatCard
                label={tStats('activeContracts')}
                value={stats.activeContracts}
                accentColor={accentColor}
              />
            </Reveal>
            <Reveal delay={2}>
              <StatCard
                label={tStats('occupancyRate')}
                value={stats.occupancyRate}
                suffix="%"
                accentColor={accentColor}
              />
            </Reveal>
            <Reveal delay={3}>
              <StatCard
                label={tStats('pendingLiquidaciones')}
                value={stats.pendingLiquidaciones}
                accentColor={accentColor}
              />
            </Reveal>
            <Reveal delay={4}>
              <StatCard
                label={tStats('services')}
                value={stats.totalServices}
                accentColor={accentColor}
              />
            </Reveal>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-2">
                {tCharts('occupancy')}
              </h2>
              <OccupancyDonut value={stats.occupancyRate} color={accentColor} />
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-2">
                {tCharts('collections')}
              </h2>
              <CollectionsChart
                data={[
                  {
                    name: tCollections('pagada'),
                    value: stats.collections.pagada,
                    fill: '#3d5f49',
                  },
                  {
                    name: tCollections('pendiente'),
                    value: stats.collections.pendiente,
                    fill: '#c58a2b',
                  },
                  {
                    name: tCollections('vencida'),
                    value: stats.collections.vencida,
                    fill: '#b23a2b',
                  },
                ]}
              />
            </div>
          </div>

          {/* Expiring contracts section */}
          <div>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              {tExpiring('title')}
            </h2>
            {stats.expiringContracts.within90 === 0 ? (
              <p className="text-sm text-slate-500">{tExpiring('noExpiring')}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <ExpiringBadge
                  label={tExpiring('within30')}
                  count={stats.expiringContracts.within30}
                  variant="red"
                />
                <ExpiringBadge
                  label={tExpiring('within60')}
                  count={stats.expiringContracts.within60}
                  variant="yellow"
                />
                <ExpiringBadge
                  label={tExpiring('within90')}
                  count={stats.expiringContracts.within90}
                  variant="green"
                />
              </div>
            )}
          </div>

          {/* Collection status section */}
          <div>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              {tCollections('title')}
            </h2>
            {stats.collections.total === 0 ? (
              <p className="text-sm text-slate-500">{tCollections('noCollections')}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <CollectionCard
                  label={tCollections('pagada')}
                  amount={stats.collections.pagada}
                  variant="green"
                />
                <CollectionCard
                  label={tCollections('pendiente')}
                  amount={stats.collections.pendiente}
                  variant="yellow"
                />
                <CollectionCard
                  label={tCollections('vencida')}
                  amount={stats.collections.vencida}
                  variant="red"
                />
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* Empty state prompts — only when there are no properties */}
      {isEmpty && (
        <div>
          <h2 className="text-lg font-semibold text-slate-900 mb-1">
            {tEmpty('title')}
          </h2>
          <p className="text-sm text-slate-500 mb-2">
            {tEmpty('subtitle')}
          </p>
          <p className="text-sm text-slate-500 mb-4 max-w-lg">
            {tEmptyHelp('description')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <EmptyCard
              title={tEmpty('addProperty')}
              description={tEmpty('addPropertyDesc')}
              href={`${localePrefix}/properties`}
              icon={<IconPlus />}
            />
            <EmptyCard
              title={tEmpty('addPerson')}
              description={tEmpty('addPersonDesc')}
              href={`${localePrefix}/persons`}
              icon={<IconPlus />}
            />
          </div>
        </div>
      )}
    </div>
  );
}
