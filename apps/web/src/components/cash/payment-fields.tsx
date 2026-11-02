'use client';

import type { ReactNode } from 'react';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export type PaymentField = 'accountId' | 'method' | 'amount' | 'date' | 'note';

interface Props {
  values: Partial<Record<PaymentField, string>>;
  errors: Partial<Record<string, string>>;
  onField: (field: PaymentField, value: string) => void;
  labels: {
    account?: string;
    /** Primera opción de la cuenta (vacía): "elegí una" o "la de por defecto". */
    accountPlaceholder?: string;
    method?: string;
    /** Sin etiqueta no hay campo de importe. */
    amount?: string;
    date: string;
    note: string;
  };
  /** Cuentas que se ofrecen; sin esto no hay campo de cuenta. */
  accounts?: readonly { id: string; name: string }[];
  accountRequired?: boolean;
  /** Medios de pago que se ofrecen; sin esto no hay campo de medio. */
  methods?: readonly { value: string; label: string }[];
  /** Algo que va entre los campos y la nota (un aviso, por ejemplo). */
  children?: ReactNode;
}

/**
 * Campos de un pago o un cobro desde o hacia una cuenta de la inmobiliaria: cuenta, medio, importe, fecha y nota.
 * Los usan los diálogos de pago al locador, de cobro de un honorario y de pago de una comisión.
 */
export function PaymentFields({ values, errors, onField, labels, accounts, accountRequired, methods, children }: Props) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {accounts && (
          <FormField label={labels.account} error={errors.accountId} required={accountRequired}>
            {(c) => (
              <Select {...c} value={values.accountId ?? ''} onChange={(e) => onField('accountId', e.target.value)}>
                <option value="">{labels.accountPlaceholder}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        )}
        {methods && (
          <FormField label={labels.method} error={errors.method} required>
            {(c) => (
              <Select {...c} value={values.method ?? ''} onChange={(e) => onField('method', e.target.value)}>
                {methods.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        )}
        {labels.amount && (
          <FormField label={labels.amount} error={errors.amount} required>
            {(c) => <Input {...c} inputMode="decimal" value={values.amount ?? ''} onChange={(e) => onField('amount', e.target.value)} />}
          </FormField>
        )}
        <FormField label={labels.date} error={errors.date} required>
          {(c) => <Input {...c} type="date" value={values.date ?? ''} onChange={(e) => onField('date', e.target.value)} />}
        </FormField>
      </div>
      {children}
      <FormField label={labels.note} error={errors.note}>
        {(c) => <Textarea {...c} rows={2} value={values.note ?? ''} onChange={(e) => onField('note', e.target.value)} />}
      </FormField>
    </>
  );
}
