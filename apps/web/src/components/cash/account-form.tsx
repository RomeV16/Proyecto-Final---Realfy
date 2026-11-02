'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Currency, FinancialAccountKind } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { ACCOUNT_KINDS, CURRENCIES, accountFormSchema, type AccountFormValues, type FinancialAccount } from '@/lib/cash';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm, type FormSchema } from '@/hooks/use-zod-form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PersonPicker } from '@/components/parties/person-picker';
import type { PartyPerson } from '@/components/parties/parties';

/** El cambio de nombre solo pide un nombre de 1 a 120 caracteres. */
const renameSchema: FormSchema<Record<string, unknown>> = {
  safeParse(input) {
    const name = String((input as AccountFormValues).name ?? '').trim();
    if (name.length >= 1 && name.length <= 120) return { success: true, data: { name } };
    return { success: false, error: { issues: [{ path: ['name'], message: 'cash.errors.name' }] } };
  },
};

interface Props {
  /** Cuenta a renombrar; sin cuenta, es un alta. */
  account: FinancialAccount | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Alta de una cuenta (caja, banco o custodia de un locador) o cambio de nombre de una existente. */
export function AccountForm({ account, onClose, onSaved }: Props) {
  const t = useTranslations('cash');
  const tCommon = useTranslations('common');
  const creating = account === null;
  const [owner, setOwner] = useState<PartyPerson | null>(null);
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: creating ? accountFormSchema : renameSchema,
    initialValues: {
      kind: FinancialAccountKind.Caja as string,
      name: account?.name ?? '',
      currency: Currency.ARS as string,
      ownerPersonId: '',
    } satisfies AccountFormValues,
    translate: useSchemaMessages(),
  });

  const custody = values.kind === FinancialAccountKind.Custodia;

  const save = submit(async (body) => {
    await apiClient(creating ? '/financial-accounts' : `/financial-accounts/${account.id}`, {
      method: creating ? 'POST' : 'PATCH',
      body: JSON.stringify(body),
    });
    toast.success(creating ? t('accounts.created') : t('accounts.renamed'));
    onSaved();
    onClose();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting} size="md">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            {creating ? t('accounts.form.createTitle') : t('accounts.form.renameTitle')}
          </h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError != null && <ErrorNotice error={formError} fallback={t('accounts.form.saveError')} />}
          {creating && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label={t('accounts.form.kind')} hint={t(`accounts.form.kindHints.${values.kind}`)} error={errors.kind}>
                {(c) => (
                  <Select {...c} value={values.kind} onChange={(e) => set('kind', e.target.value)}>
                    {ACCOUNT_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {t(`kinds.${kind}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <FormField label={t('accounts.form.currency')} error={errors.currency}>
                {(c) => (
                  <Select {...c} value={values.currency} onChange={(e) => set('currency', e.target.value)}>
                    {CURRENCIES.map((cur) => (
                      <option key={cur} value={cur}>
                        {tCommon(`currencies.${cur}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            </div>
          )}
          <FormField label={t('accounts.form.name')} error={errors.name} required>
            {(c) => <Input {...c} value={values.name} onChange={(e) => set('name', e.target.value)} />}
          </FormField>
          {creating && custody && (
            <PersonPicker
              label={t('accounts.form.owner')}
              value={owner}
              error={errors.ownerPersonId}
              onChange={(p) => {
                setOwner(p);
                set('ownerPersonId', p?.id ?? '');
              }}
            />
          )}
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
