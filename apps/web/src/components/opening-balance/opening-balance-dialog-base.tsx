'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { parseSignedAmount } from '@/lib/owner-accounts';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm, type FormSchema } from '@/hooks/use-zod-form';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface OpeningFormValues {
  currency?: string;
  amount: string;
  date: string;
  reason: string;
}

interface Props {
  /** Espacio de textos (`ownerAccounts.opening` o `cash.opening`), con las mismas claves. */
  namespace: string;
  schema: FormSchema<Record<string, unknown>>;
  initialValues: OpeningFormValues;
  endpoint: string;
  /** A quién o a qué cuenta pertenece el saldo (para el título y la confirmación). */
  name: string;
  /** Moneda fija del saldo; sin ella, `currencyField` deja elegirla. */
  currency?: string;
  currencyField?: (values: OpeningFormValues, set: (field: string, value: string) => void, error?: string) => ReactNode;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Saldo inicial con importe con signo, fecha de corte y motivo, que se confirma
 * mostrando importe y motivo (quedan en la auditoría). Lo comparten el del
 * locador y el de una cuenta de caja, banco o custodia.
 */
export function OpeningBalanceDialogBase({ namespace, schema, initialValues, endpoint, name, currency, currencyField, onClose, onDone }: Props) {
  const t = useTranslations(namespace);
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema,
    initialValues,
    translate: useSchemaMessages(),
  });
  const code = currency ?? values.currency ?? '';

  const save = submit(async (body) => {
    const amount = formatMoney(parseSignedAmount(values.amount) ?? '0', code, { decimals: 2 });
    const ok = await confirm({
      title: t('confirmTitle'),
      body: (
        <div className="space-y-2">
          <p>{t('confirmBody', { name, amount })}</p>
          <p className="text-[var(--color-muted)]">{t('confirmReason', { reason: values.reason.trim() })}</p>
        </div>
      ),
      confirmLabel: t('confirmLabel'),
    });
    if (!ok) return;
    await apiClient(endpoint, { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('done'));
    onDone();
    onClose();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting} size="md">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title', { name })}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError != null && <ErrorNotice error={formError} fallback={t('error')} />}
          <p className="text-sm text-[var(--color-muted)]">{t('explain', { currency: code })}</p>
          <div className={`grid grid-cols-1 gap-3 ${currencyField ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            {currencyField?.(values as OpeningFormValues, set as (f: string, v: string) => void, errors.currency)}
            <FormField label={t('amount', { currency: code })} hint={t('amountHint')} error={errors.amount} required>
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
