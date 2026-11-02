'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CashCategory, defaultDirectionFor } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import {
  agencyAccounts,
  DIRECTIONS,
  MANUAL_CATEGORIES,
  movementFormSchema,
  today,
  type FinancialAccount,
  type MovementFormValues,
} from '@/lib/cash';
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
import type { ContractOption } from './use-cash-data';

interface Props {
  accounts: FinancialAccount[];
  contracts: ContractOption[];
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Movimiento cargado a mano en una cuenta de la inmobiliaria: pagos a locadores, entes y proveedores, honorarios,
 * gastos, comisiones y señas. El sentido se propone según la categoría y se puede cambiar.
 */
export function MovementForm({ accounts, contracts, onClose, onSaved }: Props) {
  const t = useTranslations('cash');
  const tCommon = useTranslations('common');
  const options = agencyAccounts(accounts);
  const [counterparty, setCounterparty] = useState<PartyPerson | null>(null);
  const { values, set, setValues, errors, formError, submitting, submit } = useZodForm({
    schema: movementFormSchema,
    initialValues: {
      accountId: options[0]?.id ?? '',
      date: today(),
      category: CashCategory.Gasto as string,
      direction: defaultDirectionFor(CashCategory.Gasto) as string,
      amount: '',
      counterpartyId: '',
      contractId: '',
      note: '',
    } satisfies MovementFormValues,
    translate: useSchemaMessages(),
  });

  const currency = options.find((a) => a.id === values.accountId)?.currency;

  const save = submit(async (body) => {
    await apiClient('/cash-movements', { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('movements.saved'));
    onSaved();
    onClose();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting} size="lg">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('movements.form.title')}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError != null && <ErrorNotice error={formError} fallback={t('movements.form.saveError')} />}
          {options.length === 0 && <p className="text-sm text-[var(--color-muted)]">{t('movements.form.noAccounts')}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={t('movements.form.account')} error={errors.accountId} required>
              {(c) => (
                <Select {...c} value={values.accountId} onChange={(e) => set('accountId', e.target.value)}>
                  {options.length === 0 && <option value="">{t('movements.form.chooseAccount')}</option>}
                  {options.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('movements.form.date')} error={errors.date} required>
              {(c) => <Input {...c} type="date" value={values.date} onChange={(e) => set('date', e.target.value)} />}
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label={t('movements.form.category')} error={errors.category} required>
              {(c) => (
                <Select
                  {...c}
                  value={values.category}
                  onChange={(e) =>
                    setValues({ category: e.target.value, direction: defaultDirectionFor(e.target.value as CashCategory) })
                  }
                >
                  {MANUAL_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {t(`categories.${category}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('movements.form.direction')} hint={t('movements.form.directionHint')} error={errors.direction}>
              {(c) => (
                <Select {...c} value={values.direction} onChange={(e) => set('direction', e.target.value)}>
                  {DIRECTIONS.map((d) => (
                    <option key={d} value={d}>
                      {t(`directions.${d}`)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField
              label={currency ? t('movements.form.amountIn', { currency }) : t('movements.form.amount')}
              error={errors.amount}
              required
            >
              {(c) => (
                <Input {...c} inputMode="decimal" placeholder="15000,50" value={values.amount} onChange={(e) => set('amount', e.target.value)} />
              )}
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PersonPicker
              label={t('movements.form.counterparty')}
              value={counterparty}
              error={errors.counterpartyId}
              onChange={(p) => {
                setCounterparty(p);
                set('counterpartyId', p?.id ?? '');
              }}
            />
            <FormField label={t('movements.form.contract')} error={errors.contractId}>
              {(c) => (
                <Select {...c} value={values.contractId} onChange={(e) => set('contractId', e.target.value)}>
                  <option value="">{t('movements.form.noContract')}</option>
                  {contracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.label}
                    </option>
                  ))}
                </Select>
              )}
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
            {submitting ? t('saving') : tCommon('save')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
