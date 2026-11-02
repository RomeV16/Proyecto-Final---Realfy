'use client';

import { useTranslations } from 'next-intl';
import { AdjustmentType } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import {
  ADJUSTMENT_PERIODS,
  ADJUSTMENT_TYPES,
  FEE_CURRENCIES,
  dayAfter,
  periodEnd,
  renewFormSchema,
  type RenewFormValues,
} from '@/lib/follow-ups';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export interface RenewGuarantor {
  personId: string;
  name: string;
}

interface Props {
  contractId: string;
  /** Fin efectivo hoy: la renovación arranca al día siguiente. */
  effectiveEnd: string;
  currentRent: string;
  guarantors: RenewGuarantor[];
  onClose: () => void;
  onSaved: () => void;
}

const PERIOD_MONTHS = 24;

/**
 * Renovación como período del mismo contrato: fechas, alquiler nuevo, regla de ajuste (si cambia), garantes que
 * reafirman y honorarios. No crea otro contrato; agrega un período y un convenio con las reglas nuevas.
 */
export function RenewDialog({ contractId, effectiveEnd, currentRent, guarantors, onClose, onSaved }: Props) {
  const t = useTranslations('followUps.renew');
  const tAdj = useTranslations('followUps.adjustment');
  const tCommon = useTranslations('common');
  const start = dayAfter(effectiveEnd);
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: renewFormSchema,
    initialValues: {
      start,
      end: periodEnd(start, PERIOD_MONTHS),
      rent: currentRent,
      adjustmentType: '',
      adjustmentPeriod: 'Trimestral',
      customPct: '',
      guarantorPersonIds: [] as string[],
      feeAmount: '',
      feeCurrency: 'ARS',
      signedAt: '',
      notes: '',
    } satisfies RenewFormValues,
    translate: useSchemaMessages(),
  });

  const save = submit(async (body) => {
    await apiClient(`/contracts/${contractId}/renew`, { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('saved'));
    onSaved();
    onClose();
  });

  function toggleGuarantor(id: string, on: boolean) {
    set('guarantorPersonIds', on ? [...values.guarantorPersonIds, id] : values.guarantorPersonIds.filter((g) => g !== id));
  }

  const changesRule = values.adjustmentType !== '';

  return (
    <Dialog open onClose={onClose} busy={submitting} size="lg">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t('intro')}</p>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError != null && <ErrorNotice error={formError} fallback={t('saveError')} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label={t('start')} error={errors.start} required>
              {(c) => <Input {...c} type="date" value={values.start} onChange={(e) => set('start', e.target.value)} />}
            </FormField>
            <FormField label={t('end')} error={errors.end} required>
              {(c) => <Input {...c} type="date" value={values.end} onChange={(e) => set('end', e.target.value)} />}
            </FormField>
            <FormField label={t('rent')} hint={t('rentHint')} error={errors.rent} required>
              {(c) => <Input {...c} inputMode="decimal" value={values.rent} onChange={(e) => set('rent', e.target.value)} />}
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label={t('rule')} error={errors.adjustmentType}>
              {(c) => (
                <Select {...c} value={values.adjustmentType} onChange={(e) => set('adjustmentType', e.target.value)}>
                  <option value="">{t('ruleKeep')}</option>
                  {ADJUSTMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {tAdj(`types.${type}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {changesRule && (
              <FormField label={t('rulePeriod')} error={errors.adjustmentPeriod}>
                {(c) => (
                  <Select {...c} value={values.adjustmentPeriod} onChange={(e) => set('adjustmentPeriod', e.target.value)}>
                    {ADJUSTMENT_PERIODS.map((period) => (
                      <option key={period} value={period}>
                        {tAdj(`periods.${period}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            )}
            {values.adjustmentType === AdjustmentType.FixedPercent && (
              <FormField label={t('rulePct')} error={errors.customPct} required>
                {(c) => <Input {...c} inputMode="decimal" value={values.customPct} onChange={(e) => set('customPct', e.target.value)} />}
              </FormField>
            )}
          </div>

          {guarantors.length > 0 && (
            <fieldset>
              <legend className="text-sm font-medium text-[var(--color-text)]">{t('guarantors')}</legend>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">{t('guarantorsHint')}</p>
              <ul className="mt-2 space-y-1.5">
                {guarantors.map((g) => (
                  <li key={g.personId}>
                    <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={values.guarantorPersonIds.includes(g.personId)}
                        onChange={(e) => toggleGuarantor(g.personId, e.target.checked)}
                      />
                      {g.name}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label={t('fee')} hint={t('feeHint')} error={errors.feeAmount}>
              {(c) => <Input {...c} inputMode="decimal" value={values.feeAmount} onChange={(e) => set('feeAmount', e.target.value)} />}
            </FormField>
            <FormField label={t('feeCurrency')}>
              {(c) => (
                <Select {...c} value={values.feeCurrency} onChange={(e) => set('feeCurrency', e.target.value)}>
                  {FEE_CURRENCIES.map((cur) => (
                    <option key={cur} value={cur}>
                      {cur}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('signedAt')} hint={t('signedAtHint')} error={errors.signedAt}>
              {(c) => <Input {...c} type="date" value={values.signedAt} onChange={(e) => set('signedAt', e.target.value)} />}
            </FormField>
          </div>

          <FormField label={t('notes')} error={errors.notes}>
            {(c) => <Textarea {...c} rows={2} value={values.notes} onChange={(e) => set('notes', e.target.value)} />}
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
