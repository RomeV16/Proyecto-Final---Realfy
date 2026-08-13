'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { portalApiClient, getPortalAccessToken } from '@/lib/portal-api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

interface PortalLiquidacion {
  id: string;
  period: string;
  status: string;
  total: number | string;
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

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

const MONTHS_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

function formatPeriod(period: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(period);
  if (!match) return period;
  const year = match[1];
  const monthIdx = Number(match[2]) - 1;
  const month = MONTHS_ES[monthIdx];
  return month ? `${month} ${year}` : period;
}

const STATUS_VARIANT: Record<
  string,
  'neutral' | 'success' | 'warning' | 'danger' | 'info'
> = {
  Draft: 'neutral',
  Pending: 'warning',
  Sent: 'info',
  Paid: 'success',
  PartiallyPaid: 'info',
  Overdue: 'danger',
  Cancelled: 'neutral',
};

const LIMIT = 10;

export default function PortalLiquidacionesPage() {
  const t = useTranslations();
  const [page, setPage] = useState(1);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<PaginatedResponse>({
    queryKey: ['portal', 'liquidaciones', page],
    queryFn: () =>
      portalApiClient<PaginatedResponse>(
        `/portal/liquidaciones?page=${page}&limit=${LIMIT}`,
      ),
  });

  const formatCurrency = (amount: number | string) =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(typeof amount === 'string' ? Number(amount) : amount);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(dateStr));
  };

  const statusLabel = (status: string) => {
    const key = `portal.liquidaciones.status.${status}`;
    const label = t(key as Parameters<typeof t>[0]);
    // If the key is missing, next-intl returns the raw key path — fall back to raw status.
    return label === key ? status : label;
  };

  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    try {
      const token = getPortalAccessToken();
      const res = await fetch(
        `${API_BASE_URL}/portal/liquidaciones/${id}/pdf`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      if (!res.ok) throw new Error('download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `liquidacion-${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Silent failure — user can retry.
    } finally {
      setDownloadingId(null);
    }
  };

  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const from = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const to = Math.min(page * LIMIT, total);

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-6">
        <p className="eyebrow mb-2">{t('portal.common.brand')}</p>
        <h1 className="h2">{t('portal.liquidaciones.title')}</h1>
        <p className="lead mt-2 text-sm">{t('portal.liquidaciones.subtitle')}</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : isError ? (
        <div className="card-lux p-6 text-center">
          <p className="text-sm text-[var(--color-muted)]">
            {t('common.error')}
          </p>
        </div>
      ) : data && data.items.length > 0 ? (
        <>
          <div className="space-y-3">
            {data.items.map((liq) => (
              <div key={liq.id} className="card-lux p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-[var(--color-text)]">
                      {formatPeriod(liq.period)}
                    </p>
                    <p className="text-sm text-[var(--color-muted)] mt-0.5 truncate">
                      {liq.contract.property?.address ||
                        liq.contract.property?.name ||
                        t('portal.dashboard.unknownProperty')}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[liq.status] ?? 'neutral'}>
                    {statusLabel(liq.status)}
                  </Badge>
                </div>

                <div className="mt-4 pt-4 border-t border-[var(--color-border)] flex items-end justify-between gap-3">
                  <div>
                    <p className="micro">Total a pagar</p>
                    <p className="text-lg font-semibold text-[var(--color-text)] tabular-nums">
                      {formatCurrency(liq.total)}
                    </p>
                    <p className="micro mt-1">
                      {t('portal.liquidaciones.dueDate')} {formatDate(liq.dueDate)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleDownload(liq.id)}
                    disabled={downloadingId === liq.id}
                  >
                    {downloadingId === liq.id && (
                      <Spinner className="w-4 h-4" />
                    )}
                    {t('portal.liquidaciones.downloadPdf')}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <p className="micro">
                {t('portal.liquidaciones.showing', { from, to, total })}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  {t('portal.liquidaciones.prev')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages}
                >
                  {t('portal.liquidaciones.next')}
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card-lux p-8 text-center">
          <p className="text-sm text-[var(--color-muted)]">
            {t('portal.liquidaciones.empty')}
          </p>
        </div>
      )}
    </div>
  );
}
