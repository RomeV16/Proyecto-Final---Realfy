'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Currency, CreatePersonBankAccountSchema, UpdatePersonBankAccountSchema } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { orNull, partyFormSchema } from './party-forms';
import type { BankAccount } from './parties';

interface AccountValues {
  currency: string;
  bankName: string;
  cbu: string;
  alias: string;
  holder: string;
  isDefault: boolean;
}

const EMPTY: AccountValues = { currency: 'ARS', bankName: '', cbu: '', alias: '', holder: '', isDefault: false };

function toValues(a: BankAccount): AccountValues {
  return {
    currency: a.currency,
    bankName: a.bankName ?? '',
    cbu: a.cbu ?? '',
    alias: a.alias ?? '',
    holder: a.holder ?? '',
    isDefault: a.isDefault,
  };
}

function AccountDialog({
  personId,
  account,
  onClose,
  onSaved,
}: {
  personId: string;
  /** `null` crea una cuenta nueva; con una cuenta la edita. */
  account: BankAccount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('parties.bankAccounts');
  const tCommon = useTranslations('common');
  const editing = account !== null;
  const initial = account ? toValues(account) : EMPTY;
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: partyFormSchema<Record<string, unknown>>(
      editing ? UpdatePersonBankAccountSchema : CreatePersonBankAccountSchema,
      (v: AccountValues) => ({
        ...(editing ? {} : { currency: v.currency }),
        bankName: orNull(v.bankName),
        cbu: orNull(v.cbu),
        alias: orNull(v.alias),
        holder: orNull(v.holder),
        // Solo se manda cuando cambia: un `false` sobre la predeterminada la API lo rechaza.
        ...(v.isDefault !== initial.isDefault || !editing ? { isDefault: v.isDefault } : {}),
      }),
    ),
    initialValues: initial,
    translate: useSchemaMessages(),
  });

  const save = submit(async (body) => {
    if (editing) {
      await apiClient(`/persons/${personId}/bank-accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      await apiClient(`/persons/${personId}/bank-accounts`, { method: 'POST', body: JSON.stringify(body) });
    }
    toast.success(t('saved'));
    onSaved();
    onClose();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting}>
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{editing ? t('editTitle') : t('addTitle')}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError != null && <ErrorNotice error={formError} fallback={t('saveError')} />}
          <FormField label={t('fields.currency')} error={errors.currency} hint={editing ? t('currencyFixed') : undefined}>
            {(c) => (
              <Select {...c} value={values.currency} disabled={editing} onChange={(e) => set('currency', e.target.value)}>
                {Object.values(Currency).map((cur) => (
                  <option key={cur} value={cur}>
                    {cur}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t('fields.bankName')} error={errors.bankName}>
            {(c) => <Input {...c} value={values.bankName} onChange={(e) => set('bankName', e.target.value)} />}
          </FormField>
          <FormField label={t('fields.cbu')} error={errors.cbu}>
            {(c) => (
              <Input
                {...c}
                inputMode="numeric"
                maxLength={22}
                value={values.cbu}
                onChange={(e) => set('cbu', e.target.value.replace(/\D/g, '').slice(0, 22))}
              />
            )}
          </FormField>
          <FormField label={t('fields.alias')} error={errors.alias}>
            {(c) => <Input {...c} value={values.alias} onChange={(e) => set('alias', e.target.value)} />}
          </FormField>
          <FormField label={t('fields.holder')} error={errors.holder}>
            {(c) => <Input {...c} value={values.holder} onChange={(e) => set('holder', e.target.value)} />}
          </FormField>
          <label className="flex items-start gap-2 text-sm text-[var(--color-text)]">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={values.isDefault}
              onChange={(e) => set('isDefault', e.target.checked)}
            />
            <span>
              {t('fields.isDefault')}
              <span className="block text-xs text-[var(--color-muted)]">{t('defaultHint')}</span>
            </span>
          </label>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('saving') : tCommon('save')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** Cuentas bancarias de una persona: una predeterminada por moneda, que no se puede dejar sin cuenta. */
export function PersonBankAccounts({ personId, canEdit }: { personId: string; canEdit: boolean }) {
  const t = useTranslations('parties.bankAccounts');
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<{ account: BankAccount | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiClient<BankAccount[]>(`/persons/${personId}/bank-accounts`);
      setAccounts(Array.isArray(data) ? data : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }, [personId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(err);
    }
  }

  async function remove(account: BankAccount) {
    const ok = await confirm({
      title: t('deleteTitle'),
      body: t('deleteBody', { name: account.alias || account.bankName || account.currency }),
      confirmLabel: t('delete'),
      tone: 'danger',
    });
    if (ok) await run(() => apiClient(`/persons/${personId}/bank-accounts/${account.id}`, { method: 'DELETE' }));
  }

  const columns: DataTableColumn<BankAccount>[] = [
    {
      key: 'currency',
      header: t('fields.currency'),
      render: (a) => (
        <span className="flex items-center gap-2">
          {a.currency}
          {a.isDefault && <Badge variant="brand">{t('default')}</Badge>}
        </span>
      ),
    },
    { key: 'bank', header: t('fields.bankName'), render: (a) => a.bankName || '—' },
    { key: 'cbu', header: t('fields.cbu'), render: (a) => <span className="tabular-nums">{a.cbu || '—'}</span> },
    { key: 'alias', header: t('fields.alias'), render: (a) => a.alias || '—' },
    { key: 'holder', header: t('fields.holder'), render: (a) => a.holder || '—' },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: t('actions'),
            render: (a: BankAccount) => (
              <span className="flex flex-wrap gap-1">
                <Button variant="ghost" size="sm" onClick={() => setDialog({ account: a })} aria-label={t('editFor', { name: a.alias || a.currency })}>
                  {t('edit')}
                </Button>
                {!a.isDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void run(() =>
                        apiClient(`/persons/${personId}/bank-accounts/${a.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ isDefault: true }),
                        }),
                      )
                    }
                    aria-label={t('makeDefaultFor', { name: a.alias || a.currency })}
                  >
                    {t('makeDefault')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => void remove(a)} aria-label={t('deleteFor', { name: a.alias || a.currency })}>
                  {t('delete')}
                </Button>
              </span>
            ),
          } satisfies DataTableColumn<BankAccount>,
        ]
      : []),
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="person-accounts-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="person-accounts-title" className="text-base font-semibold text-slate-900">
          {t('title')}
        </h3>
        {canEdit && (
          <Button size="sm" variant="secondary" onClick={() => setDialog({ account: null })}>
            {t('add')}
          </Button>
        )}
      </div>
      {actionError != null && <ErrorNotice error={actionError} className="mb-3" />}
      <DataTable
        columns={columns}
        items={accounts ?? []}
        keyExtractor={(a) => a.id}
        loading={accounts === null && loadError == null}
        error={loadError}
        empty={{ title: t('empty'), iconName: 'contracts' }}
      />
      {dialog && (
        <AccountDialog personId={personId} account={dialog.account} onClose={() => setDialog(null)} onSaved={() => void load()} />
      )}
    </section>
  );
}
