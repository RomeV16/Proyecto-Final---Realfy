'use client';

import { useTranslations } from 'next-intl';
import { OWNER_CURRENCIES, openingBalanceFormSchema } from '@/lib/owner-accounts';
import { OpeningBalanceDialogBase } from '@/components/opening-balance/opening-balance-dialog-base';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';

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
  return (
    <OpeningBalanceDialogBase
      namespace="ownerAccounts.opening"
      schema={openingBalanceFormSchema}
      initialValues={{ currency, amount: '', date: '', reason: '' }}
      endpoint={`/owners/${personId}/opening-balance`}
      name={personName}
      currencyField={(values, set, error) => (
        <FormField label={t('currency')} error={error} required>
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
      )}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
