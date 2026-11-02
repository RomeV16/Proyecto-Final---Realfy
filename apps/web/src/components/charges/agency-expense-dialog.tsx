'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { agencyAccounts, today } from '@/lib/cash';
import type { PendingChargeRow } from '@/lib/charges';
import { toast } from '@/lib/toast';
import { useZodForm, type FormSchema } from '@/hooks/use-zod-form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCashAccounts } from '@/components/cash/use-cash-data';

interface Values {
  accountId: string;
  date: string;
  note: string;
}

interface Props {
  charge: PendingChargeRow;
  onClose: () => void;
  onDone: () => void;
}

/** Cierra un gasto a cargo de la inmobiliaria como egreso de una de sus cuentas. */
export function AgencyExpenseDialog({ charge, onClose, onDone }: Props) {
  const t = useTranslations('charges.agencyExpense');
  const tCommon = useTranslations('common');
  const accounts = useCashAccounts(true);
  const options = agencyAccounts(accounts.data?.items ?? [], charge.currency);

  const schema: FormSchema<Record<string, unknown>> = {
    safeParse(input) {
      const v = input as Values;
      if (!v.accountId) return { success: false, error: { issues: [{ path: ['accountId'], message: t('accountRequired') }] } };
      return {
        success: true,
        data: { accountId: v.accountId, ...(v.date ? { date: v.date } : {}), ...(v.note.trim() ? { note: v.note.trim() } : {}) },
      };
    },
  };

  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema,
    initialValues: { accountId: '', date: today(), note: '' } satisfies Values,
  });

  // Con las cuentas a la vista se propone la primera de la moneda del gasto.
  const firstId = options[0]?.id ?? '';
  useEffect(() => {
    if (firstId && !values.accountId) set('accountId', firstId);
  }, [firstId, values.accountId, set]);

  const save = submit(async (body) => {
    await apiClient(`/charges/${charge.id}/agency-expense`, { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('done'));
    onDone();
    onClose();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting} size="md">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-[var(--color-muted)]">
            {t('body', { description: charge.description })}{' '}
            <MoneyText value={charge.amount} currency={charge.currency} className="font-semibold text-[var(--color-text)]" />
          </p>
          {accounts.error != null && <ErrorNotice error={accounts.error} fallback={t('accountsError')} />}
          {formError != null && <ErrorNotice error={formError} fallback={t('error')} />}
          {accounts.data && options.length === 0 && (
            <p className="text-sm text-[var(--color-muted)]">{t('noAccounts', { currency: charge.currency })}</p>
          )}
          <FormField label={t('account')} error={errors.accountId} required>
            {(c) => (
              <Select {...c} value={values.accountId} onChange={(e) => set('accountId', e.target.value)}>
                <option value="">{t('chooseAccount')}</option>
                {options.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t('date')} hint={t('dateHint')} error={errors.date}>
            {(c) => <Input {...c} type="date" value={values.date} onChange={(e) => set('date', e.target.value)} />}
          </FormField>
          <FormField label={t('note')} error={errors.note}>
            {(c) => <Textarea {...c} rows={2} value={values.note} onChange={(e) => set('note', e.target.value)} />}
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('saving') : t('confirm')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
