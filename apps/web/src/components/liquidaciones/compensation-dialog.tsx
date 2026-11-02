'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { compensationFormSchema, type CompensationFormValues } from '@/lib/cash';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PersonPicker } from '@/components/parties/person-picker';
import type { PartyPerson } from '@/components/parties/parties';

export interface LessorOption {
  personId: string;
  name: string;
}

interface Props {
  paymentId: string;
  /** Locadores del contrato: a uno de ellos le correspondía el cobro. */
  lessors: LessorOption[];
  currency?: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Compensación de un cobro que el inquilino le pagó a otro locador: quien lo recibió cubre a los locadores del
 * contrato, con su propio saldo o con el efectivo que la inmobiliaria le guarda en custodia.
 */
export function CompensationDialog({ paymentId, lessors, currency = 'ARS', onClose, onDone }: Props) {
  const t = useTranslations('liquidaciones.compensations');
  const tCommon = useTranslations('common');
  const [receiver, setReceiver] = useState<PartyPerson | null>(null);
  const [fromCustody, setFromCustody] = useState(false);
  const schema = useMemo(() => compensationFormSchema(paymentId, fromCustody), [paymentId, fromCustody]);
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema,
    initialValues: {
      fromLessorId: '',
      toLessorId: lessors.length === 1 ? lessors[0].personId : '',
      amount: '',
      note: '',
    } satisfies CompensationFormValues,
    translate: useSchemaMessages(),
  });

  const save = submit(async (body) => {
    await apiClient('/compensations', { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('saved'));
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
          <p className="text-sm text-[var(--color-muted)]">{t('intro')}</p>
          {formError != null && <ErrorNotice error={formError} fallback={t('error')} />}
          <PersonPicker
            label={t('from')}
            value={receiver}
            error={errors.fromLessorId}
            onChange={(p) => {
              setReceiver(p);
              set('fromLessorId', p?.id ?? '');
            }}
          />
          <FormField label={t('to')} error={errors.toLessorId} required>
            {(c) => (
              <Select {...c} value={values.toLessorId} onChange={(e) => set('toLessorId', e.target.value)}>
                <option value="">{t('chooseLessor')}</option>
                {lessors.map((l) => (
                  <option key={l.personId} value={l.personId}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t('amount', { currency })} hint={t('amountHint')} error={errors.amount}>
            {(c) => <Input {...c} inputMode="decimal" value={values.amount} onChange={(e) => set('amount', e.target.value)} />}
          </FormField>
          <label className="flex items-start gap-2 text-sm text-[var(--color-text)]">
            <input type="checkbox" className="mt-0.5" checked={fromCustody} onChange={(e) => setFromCustody(e.target.checked)} />
            <span>
              <span className="block font-medium">{t('fromCustody')}</span>
              <span className="block text-xs text-[var(--color-muted)]">{t('fromCustodyHint')}</span>
            </span>
          </label>
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
