'use client';

import { useTranslations } from 'next-intl';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { ResponsiveTable, Column } from '@/components/ui/responsive-table';

interface DelinquentTenant {
  personId: string;
  fullName: string;
  propertyId?: string;
  propertyLabel?: string;
  totalDebt: string;
  totalPenalty: string;
  daysOverdueMax: number;
}

function formatCurrency(value: string) {
  return parseFloat(value).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h2 className="text-lg font-semibold text-slate-900">{t('forbidden')}</h2>
      </div>
    );
  }

  const columns: Column<DelinquentTenant>[] = [
    {
      key: 'name',
      header: t('colName'),
      render: (item) => <span className="font-medium text-[var(--color-text)]">{item.fullName}</span>,
    },
    {
      key: 'property',
      header: t('colProperty'),
      render: (item) => <span className="text-[var(--color-muted)]">{item.propertyLabel ?? '—'}</span>,
    },
    {
      key: 'debt',
      header: t('colDebt'),
      alignRight: true,
      render: (item) => <span className="tabular-nums text-[var(--color-text)]">${formatCurrency(item.totalDebt)}</span>,
    },
    {
      key: 'penalty',
      header: t('colPenalty'),
      alignRight: true,
      render: (item) => <span className="tabular-nums text-[var(--color-danger)]">${formatCurrency(item.totalPenalty)}</span>,
    },
    {
      key: 'days',
      header: t('colDays'),
      render: (item) => (
        <span className={`font-medium ${item.daysOverdueMax >= 30 ? 'text-[var(--color-danger)]' : 'text-amber-600'}`}>
          {item.daysOverdueMax}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('description')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}>
          {t('refresh')}
        </Button>
      </div>

      <ResponsiveTable<DelinquentTenant>
        items={items}
        columns={columns}
        keyExtractor={(item) => `${item.personId}-${item.propertyId}`}
        loading={loading}
        skeletonRows={5}
        empty={{
          title: t('emptyTitle'),
          subtitle: t('emptyDescription'),
        }}
        cardRenderer={(item) => (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">{item.fullName}</p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5">{item.propertyLabel ?? '—'}</p>
              </div>
              <span className={`text-xs font-medium ${item.daysOverdueMax >= 30 ? 'text-[var(--color-danger)]' : 'text-amber-600'}`}>
                {item.daysOverdueMax}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-[var(--color-muted)]">{t('colDebt')}</p>
                <p className="font-semibold tabular-nums text-[var(--color-text)]">${formatCurrency(item.totalDebt)}</p>
              </div>
              <div>
                <p className="text-[var(--color-muted)]">{t('colPenalty')}</p>
                <p className="font-semibold tabular-nums text-[var(--color-danger)]">${formatCurrency(item.totalPenalty)}</p>
              </div>
            </div>
          </div>
        )}
      />
    </div>
  );
}
