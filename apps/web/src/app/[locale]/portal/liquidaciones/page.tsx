'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { portalApiClient, getPortalAccessToken } from '@/lib/portal-api-client';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { EntityCard } from '@/components/ui/entity-card';
import { CardGrid } from '@/components/ui/card-grid';
import { EmptyState } from '@/components/ui/empty-state';

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

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

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

const LIMIT = 10;

export default function PortalLiquidacionesPage() {
  const t = useTranslations();
  const [page, setPage] = useState(1);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<PaginatedResponse>({
    queryKey: ['portal', 'liquidaciones', page],
    queryFn: () =>
      portalApiClient<PaginatedResponse>(`/portal/liquidaciones?page=${page}&limit=${LIMIT}`),
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
      const res = await fetch(`${API_BASE_URL}/portal/liquidaciones/${id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
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

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const from = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const to = Math.min(page * LIMIT, total);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <p className="eyebrow mb-2">{t('portal.common.brand')}</p>
        <h1 className="h2">{t('portal.liquidaciones.title')}</h1>
        <p className="lead mt-2 text-sm">{t('portal.liquidaciones.subtitle')}</p>
      </div>

      {isError ? (
        <EmptyState iconName="alert" title={t('common.error')} subtitle={t('portal.common.error')} />
      ) : (
        <CardGrid
          items={items}
          loading={isLoading}
          columns={2}
          skeletonCount={4}
          skeletonMedia={false}
          keyOf={(liq) => liq.id}
          renderItem={(liq) => {
            const overdue = liq.status === 'Overdue';
            const paid = liq.status === 'Paid';
            const property =
              liq.contract.property?.address ||
              liq.contract.property?.name ||
              t('portal.dashboard.unknownProperty');

            return (
              <EntityCard accent={overdue ? 'danger' : paid ? 'success' : 'none'}>
                <EntityCard.Cover
                  seed={liq.id}
                  icon="liquidaciones"
                  band
                  topRight={
                    <span className="inline-flex items-center rounded-full border border-white/25 bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md">
                      {statusLabel(liq.status)}
                    </span>
                  }
                />
                <EntityCard.Body>
                  <EntityCard.Title>{formatPeriod(liq.period)}</EntityCard.Title>
                  <EntityCard.Subtitle>{property}</EntityCard.Subtitle>
                  <EntityCard.Meta
                    items={[
                      {
                        icon: 'calendarClock',
                        label: `${t('portal.liquidaciones.dueDate')} ${formatDate(liq.dueDate)}`,
                      },
                      ...(liq._count.payments > 0
                        ? [
                            {
                              icon: 'check' as const,
                              label: t('portal.liquidaciones.paymentsCount', {
                                count: liq._count.payments,
                              }),
                            },
                          ]
                        : []),
                    ]}
                  />
                  {overdue && (
                    <EntityCard.Alert tone="danger" icon="alert">
                      {t('portal.liquidaciones.overdueAlert')}
                    </EntityCard.Alert>
                  )}
                </EntityCard.Body>
                <EntityCard.Footer>
                  <EntityCard.Amount
                    value={formatCurrency(liq.total)}
                    hint={t('portal.liquidaciones.totalToPay')}
                    tone={overdue ? 'danger' : 'default'}
                  />
                  <EntityCard.Actions>
                    <EntityCard.Action
                      icon={downloadingId === liq.id ? undefined : 'download'}
                      variant="ghost"
                      onClick={() => handleDownload(liq.id)}
                      disabled={downloadingId === liq.id}
                    >
                      {downloadingId === liq.id && <Spinner className="h-3.5 w-3.5" />}
                      {t('portal.liquidaciones.downloadPdf')}
                    </EntityCard.Action>
                  </EntityCard.Actions>
                </EntityCard.Footer>
              </EntityCard>
            );
          }}
          empty={
            <EmptyState
              iconName="liquidaciones"
              title={t('portal.liquidaciones.empty')}
              subtitle={t('portal.liquidaciones.emptySubtitle')}
            />
          }
        />
      )}

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <p className="micro">{t('portal.liquidaciones.showing', { from, to, total })}</p>
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
    </div>
  );
}
