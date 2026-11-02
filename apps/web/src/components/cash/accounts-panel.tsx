'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FinancialAccountKind } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { personLabel, type AccountsResponse, type FinancialAccount } from '@/lib/cash';
import { toast } from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ErrorNotice } from '@/components/ui/error-notice';
import { MoneyText } from '@/components/ui/money-text';
import { AccountForm } from './account-form';
import { useErrorText } from './use-cash-data';

interface Props {
  data: AccountsResponse | null;
  error: unknown;
  /** Puede dar de alta, renombrar y dar de baja cuentas (Administración y Gerencia). */
  canAccounts: boolean;
  onChanged: () => void;
}

const KIND_BADGE: Record<string, 'info' | 'brand' | 'warning'> = {
  [FinancialAccountKind.Caja]: 'brand',
  [FinancialAccountKind.Banco]: 'info',
  [FinancialAccountKind.Custodia]: 'warning',
};

/** Totales por moneda y la lista de cuentas con su saldo. */
export function AccountsPanel({ data, error, canAccounts, onChanged }: Props) {
  const t = useTranslations('cash');
  const confirm = useConfirm();
  const errorText = useErrorText();
  const [editing, setEditing] = useState<FinancialAccount | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleActive(account: FinancialAccount) {
    const deactivate = account.isActive;
    if (deactivate) {
      const ok = await confirm({
        title: t('accounts.confirmDeactivate.title'),
        body: t('accounts.confirmDeactivate.body', { name: account.name }),
        confirmLabel: t('accounts.deactivate'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    setBusyId(account.id);
    try {
      await apiClient(`/financial-accounts/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !deactivate }),
      });
      toast.success(deactivate ? t('accounts.deactivated') : t('accounts.activated'));
      onChanged();
    } catch (err) {
      toast.error(errorText(err, t('actionError')));
    } finally {
      setBusyId(null);
    }
  }

  const columns: DataTableColumn<FinancialAccount>[] = [
    {
      key: 'name',
      header: t('accounts.columns.name'),
      render: (a) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-[var(--color-text)]">{a.name}</span>
          {!a.isActive && <Badge variant="neutral">{t('accounts.inactive')}</Badge>}
        </div>
      ),
    },
    {
      key: 'kind',
      header: t('accounts.columns.kind'),
      render: (a) => <Badge variant={KIND_BADGE[a.kind] ?? 'neutral'}>{t(`kinds.${a.kind}`)}</Badge>,
    },
    { key: 'currency', header: t('accounts.columns.currency'), render: (a) => a.currency },
    { key: 'owner', header: t('accounts.columns.owner'), render: (a) => personLabel(a.owner) || '—' },
    {
      key: 'balance',
      header: t('accounts.columns.balance'),
      alignRight: true,
      render: (a) => <MoneyText value={a.balance} currency={a.currency} decimals={2} className="tabular-nums" />,
    },
    ...(canAccounts
      ? [
          {
            key: 'actions',
            header: t('accounts.columns.actions'),
            render: (a: FinancialAccount) => (
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(a)}>
                  {t('accounts.rename')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busyId === a.id}
                  onClick={() => void toggleActive(a)}
                >
                  {a.isActive ? t('accounts.deactivate') : t('accounts.activate')}
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <section className="space-y-5" aria-labelledby="cash-accounts-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="cash-accounts-title" className="text-base font-semibold text-[var(--color-text)]">
          {t('accounts.title')}
        </h2>
        {canAccounts && (
          <Button type="button" onClick={() => setEditing('new')}>
            {t('accounts.add')}
          </Button>
        )}
      </div>

      {error != null && <ErrorNotice error={error} fallback={t('loadError')} />}

      {data && data.totals.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.totals.map((total) => (
              <div
                key={total.currency}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                aria-label={t('totals.label', { currency: total.currency })}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">{total.currency}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-text)]">
                  <MoneyText value={total.total} currency={total.currency} decimals={2} />
                </p>
                <dl className="mt-2 space-y-0.5 text-xs text-[var(--color-muted)]">
                  <div className="flex justify-between gap-2">
                    <dt>{t('totals.agency')}</dt>
                    <dd className="tabular-nums">
                      <MoneyText value={total.agency} currency={total.currency} decimals={2} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>{t('totals.custody')}</dt>
                    <dd className="tabular-nums">
                      <MoneyText value={total.custody} currency={total.currency} decimals={2} />
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            {data.custodyInAgencyBalance ? t('totals.includesCustody') : t('totals.excludesCustody')}
          </p>
        </div>
      )}

      {error == null && (
        <DataTable
          items={data?.items ?? []}
          columns={columns}
          keyExtractor={(a) => a.id}
          loading={data === null}
          empty={{
            title: t('accounts.empty.title'),
            subtitle: t('accounts.empty.subtitle'),
            iconName: 'wallet',
          }}
        />
      )}

      {editing !== null && (
        <AccountForm
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
    </section>
  );
}
