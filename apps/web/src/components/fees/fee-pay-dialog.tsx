'use client';

import { useTranslations } from 'next-intl';
import { FeeSettlement, PaymentMethod } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { agencyAccounts, today } from '@/lib/cash';
import {
  canSettleToLessor,
  FEE_SETTLEMENTS,
  installmentReceipt,
  PAYMENT_METHODS,
  payInstallmentFormSchema,
  type Fee,
  type PayInstallmentFormValues,
} from '@/lib/fees';
import { formatMoney } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Dialog, DialogBody, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormDialogFooter } from '@/components/ui/form-dialog-footer';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { PaymentFields } from '@/components/cash/payment-fields';
import { useCashAccounts } from '@/components/cash/use-cash-data';

/** La cuota que se cobra. */
export interface PayTarget {
  feeId: string;
  n: number;
  of: number;
  kind: string;
  payerRole: string;
  payerName: string;
  currency: string;
  /** Lo que hay que cobrar hoy (ajustado si corresponde). */
  dueAmount: string;
}

interface Props {
  target: PayTarget;
  onClose: () => void;
  onDone: () => void;
}

const initialValues = (amount: string): PayInstallmentFormValues => ({
  settlement: FeeSettlement.Caja,
  accountId: '',
  method: PaymentMethod.Efectivo,
  date: today(),
  amount,
  note: '',
});

/**
 * Cobro de una cuota de honorario: entra a una cuenta de la inmobiliaria (con recibo) o, si paga el locador, se
 * descuenta de su cuenta corriente. Sin elegir cuenta, va a la caja o el banco por defecto de la moneda.
 */
export function FeePayDialog({ target, onClose, onDone }: Props) {
  const t = useTranslations('fees.pay');
  const tFees = useTranslations('fees');
  const lessorAllowed = canSettleToLessor(target.payerRole);
  const accounts = useCashAccounts(true);
  const options = agencyAccounts(accounts.data?.items ?? [], target.currency);
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: payInstallmentFormSchema,
    initialValues: initialValues(target.dueAmount),
    translate: useSchemaMessages(),
  });
  const toCash = values.settlement === FeeSettlement.Caja;

  const save = submit(async (body) => {
    const fee = await apiClient<Fee>(`/fees/${target.feeId}/installments/${target.n}/pay`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const receipt = fee?.installmentRows ? installmentReceipt(fee, target.n) : null;
    toast.success(receipt ? t('doneReceipt', { receipt }) : t('done'));
    onDone();
    onClose();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting} size="md">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              {t('title', { n: target.n, of: target.of, kind: tFees(`kinds.${target.kind}`) })}
            </h2>
            <p className="text-sm text-[var(--color-muted)]">
              {t('subtitle', {
                name: target.payerName,
                role: tFees(`roles.${target.payerRole}`),
                amount: formatMoney(target.dueAmount, target.currency, { decimals: 2 }),
              })}
            </p>
          </div>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError != null && <ErrorNotice error={formError} fallback={t('error')} />}
          <FormField
            label={t('settlement')}
            hint={lessorAllowed ? t(`settlementHints.${values.settlement}`) : t('lessorOnly')}
            error={errors.settlement}
            required
          >
            {(c) => (
              <Select {...c} value={values.settlement} onChange={(e) => set('settlement', e.target.value)}>
                {FEE_SETTLEMENTS.filter((s) => s === FeeSettlement.Caja || lessorAllowed).map((s) => (
                  <option key={s} value={s}>
                    {t(`settlements.${s}`)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <PaymentFields
            values={values}
            errors={errors}
            onField={(field, value) => set(field, value)}
            labels={{
              account: t('account'),
              accountPlaceholder: t('defaultAccount', { currency: target.currency }),
              method: t('method'),
              amount: t('amount', { currency: target.currency }),
              date: t('date'),
              note: t('note'),
            }}
            accounts={toCash ? options : undefined}
            methods={toCash ? PAYMENT_METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) })) : undefined}
          />
        </DialogBody>
        <FormDialogFooter onCancel={onClose} busy={submitting} submitLabel={submitting ? t('saving') : t('confirm')} />
      </form>
    </Dialog>
  );
}
