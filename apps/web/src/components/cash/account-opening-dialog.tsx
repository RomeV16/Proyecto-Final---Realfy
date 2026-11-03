'use client';

import { accountOpeningFormSchema, personLabel, type FinancialAccount } from '@/lib/cash';
import { OpeningBalanceDialogBase } from '@/components/opening-balance/opening-balance-dialog-base';

interface Props {
  account: FinancialAccount;
  onClose: () => void;
  onDone: () => void;
}

/** Saldo inicial de una cuenta (caja, banco o custodia), en la moneda de la cuenta: uno por cuenta, se corrige si ya existe. */
export function AccountOpeningDialog({ account, onClose, onDone }: Props) {
  const owner = personLabel(account.owner);
  return (
    <OpeningBalanceDialogBase
      namespace="cash.opening"
      schema={accountOpeningFormSchema}
      initialValues={{ amount: '', date: '', reason: '' }}
      endpoint={`/financial-accounts/${account.id}/opening-balance`}
      name={owner ? `${account.name} (${owner})` : account.name}
      currency={account.currency}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
