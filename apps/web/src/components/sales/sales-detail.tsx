'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api-client';
import { parsePositiveAmount, today } from '@/lib/cash';
import { useCan } from '@/lib/permissions';
import { orderedTransitions, partiesOf, placeOf, type SalesOperation } from '@/lib/sales';
import { Button } from '@/components/ui/button';
import { DateText } from '@/components/ui/date-text';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FieldsDialog, type FieldDef } from '@/components/ui/fields-dialog';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { SalesDepositsSection } from './sales-deposits-section';
import { SalesDocsSection } from './sales-docs-section';
import { SalesFeeSection } from './sales-fee-section';
import { SalesPartiesDialog } from './sales-parties-dialog';

const OPEN = ['Captacion', 'Publicada', 'Reservada', 'SenaRecibida', 'Boleto'];

/** Una operación de venta: etapa y cambios de etapa, partes, reservas y señas, documentación y honorario. */
export function SalesDetail({ id }: { id: string }) {
  const t = useTranslations('sales');
  const canView = useCan('sales.view');
  const canManage = useCan('sales.manage');
  const canMoney = useCan('sales.money');
  const queryClient = useQueryClient();
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [editingParties, setEditingParties] = useState(false);
  const query = useQuery({
    queryKey: ['sales-operation', id],
    queryFn: () => apiClient<SalesOperation>(`/sales-operations/${id}`),
    enabled: canView,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['sales-operation', id] });
    void queryClient.invalidateQueries({ queryKey: ['sales'] });
  };

  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.error || !query.data) return <ErrorNotice error={query.error} fallback={t('detail.loadError')} />;
  const op = query.data;
  const open = OPEN.includes(op.status);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link href="/ventas" className="text-sm text-[var(--color-muted)] underline-offset-2 hover:underline">
          {t('detail.back')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">{placeOf(op.property)}</h1>
          <StatusBadge domain="venta" status={op.status} size="md" />
          {op.exclusive && <span className="text-sm text-[var(--color-muted)]">{t('exclusive')}</span>}
        </div>
        <Link href={`/properties/${op.propertyId}`} className="text-sm text-brand-600 underline-offset-2 hover:underline">
          {t('detail.viewProperty')}
        </Link>
      </header>

      <section aria-label={t('detail.summary')} className="grid grid-cols-1 gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:grid-cols-4">
        <Fact label={t('detail.price')}>{op.price ? <MoneyText value={op.price} currency={op.currency} decimals={0} /> : '—'}</Fact>
        <Fact label={t('detail.agreedPrice')}>{op.agreedPrice ? <MoneyText value={op.agreedPrice} currency={op.currency} decimals={0} /> : '—'}</Fact>
        <Fact label={t('detail.boletoDate')}>{op.boletoDate ? <DateText value={op.boletoDate} /> : '—'}</Fact>
        <Fact label={t('detail.escrituraDate')}>{op.escrituraDate ? <DateText value={op.escrituraDate} /> : '—'}</Fact>
        {op.cancelReason && <Fact label={t('detail.cancelReason')}>{op.cancelReason}</Fact>}
      </section>

      {canManage && open && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('detail.moveTo')}>
          {orderedTransitions(op.validTransitions).map((to) => (
            <Button key={to} type="button" variant={to === 'Cancelada' ? 'danger' : 'secondary'} size="sm" onClick={() => setMoveTo(to)}>
              {t(`transitions.${to}`)}
            </Button>
          ))}
        </div>
      )}

      <section aria-labelledby="sales-parties-title" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sales-parties-title" className="text-base font-semibold text-[var(--color-text)]">
            {t('parties.title')}
          </h2>
          {canManage && open && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditingParties(true)}>
              {t('parties.edit')}
            </Button>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {(['Vendedor', 'Comprador'] as const).map((role) => (
            <div key={role}>
              <dt className="text-xs text-[var(--color-muted)]">{t(`parties.roles.${role}`)}</dt>
              <dd className="font-medium text-[var(--color-text)]">{partiesOf(op, role) || t('parties.none')}</dd>
            </div>
          ))}
        </dl>
      </section>

      <SalesDepositsSection op={op} canManage={canManage} canMoney={canMoney} onChanged={refresh} />
      <SalesDocsSection op={op} canManage={canManage} onChanged={refresh} />
      <SalesFeeSection op={op} canManage={canMoney} onChanged={refresh} />

      {moveTo && (
        <FieldsDialog
          title={t('transitionDialog.title', { to: t(`statuses.${moveTo}`) })}
          description={t(`transitionDialog.descriptions.${moveTo}`)}
          fields={transitionFields(t, moveTo, op)}
          initial={{ boletoDate: today(), escrituraDate: today() }}
          submitLabel={t('transitionDialog.confirm')}
          successMessage={t('transitionDialog.done')}
          errorFallback={t('transitionDialog.error')}
          request={(v) =>
            apiClient(`/sales-operations/${op.id}/transition`, {
              method: 'POST',
              body: JSON.stringify({
                to: moveTo,
                reason: v.reason || undefined,
                boletoDate: v.boletoDate || undefined,
                escrituraDate: v.escrituraDate || undefined,
                agreedPrice: v.agreedPrice ? parsePositiveAmount(v.agreedPrice) : undefined,
                docsOverrideReason: v.docsOverrideReason || undefined,
              }),
            })
          }
          onClose={() => setMoveTo(null)}
          onDone={refresh}
        />
      )}
      {editingParties && (
        <SalesPartiesDialog operationId={op.id} parties={op.parties} onClose={() => setEditingParties(false)} onDone={refresh} />
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
      <p className="font-medium text-[var(--color-text)]">{children}</p>
    </div>
  );
}

type T = ReturnType<typeof useTranslations>;

/** Datos que cada cambio de etapa pide. */
function transitionFields(t: T, to: string, op: SalesOperation): FieldDef[] {
  const agreedPrice: FieldDef = { name: 'agreedPrice', label: t('transitionDialog.agreedPrice'), kind: 'amount' };
  if (to === 'Reservada') return [agreedPrice];
  if (to === 'Boleto') {
    const missing = op.docProgress.requiredDone < op.docProgress.requiredTotal;
    return [
      { name: 'boletoDate', label: t('transitionDialog.boletoDate'), kind: 'date', required: true },
      agreedPrice,
      ...(missing
        ? [{ name: 'docsOverrideReason', label: t('transitionDialog.docsOverride'), kind: 'textarea' as const, hint: t('transitionDialog.docsOverrideHint') }]
        : []),
    ];
  }
  if (to === 'Escriturada') return [{ name: 'escrituraDate', label: t('transitionDialog.escrituraDate'), kind: 'date', required: true }];
  if (to === 'Cancelada') return [{ name: 'reason', label: t('transitionDialog.reason'), kind: 'textarea', required: true }];
  return [];
}
