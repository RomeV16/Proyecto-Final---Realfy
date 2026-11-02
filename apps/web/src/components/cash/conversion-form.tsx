'use client';

import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import {
  agencyAccounts,
  conversionFormSchema,
  convertedAmount,
  today,
  type ConversionFormValues,
  type FinancialAccount,
} from '@/lib/cash';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  accounts: FinancialAccount[];
  onClose: () => void;
  onSaved: () => void;
}

/** Conversión de moneda entre dos cuentas de la inmobiliaria con un tipo de cambio explícito. */
export function ConversionForm({ accounts, onClose, onSaved }: Props) {
  const t = useTranslations('cash');
  const tCommon = useTranslations('common');
  const options = agencyAccounts(accounts);
  const { values, set, setValues, errors, formError, submitting, submit } = useZodForm({
    schema: conversionFormSchema,
    initialValues: {
      fromAccountId: options[0]?.id ?? '',
      toAccountId: '',
      date: today(),
      amount: '',
      rate: '',
      note: '',
    } satisfies ConversionFormValues,
    translate: useSchemaMessages(),
  });

  const source = options.find((a) => a.id === values.fromAccountId);
  // Solo se convierte a una cuenta de otra moneda.
  const targets = options.filter((a) => a.currency !== source?.currency);
  const target = targets.find((a) => a.id === values.toAccountId);
  const result = convertedAmount(values.amount, values.rate);

  const save = submit(async (body) => {
    await apiClient('/cash-movements/conversion', { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('conversion.saved'));
    onSaved();
    onClose();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting} size="md">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('conversion.title')}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError != null && <ErrorNotice error={formError} fallback={t('conversion.saveError')} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={t('conversion.from')} error={errors.fromAccountId} required>
              {(c) => (
                <Select
                  {...c}
                  value={values.fromAccountId}
                  onChange={(e) => setValues({ fromAccountId: e.target.value, toAccountId: '' })}
                >
                  {options.length === 0 && <option value="">{t('movements.form.chooseAccount')}</option>}
                  {options.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('conversion.to')} error={errors.toAccountId} required>
              {(c) => (
                <Select {...c} value={values.toAccountId} onChange={(e) => set('toAccountId', e.target.value)}>
                  <option value="">{t('movements.form.chooseAccount')}</option>
                  {targets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label={t('conversion.amount', { currency: source?.currency ?? '' })} error={errors.amount} required>
              {(c) => (
                <Input {...c} inputMode="decimal" value={values.amount} onChange={(e) => set('amount', e.target.value)} />
              )}
            </FormField>
            <FormField label={t('conversion.rate')} hint={t('conversion.rateHint')} error={errors.rate} required>
              {(c) => <Input {...c} inputMode="decimal" value={values.rate} onChange={(e) => set('rate', e.target.value)} />}
            </FormField>
            <FormField label={t('conversion.date')} error={errors.date} required>
              {(c) => <Input {...c} type="date" value={values.date} onChange={(e) => set('date', e.target.value)} />}
            </FormField>
          </div>
          <p className="rounded-lg bg-[var(--color-surface-sunken)] px-3 py-2 text-sm text-[var(--color-text)]" aria-live="polite">
            {result !== null && target ? (
              <>
                {t('conversion.result')}{' '}
                <MoneyText value={result} currency={target.currency} decimals={2} className="font-semibold tabular-nums" />
              </>
            ) : (
              t('conversion.resultPending')
            )}
          </p>
          <FormField label={t('movements.form.note')} error={errors.note}>
            {(c) => <Textarea {...c} rows={2} value={values.note} onChange={(e) => set('note', e.target.value)} />}
          </FormField>
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
