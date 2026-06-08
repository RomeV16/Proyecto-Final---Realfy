import { useTranslations } from 'next-intl';

interface KpiCard {
  key: string;
  value: string;
  hint: string;
}

/**
 * Datos de muestra (mock) para el panel inicial. Se reemplazan por datos reales
 * de la API en items posteriores.
 */
const MOCK_KPIS: KpiCard[] = [
  { key: 'occupancy', value: '87%', hint: '+4% vs. mes anterior' },
  { key: 'activeContracts', value: '124', hint: '12 vencen este mes' },
  { key: 'monthlyCollections', value: '$ 8.4M', hint: '92% cobrado' },
];

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </div>
  );
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tStats = useTranslations('dashboard.stats');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MOCK_KPIS.map((kpi) => (
          <StatCard
            key={kpi.key}
            label={tStats(kpi.key)}
            value={kpi.value}
            hint={kpi.hint}
          />
        ))}
      </div>
    </div>
  );
}
