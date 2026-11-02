'use client';

import { useTranslations } from 'next-intl';
import { ChargeTarget, PendingChargeKind } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { CHARGE_BENEFICIARIES, CHARGE_KINDS, CHARGE_TARGETS, chargeFormSchema, type ChargeFormValues } from '@/lib/charges';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ChargeContractOption, ChargePropertyOption } from './use-charge-targets';

const today = () => new Date().toISOString().slice(0, 10);

const initialValues = (contractId: string): ChargeFormValues => ({
  contractId,
  propertyId: '',
  chargedTo: ChargeTarget.Inquilino,
  kind: PendingChargeKind.Reparacion,
  description: '',
  amount: '',
  currency: 'ARS',
  beneficiary: 'Locador',
  incurredAt: today(),
  targetPeriod: '',
  installments: '1',
  notes: '',
});

interface Props {
  contracts: ChargeContractOption[];
  properties: ChargePropertyOption[];
  /** Contrato con el que se abre el formulario (por ejemplo, desde el detalle del contrato). */
  contractId?: string;
  onClose: () => void;
  onSaved: () => void;
}

/** Alta de un gasto o cargo del mes. Con cuotas se crea una por mes. */
export function ChargeQuickAdd({ contracts, properties, contractId = '', onClose, onSaved }: Props) {
  const t = useTranslations('charges');
  const tCommon = useTranslations('common');
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: chargeFormSchema,
    initialValues: initialValues(contractId) as unknown as ChargeFormValues,
    translate: useSchemaMessages(),
  });

  const noContract = values.contractId === '';
  const toTenant = values.chargedTo === ChargeTarget.Inquilino;

  const save = submit(async (body) => {
    const res = await apiClient<{ items: { requiresUpfront: boolean }[] }>('/charges', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const upfront = res.items.filter((item) => item.requiresUpfront).length;
    toast.success(t('form.saved', { count: res.items.length }));
    if (upfront > 0) toast.info(t('form.upfrontNotice', { count: upfront }));
    onSaved();
    onClose();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting} size="lg">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('form.title')}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError != null && <ErrorNotice error={formError} fallback={t('form.saveError')} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={t('form.fields.chargedTo')} error={errors.chargedTo} hint={t(`form.hints.${values.chargedTo}`)}>
              {(c) => (
                <Select {...c} value={values.chargedTo} onChange={(e) => set('chargedTo', e.target.value)}>
                  {CHARGE_TARGETS.map((target) => (
                    <option key={target} value={target}>
                      {t(`targets.${target}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('form.fields.kind')} error={errors.kind}>
              {(c) => (
                <Select {...c} value={values.kind} onChange={(e) => set('kind', e.target.value)}>
                  {CHARGE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`kinds.${kind}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={t('form.fields.contract')} error={errors.contractId} hint={toTenant ? t('form.contractRequired') : undefined}>
              {(c) => (
                <Select {...c} value={values.contractId} onChange={(e) => set('contractId', e.target.value)}>
                  <option value="">{t('form.noContract')}</option>
                  {contracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {noContract && (
              <FormField label={t('form.fields.property')} error={errors.propertyId}>
                {(c) => (
                  <Select {...c} value={values.propertyId} onChange={(e) => set('propertyId', e.target.value)}>
                    <option value="">{t('form.chooseProperty')}</option>
                    {properties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.title}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            )}
          </div>
          <FormField label={t('form.fields.description')} error={errors.description}>
            {(c) => <Input {...c} value={values.description} onChange={(e) => set('description', e.target.value)} />}
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label={t('form.fields.amount')} hint={t('form.amountHint')} error={errors.amount}>
              {(c) => (
                <Input {...c} inputMode="decimal" placeholder="8000,50" value={values.amount} onChange={(e) => set('amount', e.target.value)} />
              )}
            </FormField>
            <FormField label={t('form.fields.incurredAt')} error={errors.incurredAt}>
              {(c) => <Input {...c} type="date" value={values.incurredAt} onChange={(e) => set('incurredAt', e.target.value)} />}
            </FormField>
            <FormField label={t('form.fields.beneficiary')} hint={t('form.beneficiaryHint')} error={errors.beneficiary}>
              {(c) => (
                <Select {...c} value={values.beneficiary} onChange={(e) => set('beneficiary', e.target.value)}>
                  {CHARGE_BENEFICIARIES.map((who) => (
                    <option key={who} value={who}>
                      {t(`beneficiaries.${who}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={t('form.fields.targetPeriod')} hint={t('form.targetPeriodHint')} error={errors.targetPeriod}>
              {(c) => <Input {...c} type="month" value={values.targetPeriod} onChange={(e) => set('targetPeriod', e.target.value)} />}
            </FormField>
            <FormField label={t('form.fields.installments')} hint={t('form.installmentsHint')} error={errors.installments}>
              {(c) => (
                <Input {...c} inputMode="numeric" value={values.installments} onChange={(e) => set('installments', e.target.value)} />
              )}
            </FormField>
          </div>
          <FormField label={t('form.fields.notes')} error={errors.notes}>
            {(c) => <Textarea {...c} rows={2} value={values.notes} onChange={(e) => set('notes', e.target.value)} />}
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('form.saving') : tCommon('save')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
