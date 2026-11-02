'use client';

import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { OWNER_CURRENCIES, openingBalanceFormSchema, parseSignedAmount, type OpeningBalanceFormValues } from '@/lib/owner-accounts';
import { formatMoney } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  personId: string;
  personName: string;
  currency: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Saldo inicial de un locador en una moneda (lo que arrastraba del sistema
 * anterior). Se confirma mostrando el importe y el motivo, que queda en la
 * auditoría; si ya está en un estado emitido, la API lo rechaza.
 */
export function OpeningBalanceDialog({ personId, personName, currency, onClose, onDone }: Props) {
  const t = useTranslations('ownerAccounts.opening');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: openingBalanceFormSchema,
    initialValues: { currency, amount: '', date: '', reason: '' } satisfies OpeningBalanceFormValues,
    translate: useSchemaMessages(),
  });

  const save = submit(async (body) => {
    const amount = formatMoney(parseSignedAmount(values.amount) ?? '0', values.currency, { decimals: 2 });
    const ok = await confirm({
      title: t('confirmTitle'),
      body: (
        <div className="space-y-2">
          <p>{t('confirmBody', { name: personName, amount })}</p>
          <p className="text-[var(--color-muted)]">{t('confirmReason', { reason: values.reason.trim() })}</p>
        </div>
      ),
      confirmLabel: t('confirmLabel'),
    });
    if (!ok) return;
    await apiClient(`/owners/${personId}/opening-balance`, { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('done'));
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
          <p className="text-sm text-[var(--color-muted)]">{t('explain')}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label={t('currency')} error={errors.currency} required>
              {(c) => (
                <Select {...c} value={values.currency} onChange={(e) => set('currency', e.target.value)}>
                  {OWNER_CURRENCIES.map((cur) => (
                    <option key={cur} value={cur}>
                      {cur}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('amount')} hint={t('amountHint')} error={errors.amount} required>
              {(c) => <Input {...c} inputMode="decimal" value={values.amount} onChange={(e) => set('amount', e.target.value)} />}
            </FormField>
            <FormField label={t('date')} hint={t('dateHint')} error={errors.date}>
              {(c) => <Input {...c} type="date" value={values.date} onChange={(e) => set('date', e.target.value)} />}
            </FormField>
          </div>
          <FormField label={t('reason')} hint={t('reasonHint')} error={errors.reason} required>
            {(c) => <Textarea {...c} rows={2} value={values.reason} onChange={(e) => set('reason', e.target.value)} />}
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
