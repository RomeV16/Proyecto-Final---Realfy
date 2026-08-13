'use client';

import { useTranslations } from 'next-intl';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { ResponsiveTable, Column } from '@/components/ui/responsive-table';
import { EntityRow, Badge } from '@/components/ui/entity-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile, StatTileSkeleton } from '@/components/ui/stat-tile';
import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';

interface DelinquentTenant {
  personId: string;
  fullName: string;
  propertyId?: string;
  propertyLabel?: string;
  totalDebt: string;
  totalPenalty: string;
  daysOverdueMax: number;
}

function formatCurrency(value: string | number) {
  return Number(value).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Severity buckets — the same thresholds drive the badge and the accent bar. */
function severityOf(days: number): { tone: 'danger' | 'warning' | 'info'; key: string } {
  if (days >= 30) return { tone: 'danger', key: 'severe' };
  if (days >= 10) return { tone: 'warning', key: 'moderate' };
  return { tone: 'info', key: 'early' };
}

export default function DelinquencyPage() {
  const t = useTranslations('delinquency');
  const { user } = useAuth();

  const [items, setItems] = useState<DelinquentTenant[]>([]);
  const [loading, setLoading] = useState(true);

  const canAccess = ['Admin', 'Gerente'].includes(user?.role || '');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient<DelinquentTenant[]>('/penalties/delinquent-tenants');
      setItems(data);
    } catch (err) {
      if (err instanceof ApiRequestError) toast.error(err.message);
      else toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (canAccess) load();
    else setLoading(false);
  }, [canAccess, load]);

  if (!canAccess) {
    return (
      <EmptyState iconName="delinquency" title={t('forbidden')} subtitle={t('forbiddenHint')} />
    );
  }

  const totalDebt = items.reduce((acc, i) => acc + Number(i.totalDebt || 0), 0);
  const totalPenalty = items.reduce((acc, i) => acc + Number(i.totalPenalty || 0), 0);
  const severeCount = items.filter((i) => i.daysOverdueMax >= 30).length;

  const columns: Column<DelinquentTenant>[] = [
    {
      key: 'name',
      header: t('colName'),
      render: (item) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={item.fullName} seed={item.personId} size="sm" />
          <span className="font-medium text-[var(--color-text)]">{item.fullName}</span>
        </div>
      ),
    },
    {
      key: 'property',
      header: t('colProperty'),
      render: (item) => (
        <span className="text-[var(--color-muted)]">{item.propertyLabel ?? '—'}</span>
      ),
    },
    {
      key: 'debt',
      header: t('colDebt'),
      alignRight: true,
      render: (item) => (
        <span className="tabular-nums text-[var(--color-text)]">
          ${formatCurrency(item.totalDebt)}
        </span>
      ),
    },
    {
      key: 'penalty',
      header: t('colPenalty'),
      alignRight: true,
      render: (item) => (
        <span className="tabular-nums text-[var(--color-danger)]">
          ${formatCurrency(item.totalPenalty)}
        </span>
      ),
    },
    {
      key: 'days',
      header: t('colDays'),
      render: (item) => {
        const severity = severityOf(item.daysOverdueMax);
        return (
          <Badge variant={severity.tone} dot>
            {t('daysOverdue', { days: item.daysOverdueMax })}
          </Badge>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">{t('description')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}>
          <Icon name="refresh" className="h-4 w-4" strokeWidth={2} />
          {t('refresh')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {loading ? (
          <>
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
          </>
        ) : (
          <>
            <StatTile
              label={t('totalDebt')}
              value={`$${formatCurrency(totalDebt)}`}
              icon="wallet"
              tone="danger"
              hint={t('tenantCount', { count: items.length })}
            />
            <StatTile
              label={t('accruedPenalty')}
              value={`$${formatCurrency(totalPenalty)}`}
              icon="percent"
              tone="warning"
            />
            <StatTile
              label={t('severeCount')}
              value={severeCount}
              icon="alert"
              tone={severeCount > 0 ? 'danger' : 'success'}
              hint={t('severeHint')}
            />
          </>
        )}
      </div>

      <ResponsiveTable<DelinquentTenant>
        items={items}
        columns={columns}
        keyExtractor={(item) => `${item.personId}-${item.propertyId}`}
        loading={loading}
        skeletonRows={5}
        empty={{
          iconName: 'check',
          title: t('emptyTitle'),
          subtitle: t('emptyDescription'),
        }}
        cardRenderer={(item) => {
          const severity = severityOf(item.daysOverdueMax);
          return (
            <EntityRow
              accent={severity.tone}
              leading={<Avatar name={item.fullName} seed={item.personId} size="md" />}
              title={item.fullName}
              subtitle={item.propertyLabel ?? '—'}
              meta={
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={severity.tone} dot>
                    {t('daysOverdue', { days: item.daysOverdueMax })}
                  </Badge>
                  <Badge variant="neutral">
                    {t('colPenalty')} ${formatCurrency(item.totalPenalty)}
                  </Badge>
                </div>
              }
              trailing={
                <EntityRow.Amount
                  value={`$${formatCurrency(item.totalDebt)}`}
                  hint={t('colDebt')}
                  tone="danger"
                />
              }
            />
          );
        }}
      />
    </div>
  );
}
