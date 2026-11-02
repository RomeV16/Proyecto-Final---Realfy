'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { custodyAccounts, deliverFormSchema, personLabel, today, type DeliverFormValues, type FinancialAccount } from '@/lib/cash';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from '@/lib/format';

interface Props {
  accounts: FinancialAccount[];
  loading: boolean;
  error: unknown;
  canManage: boolean;
  onChanged: () => void;
}

/** Efectivo que la inmobiliaria guarda para cada locador, con la entrega (todo o parte). */
export function CustodyPanel({ accounts, loading, error, canManage, onChanged }: Props) {
  const t = useTranslations('cash');
  const [delivering, setDelivering] = useState<FinancialAccount | null>(null);
  const items = custodyAccounts(accounts);

  const columns: DataTableColumn<FinancialAccount>[] = [
    {
      key: 'owner',
      header: t('custody.columns.owner'),
      render: (a) => <span className="font-medium text-[var(--color-text)]">{personLabel(a.owner) || a.name}</span>,
    },
    { key: 'account', header: t('custody.columns.account'), render: (a) => a.name },
    { key: 'currency', header: t('custody.columns.currency'), render: (a) => a.currency },
    {
      key: 'balance',
      header: t('custody.columns.balance'),
      alignRight: true,
      render: (a) => <MoneyText value={a.balance} currency={a.currency} decimals={2} className="tabular-nums" />,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: t('custody.columns.actions'),
            render: (a: FinancialAccount) => (
              <Button type="button" size="sm" disabled={Number(a.balance) <= 0} onClick={() => setDelivering(a)}>
                {t('custody.deliver')}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <section className="space-y-5" aria-labelledby="cash-custody-title">
      <div>
        <h2 id="cash-custody-title" className="text-base font-semibold text-[var(--color-text)]">
          {t('custody.title')}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('custody.subtitle')}</p>
      </div>
      <DataTable
        items={items}
        columns={columns}
        keyExtractor={(a) => a.id}
        loading={loading}
        error={error}
        empty={{ title: t('custody.empty.title'), subtitle: t('custody.empty.subtitle'), iconName: 'wallet' }}
      />
      {delivering && <DeliverDialog account={delivering} onClose={() => setDelivering(null)} onDone={onChanged} />}
    </section>
  );
}

function DeliverDialog({ account, onClose, onDone }: { account: FinancialAccount; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('cash');
  const tCommon = useTranslations('common');
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: deliverFormSchema,
    initialValues: { amount: account.balance, date: today(), note: '' } satisfies DeliverFormValues,
    translate: useSchemaMessages(),
  });
  const owner = personLabel(account.owner) || account.name;

  const save = submit(async (body) => {
    const res = await apiClient<{ balance: string }>(`/custody/${account.id}/deliver`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    toast.success(t('custody.delivered', { balance: formatMoney(res?.balance ?? '0', account.currency, { decimals: 2 }) }));
    onDone();
    onClose();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting} size="md">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('custody.dialogTitle', { owner })}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError != null && <ErrorNotice error={formError} fallback={t('custody.deliverError')} />}
          <p className="text-sm text-[var(--color-muted)]">
            {t('custody.available')}{' '}
            <MoneyText value={account.balance} currency={account.currency} decimals={2} className="font-semibold text-[var(--color-text)]" />
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={t('custody.amount', { currency: account.currency })} hint={t('custody.amountHint')} error={errors.amount}>
              {(c) => <Input {...c} inputMode="decimal" value={values.amount} onChange={(e) => set('amount', e.target.value)} />}
            </FormField>
            <FormField label={t('custody.date')} error={errors.date} required>
              {(c) => <Input {...c} type="date" value={values.date} onChange={(e) => set('date', e.target.value)} />}
            </FormField>
          </div>
          <FormField label={t('movements.form.note')} error={errors.note}>
            {(c) => <Textarea {...c} rows={2} value={values.note} onChange={(e) => set('note', e.target.value)} />}
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('saving') : t('custody.confirmDeliver')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
