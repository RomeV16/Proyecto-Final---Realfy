'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { portalApiClient } from '@/lib/portal-api-client';
import { usePortalAuth } from '@/lib/portal-auth-context';
import { EntityCard } from '@/components/ui/entity-card';
import { CardGrid } from '@/components/ui/card-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';

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
  const month = MONTHS_ES[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : period;
}

const STATUS_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  Draft: 'neutral',
  Pending: 'warning',
  Sent: 'info',
  Paid: 'success',
  PartiallyPaid: 'info',
  Overdue: 'danger',
  Cancelled: 'neutral',
};

export default function PortalDashboardPage() {
  const t = useTranslations();
  const { person } = usePortalAuth();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const { data, isLoading } = useQuery<PaginatedResponse>({
    queryKey: ['portal', 'liquidaciones', 1],
    queryFn: () => portalApiClient<PaginatedResponse>('/portal/liquidaciones?page=1&limit=4'),
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
    return label === key ? status : label;
  };

  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <p className="eyebrow mb-2">{t('portal.common.brand')}</p>
        <h1 className="h2">{t('portal.dashboard.greeting', { name: person?.firstName || '' })}</h1>
        <p className="lead mt-2 text-sm">{t('portal.liquidaciones.subtitle')}</p>
      </div>

      <CardGrid
        items={items}
        loading={isLoading}
        columns={2}
        skeletonCount={2}
        skeletonMedia={false}
        keyOf={(liq) => liq.id}
        renderItem={(liq) => {
          const overdue = liq.status === 'Overdue';
          const property =
            liq.contract.property?.address ||
            liq.contract.property?.name ||
            t('portal.dashboard.unknownProperty');

          return (
            <EntityCard accent={overdue ? 'danger' : 'none'}>
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
                    href={`${localePrefix}/portal/liquidaciones`}
                    icon="arrowRight"
                    variant="ghost"
                  >
                    {t('portal.liquidaciones.viewDetail')}
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

      {items.length > 0 && (
        <Link
          href={`${localePrefix}/portal/liquidaciones`}
          className="link-underline mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)]"
        >
          {t('portal.liquidaciones.title')}
          <Icon name="arrowRight" className="h-4 w-4" strokeWidth={2} />
        </Link>
      )}
    </div>
  );
}
