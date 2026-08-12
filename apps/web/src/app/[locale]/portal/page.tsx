'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { portalApiClient } from '@/lib/portal-api-client';
import { usePortalAuth } from '@/lib/portal-auth-context';

interface PortalLiquidacion {
  id: string;
  period: string;
  status: string;
  total: number;
  dueDate: string | null;
  contract: {
    id: string;
    property: {
      id: string;
      name: string | null;
      address: string | null;
    } | null;
  };
  _count: { payments: number };
}

interface PaginatedResponse {
  items: PortalLiquidacion[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function PortalDashboardPage() {
  const t = useTranslations();
  const { person } = usePortalAuth();

  const { data, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['portal', 'liquidaciones', 1],
    queryFn: () =>
      portalApiClient<PaginatedResponse>('/portal/liquidaciones?page=1&limit=10'),
  });

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(dateStr));
  };

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">
          {t('portal.dashboard.greeting', { name: person?.firstName || '' })}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('portal.dashboard.subtitle')}
        </p>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 animate-pulse">
          <div className="h-4 bg-slate-200 rounded w-3/4 mb-3" />
          <div className="h-3 bg-slate-200 rounded w-1/2" />
        </div>
      ) : data && data.items.length > 0 ? (
        <div className="space-y-3">
          {data.items.map((liq) => (
            <div
              key={liq.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-900 truncate">
                    {liq.contract.property?.address ||
                      liq.contract.property?.name ||
                      t('portal.dashboard.unknownProperty')}
                  </h2>
                  <p className="text-sm text-slate-500 mt-0.5">{liq.period}</p>
                </div>
                <span className="text-base font-semibold text-slate-900 shrink-0">
                  {formatCurrency(liq.total)}
                </span>
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="text-sm text-slate-500">
                  {t('portal.dashboard.dueDate')}
                </span>
                <span className="text-sm text-slate-700">
                  {formatDate(liq.dueDate)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-500">
            {t('portal.dashboard.noLiquidaciones')}
          </p>
        </div>
      )}
    </div>
  );
}
