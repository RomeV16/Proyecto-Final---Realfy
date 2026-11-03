'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { parsePositiveAmount } from '@/lib/cash';
import type { FeeProposal, SalesOperation } from '@/lib/sales';
import { Button } from '@/components/ui/button';
import { FieldsDialog } from '@/components/ui/fields-dialog';
import { MoneyText } from '@/components/ui/money-text';
import { StatusBadge } from '@/components/ui/status-badge';

interface Props {
  op: SalesOperation;
  /** Administración: propone y crea el honorario. */
  canManage: boolean;
  onChanged: () => void;
}

const FEE_STAGES = ['Reservada', 'SenaRecibida', 'Boleto', 'Escriturada'];

/** Honorario de la venta: cada parte paga el porcentaje por defecto según el tipo de inmueble; el cobro está en Honorarios. */
export function SalesFeeSection({ op, canManage, onChanged }: Props) {
  const t = useTranslations('sales.fee');
  const [open, setOpen] = useState(false);
  const live = op.fees.filter((f) => f.status !== 'Anulado');
  const canPropose = canManage && live.length === 0 && FEE_STAGES.includes(op.status);
  const proposal = useQuery({
    queryKey: ['sales-operation', op.id, 'fee-proposal'],
    queryFn: () => apiClient<FeeProposal>(`/sales-operations/${op.id}/fee-proposal`),
    enabled: canPropose && open,
  });

  return (
    <section aria-labelledby="sales-fee-title" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sales-fee-title" className="text-base font-semibold text-[var(--color-text)]">
          {t('title')}
        </h2>
        {canPropose && (
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            {t('agree')}
          </Button>
        )}
      </div>
      {live.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-muted)]">{FEE_STAGES.includes(op.status) ? t('none') : t('notYet')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] text-sm">
          {live.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <span className="text-[var(--color-text)]">{t(`roles.${f.payerRole}`)}</span>
              {f.pct && <span className="text-xs text-[var(--color-muted)]">{Number(f.pct)} %</span>}
              <MoneyText value={f.total} currency={f.currency} decimals={2} className="tabular-nums" />
              <StatusBadge domain="honorario" status={f.status} className="ml-auto" />
            </li>
          ))}
        </ul>
      )}

      {open && proposal.data && (
        <FieldsDialog
          title={t('dialog.title')}
          description={t('dialog.description', {
            pct: Number(proposal.data.pct),
            asset: t(`assets.${proposal.data.saleAsset}`),
          })}
          fields={[
            { name: 'pct', label: t('dialog.pct'), kind: 'amount', required: true },
            { name: 'baseAmount', label: t('dialog.base', { currency: proposal.data.currency }), kind: 'amount', required: true },
            { name: 'installments', label: t('dialog.installments'), kind: 'number', required: true },
            { name: 'firstDueDate', label: t('dialog.firstDue'), kind: 'date', required: true },
          ]}
          initial={{
            pct: String(Number(proposal.data.pct)),
            baseAmount: proposal.data.baseAmount ?? '',
            installments: '1',
            firstDueDate: proposal.data.firstDueDate,
          }}
          submitLabel={t('dialog.confirm')}
          successMessage={t('dialog.done')}
          errorFallback={t('dialog.error')}
          request={(v) =>
            apiClient(`/sales-operations/${op.id}/fee`, {
              method: 'POST',
              body: JSON.stringify({
                pct: v.pct,
                baseAmount: parsePositiveAmount(v.baseAmount),
                installments: Number(v.installments),
                firstDueDate: v.firstDueDate,
              }),
            })
          }
          onClose={() => setOpen(false)}
          onDone={onChanged}
        />
      )}
    </section>
  );
}
