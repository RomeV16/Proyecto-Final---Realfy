'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { EntityRow } from '@/components/ui/entity-card';
import { RowList } from '@/components/ui/card-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile, StatTileSkeleton } from '@/components/ui/stat-tile';
import { Icon } from '@/components/ui/icon';

interface Payment {
  id: string;
  amount: string;
  currency: string;
  method: string;
  paidAt: string;
  liquidacion?: { period?: string };
}
interface Debt {
  pendiente: { count: number; monto: number };
  vencida: { count: number; monto: number };
}

const money = (n: number | string) =>
  '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });

const periodLabel = (iso?: string) => {
  if (!iso) return '—';
  const s = new Date(iso).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const METHOD_LABELS: Record<string, string> = {
  Transferencia: 'Transferencia bancaria',
  Efectivo: 'Efectivo',
  MercadoPago: 'Mercado Pago',
  Cheque: 'Cheque',
};

export default function PagosPage() {
  const t = useTranslations('payments');
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [debt, setDebt] = useState<Debt | null>(null);
  const [debtLoading, setDebtLoading] = useState(true);

  useEffect(() => {
    apiClient<{ items: Payment[] }>('/payments?limit=30')
      .then((r) => setPayments(r.items))
      .catch(() => setPayments([]));
    apiClient<Debt>('/payments/debt')
      .then(setDebt)
      .catch(() => setDebt(null))
      .finally(() => setDebtLoading(false));
  }, []);

  const totalCollected = (payments || []).reduce((acc, p) => acc + Number(p.amount || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">{t('title')}</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </div>

      {/* Debt snapshot — the two numbers the screen exists to answer */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {debtLoading ? (
          <>
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
          </>
        ) : (
          <>
            <StatTile
              label={t('pendingDebt')}
              value={money(debt?.pendiente.monto ?? 0)}
              icon="clock"
              tone="warning"
              hint={`${debt?.pendiente.count ?? 0} ${t('settlements')}`}
            />
            <StatTile
              label={t('overdueDebt')}
              value={money(debt?.vencida.monto ?? 0)}
              icon="alert"
              tone="danger"
              hint={`${debt?.vencida.count ?? 0} ${t('settlements')}`}
            />
            <StatTile
              label={t('collected')}
              value={money(totalCollected)}
              icon="wallet"
              tone="success"
              hint={t('collectedHint', { count: payments?.length ?? 0 })}
            />
          </>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="h3">{t('recentPayments')}</h2>

        <RowList
          items={payments || []}
          loading={payments === null}
          skeletonCount={4}
          keyOf={(p) => p.id}
          renderItem={(p) => (
            <EntityRow
              accent="success"
              leading={
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                  style={{
                    backgroundColor:
                      'color-mix(in oklab, var(--color-success) 14%, var(--color-surface))',
                    color: 'var(--color-success)',
                  }}
                >
                  <Icon name="check" className="h-5 w-5" strokeWidth={2} />
                </span>
              }
              title={periodLabel(p.liquidacion?.period)}
              subtitle={METHOD_LABELS[p.method] ?? p.method}
              meta={
                <EntityRow.Meta
                  items={[
                    {
                      icon: 'calendar',
                      label: new Date(p.paidAt).toLocaleDateString('es-AR', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      }),
                    },
                  ]}
                />
              }
              trailing={<EntityRow.Amount value={money(p.amount)} hint={p.currency} tone="success" />}
            />
          )}
          empty={
            <EmptyState
              iconName="wallet"
              title={t('noPayments')}
              subtitle={t('noPaymentsSubtitle')}
            />
          }
        />
      </div>
    </div>
  );
}
