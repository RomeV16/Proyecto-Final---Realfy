'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PaymentMethod } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { parsePositiveAmount, today } from '@/lib/cash';
import { DEPOSIT_HOLDERS, DEPOSIT_KINDS, CURRENCIES, personName, type SalesDeposit, type SalesOperation } from '@/lib/sales';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { FieldsDialog, type FieldDef } from '@/components/ui/fields-dialog';
import { MoneyText } from '@/components/ui/money-text';
import { StatusBadge } from '@/components/ui/status-badge';
import { ExpiryBadge } from './expiry-badge';

type Action = { kind: 'add' } | { kind: 'receive' | 'refund' | 'forfeit' | 'extend'; deposit: SalesDeposit };

interface Props {
  op: SalesOperation;
  /** Puede cargar y recibir reservas y señas. */
  canManage: boolean;
  /** Puede devolver o retener dinero ya recibido. */
  canMoney: boolean;
  onChanged: () => void;
}

const METHODS = Object.values(PaymentMethod).filter((m) => m !== PaymentMethod.AplicacionDeposito);
const STAGES_TO_ADD = ['Publicada', 'Reservada', 'SenaRecibida'];

/** Reservas y señas de la operación: cuánto, quién guarda el dinero, vencimiento y las acciones según su estado. */
export function SalesDepositsSection({ op, canManage, canMoney, onChanged }: Props) {
  const t = useTranslations('sales.deposits');
  const [action, setAction] = useState<Action | null>(null);
  const live = (d: SalesDeposit) => d.status === 'Pendiente' || d.status === 'Recibida';

  const columns: DataTableColumn<SalesDeposit>[] = [
    { key: 'kind', header: t('columns.kind'), render: (d) => t(`kinds.${d.kind}`) },
    { key: 'amount', header: t('columns.amount'), alignRight: true, render: (d) => <MoneyText value={d.amount} currency={d.currency} decimals={2} /> },
    {
      key: 'holder',
      header: t('columns.holder'),
      render: (d) => (
        <div>
          <p>{t(`holders.${d.holder}`)}</p>
          {d.payerPerson && <p className="text-xs text-[var(--color-muted)]">{t('from', { name: personName(d.payerPerson) })}</p>}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (d) => (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge domain="sena" status={d.status} />
            <ExpiryBadge {...d} />
          </div>
          {d.receivedAt && (
            <p className="text-xs text-[var(--color-muted)]">
              {t('receivedOn')} <DateText value={d.receivedAt} />
            </p>
          )}
          {d.resolvedAt && (
            <p className="text-xs text-[var(--color-muted)]">
              {t('resolvedOn')} <DateText value={d.resolvedAt} />
              {d.resolvedAmount ? <> · <MoneyText value={d.resolvedAmount} currency={d.currency} decimals={2} /></> : null}
              {d.resolutionNote ? ` · ${d.resolutionNote}` : ''}
            </p>
          )}
          {d.unresolvedMoney && <p className="text-xs font-medium text-[var(--color-warning)]">{t('unresolved')}</p>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: t('columns.actions'),
      render: (d) => (
        <div className="flex flex-wrap gap-1.5">
          {canManage && d.status === 'Pendiente' && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setAction({ kind: 'receive', deposit: d })}>
              {t('actions.receive')}
            </Button>
          )}
          {canManage && live(d) && d.kind === 'Reserva' && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setAction({ kind: 'extend', deposit: d })}>
              {t('actions.extend')}
            </Button>
          )}
          {canMoney && d.unresolvedMoney && (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={() => setAction({ kind: 'refund', deposit: d })}>
                {t('actions.refund')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAction({ kind: 'forfeit', deposit: d })}>
                {t('actions.forfeit')}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const base = `/sales-operations/${op.id}/deposits`;
  const buyers = op.parties.filter((p) => p.role === 'Comprador');

  return (
    <section aria-labelledby="sales-deposits-title" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sales-deposits-title" className="text-base font-semibold text-[var(--color-text)]">
          {t('title')}
        </h2>
        {canManage && STAGES_TO_ADD.includes(op.status) && (
          <Button type="button" size="sm" onClick={() => setAction({ kind: 'add' })}>
            {t('add')}
          </Button>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--color-muted)]">{t('note')}</p>
      <div className="mt-3">
        <DataTable
          items={op.deposits}
          columns={columns}
          keyExtractor={(d) => d.id}
          empty={{ title: t('empty'), iconName: 'wallet' }}
        />
      </div>

      {action?.kind === 'add' && (
        <FieldsDialog
          title={t('dialog.addTitle')}
          fields={addFields(t, buyers.map((b) => ({ value: b.personId, label: personName(b.person) })))}
          initial={{ kind: 'Reserva', currency: op.currency, holder: 'Inmobiliaria' }}
          submitLabel={t('dialog.save')}
          successMessage={t('dialog.added')}
          errorFallback={t('dialog.error')}
          request={(v) =>
            apiClient(base, {
              method: 'POST',
              body: JSON.stringify({
                kind: v.kind,
                amount: parsePositiveAmount(v.amount),
                currency: v.currency,
                holder: v.holder,
                payerPersonId: v.payerPersonId || null,
                expiresAt: v.kind === 'Reserva' && v.expiresAt ? v.expiresAt : null,
                notes: v.notes || null,
              }),
            })
          }
          onClose={() => setAction(null)}
          onDone={onChanged}
        />
      )}
      {action?.kind === 'receive' && (
        <FieldsDialog
          title={t('dialog.receiveTitle')}
          description={t('dialog.receiveDescription', { holder: t(`holders.${action.deposit.holder}`) })}
          fields={[
            { name: 'receivedAt', label: t('dialog.date'), kind: 'date', required: true },
            methodField(t, action.deposit.holder === 'Inmobiliaria'),
            { name: 'note', label: t('dialog.note'), kind: 'text' },
          ]}
          initial={{ receivedAt: today(), method: 'Efectivo' }}
          submitLabel={t('dialog.confirm')}
          successMessage={t('dialog.received')}
          errorFallback={t('dialog.error')}
          request={(v) => apiClient(`${base}/${action.deposit.id}/receive`, { method: 'POST', body: JSON.stringify({ receivedAt: v.receivedAt, method: v.method || undefined, note: v.note || undefined }) })}
          onClose={() => setAction(null)}
          onDone={onChanged}
        />
      )}
      {(action?.kind === 'refund' || action?.kind === 'forfeit') && (
        <FieldsDialog
          title={t(`dialog.${action.kind}Title`)}
          description={t(`dialog.${action.kind}Description`)}
          fields={[
            { name: 'at', label: t('dialog.date'), kind: 'date', required: true },
            { name: 'amount', label: t('dialog.amountOptional'), kind: 'amount', hint: t('dialog.amountHint') },
            ...(action.kind === 'refund' ? [methodField(t, action.deposit.holder === 'Inmobiliaria')] : []),
            { name: 'note', label: t(action.kind === 'forfeit' ? 'dialog.reason' : 'dialog.note'), kind: 'textarea', required: action.kind === 'forfeit' },
          ]}
          initial={{ at: today(), method: 'Efectivo' }}
          submitLabel={t('dialog.confirm')}
          successMessage={t(`dialog.${action.kind}Done`)}
          errorFallback={t('dialog.error')}
          request={(v) =>
            apiClient(`${base}/${action.deposit.id}/${action.kind}`, {
              method: 'POST',
              body: JSON.stringify({ at: v.at, amount: v.amount || undefined, method: v.method || undefined, note: v.note || undefined }),
            })
          }
          onClose={() => setAction(null)}
          onDone={onChanged}
        />
      )}
      {action?.kind === 'extend' && (
        <FieldsDialog
          title={t('dialog.extendTitle')}
          fields={[{ name: 'expiresAt', label: t('dialog.expiresAt'), kind: 'date', required: true }]}
          initial={{ expiresAt: action.deposit.expiresAt?.slice(0, 10) ?? '' }}
          submitLabel={t('dialog.save')}
          successMessage={t('dialog.extended')}
          errorFallback={t('dialog.error')}
          request={(v) => apiClient(`${base}/${action.deposit.id}`, { method: 'PATCH', body: JSON.stringify({ expiresAt: v.expiresAt }) })}
          onClose={() => setAction(null)}
          onDone={onChanged}
        />
      )}
    </section>
  );
}

type T = ReturnType<typeof useTranslations>;

/** Cuenta por la que se mueve el dinero: solo si lo guarda la inmobiliaria. */
function methodField(t: T, agencyHolds: boolean): FieldDef {
  return {
    name: 'method',
    label: t('dialog.method'),
    kind: 'select',
    required: true,
    visible: () => agencyHolds,
    options: METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) })),
  };
}

function addFields(t: T, buyers: Array<{ value: string; label: string }>): FieldDef[] {
  return [
    { name: 'kind', label: t('dialog.kind'), kind: 'select', required: true, options: DEPOSIT_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) })) },
    { name: 'amount', label: t('dialog.amount'), kind: 'amount', required: true },
    { name: 'currency', label: t('dialog.currency'), kind: 'select', required: true, options: CURRENCIES.map((c) => ({ value: c, label: c })) },
    { name: 'holder', label: t('dialog.holder'), kind: 'select', required: true, hint: t('dialog.holderHint'), options: DEPOSIT_HOLDERS.map((h) => ({ value: h, label: t(`holders.${h}`) })) },
    { name: 'payerPersonId', label: t('dialog.payer'), kind: 'select', visible: () => buyers.length > 0, options: buyers },
    { name: 'expiresAt', label: t('dialog.expiresAt'), kind: 'date', hint: t('dialog.expiresHint'), visible: (v) => v.kind === 'Reserva' },
    { name: 'notes', label: t('dialog.note'), kind: 'textarea' },
  ];
}
