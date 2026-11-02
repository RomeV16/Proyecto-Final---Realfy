'use client';

import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { agencyAccounts, today } from '@/lib/cash';
import { PAYOUT_METHODS, payoutFormSchema, type PayoutFormValues } from '@/lib/owner-accounts';
import { formatMoney } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useCashAccounts } from '@/components/cash/use-cash-data';

interface Props {
  personId: string;
  personName: string;
  currency: string;
  /** Importe propuesto (lo pendiente de pagarle); vacío si no hay. */
  suggested: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Pago al locador desde una cuenta de la inmobiliaria (transferencia o entrega
 * de efectivo): un egreso en la caja o el banco y el asiento que baja su saldo.
 */
export function PayoutDialog({ personId, personName, currency, suggested, onClose, onDone }: Props) {
  const t = useTranslations('ownerAccounts.payout');
  const tCommon = useTranslations('common');
  const accounts = useCashAccounts(true);
  const options = agencyAccounts(accounts.data?.items ?? [], currency);
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: payoutFormSchema,
    initialValues: { accountId: '', method: PAYOUT_METHODS[0], amount: suggested, date: today(), note: '' } satisfies PayoutFormValues,
    translate: useSchemaMessages(),
  });

  const save = submit(async (body) => {
    const res = await apiClient<{ balance: string }>(`/owners/${personId}/payouts`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    toast.success(t('done', { balance: formatMoney(res?.balance ?? '0', currency, { decimals: 2 }) }));
    onDone();
    onClose();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting} size="md">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title', { name: personName })}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError != null && <ErrorNotice error={formError} fallback={t('error')} />}
          <p className="text-sm text-[var(--color-muted)]">{t('explain', { currency })}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={t('account')} error={errors.accountId} required>
              {(c) => (
                <Select {...c} value={values.accountId} onChange={(e) => set('accountId', e.target.value)}>
                  <option value="">{t('accountPlaceholder')}</option>
                  {options.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('method')} error={errors.method} required>
              {(c) => (
                <Select {...c} value={values.method} onChange={(e) => set('method', e.target.value)}>
                  {PAYOUT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`methods.${m}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('amount', { currency })} error={errors.amount} required>
              {(c) => <Input {...c} inputMode="decimal" value={values.amount} onChange={(e) => set('amount', e.target.value)} />}
            </FormField>
            <FormField label={t('date')} error={errors.date} required>
              {(c) => <Input {...c} type="date" value={values.date} onChange={(e) => set('date', e.target.value)} />}
            </FormField>
          </div>
          {accounts.data !== null && options.length === 0 && <p className="text-sm text-[var(--color-warning)]">{t('noAccounts', { currency })}</p>}
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
