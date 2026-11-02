'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { agencyAccounts, today } from '@/lib/cash';
import { formatDate, formatMoney } from '@/lib/format';
import {
  canImpute,
  canPayProvider,
  FEE_MODES,
  imputeFormSchema,
  paymentFormSchema,
  REPAIR_PAYERS,
  type ImputationResult,
  type ProviderPayment,
  type ProviderPaymentsResponse,
  type RepairTicket,
} from '@/lib/ticket-repairs';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { useCashAccounts } from '@/components/cash/use-cash-data';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  ticket: RepairTicket;
  /** Puede pagar al proveedor e imputar el gasto (cobranza). */
  canPay: boolean;
  onChanged: () => void;
}

/** Pagos al proveedor desde la caja de la inmobiliaria y la imputación del gasto a quien lo paga. */
export function RepairPayments({ ticket, canPay, onChanged }: Props) {
  const t = useTranslations('tickets.repair');
  const confirm = useConfirm();
  const translate = useSchemaMessages();
  const locale = useLocale();
  const currency = ticket.costCurrency ?? 'ARS';
  const money = (value: string) => formatMoney(value, currency, { locale });
  const [payments, setPayments] = useState<ProviderPaymentsResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<ImputationResult | null>(null);

  const payable = canPay && canPayProvider(ticket);
  const imputable = canPay && canImpute(ticket);
  const accounts = useCashAccounts(payable);
  const options = agencyAccounts(accounts.data?.items ?? [], currency);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient<ProviderPaymentsResponse>(`/tickets/${ticket.id}/provider-payments`);
        if (cancelled) return;
        setPayments(res);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticket.id, version]);

  const reload = useCallback(() => {
    setVersion((v) => v + 1);
    onChanged();
  }, [onChanged]);

  const pay = useZodForm({
    schema: paymentFormSchema,
    initialValues: { accountId: '', amount: '', date: today(), note: '' },
    translate,
  });
  const savePayment = pay.submit(async (body) => {
    await apiClient(`/tickets/${ticket.id}/provider-payments`, { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('payments.done'));
    pay.setValues({ amount: '', note: '' });
    reload();
  });

  const impute = useZodForm({
    schema: imputeFormSchema,
    initialValues: { chargedTo: ticket.costPayer ?? '', feeMode: 'None', feePct: '', feeAmount: '' },
    translate,
  });
  const saveImputation = impute.submit(async (body) => {
    const ok = await confirm({
      title: t('impute.confirm.title'),
      body: t('impute.confirm.body', { payer: t(`payers.${body.chargedTo as string}`), total: money(payments?.total ?? '0') }),
      confirmLabel: t('impute.confirm.action'),
    });
    if (!ok) return;
    const res = await apiClient<ImputationResult>(`/tickets/${ticket.id}/impute`, { method: 'POST', body: JSON.stringify(body) });
    setResult(res);
    toast.success(t('impute.done'));
    reload();
  });

  const columns: DataTableColumn<ProviderPayment>[] = [
    { key: 'date', header: t('payments.columns.date'), render: (p) => formatDate(p.date) },
    { key: 'account', header: t('payments.columns.account'), render: (p) => p.account?.name ?? '—' },
    {
      key: 'amount',
      header: t('payments.columns.amount'),
      alignRight: true,
      render: (p) => <MoneyText value={p.amount} currency={p.currency} className="font-semibold" />,
    },
    { key: 'note', header: t('payments.columns.note'), render: (p) => p.note ?? '—' },
  ];

  return (
    <section aria-labelledby="repair-payments-title" className="card-lux space-y-4 p-6">
      <div>
        <p className="eyebrow">{t('payments.eyebrow')}</p>
        <h2 id="repair-payments-title" className="h3">
          {t('payments.title')}
        </h2>
      </div>

      {loadError != null && <ErrorNotice error={loadError} fallback={t('payments.loadError')} />}
      <DataTable
        items={payments?.items ?? []}
        columns={columns}
        keyExtractor={(p) => p.id}
        loading={payments === null && loadError == null}
        empty={{ title: t('payments.empty.title'), subtitle: t('payments.empty.subtitle'), iconName: 'wallet' }}
      />
      {payments && payments.items.length > 0 && (
        <p className="text-sm text-[var(--color-text)]">
          {t('payments.total')} <MoneyText value={payments.total} currency={payments.currency ?? currency} className="font-semibold" />
          {ticket.costAmount && (
            <span className="text-[var(--color-muted)]">
              {' · '}
              {t('payments.approved')} <MoneyText value={ticket.costAmount} currency={currency} />
            </span>
          )}
        </p>
      )}

      {payable && (
        <form onSubmit={savePayment} noValidate className="space-y-3 border-t border-[var(--color-border)] pt-4" aria-label={t('payments.add.title')}>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('payments.add.title')}</h3>
          {pay.formError != null && <ErrorNotice error={pay.formError} fallback={t('payments.add.error')} />}
          {accounts.data && options.length === 0 && (
            <p className="text-sm text-[var(--color-muted)]">{t('payments.add.noAccounts', { currency })}</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label={t('payments.columns.account')} error={pay.errors.accountId} required>
              {(c) => (
                <Select {...c} value={pay.values.accountId} onChange={(e) => pay.set('accountId', e.target.value)}>
                  <option value="">{t('payments.add.accountPlaceholder')}</option>
                  {options.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t('payments.columns.amount')} error={pay.errors.amount} required>
              {(c) => <Input {...c} inputMode="decimal" value={pay.values.amount} onChange={(e) => pay.set('amount', e.target.value)} />}
            </FormField>
            <FormField label={t('payments.columns.date')} error={pay.errors.date}>
              {(c) => <Input {...c} type="date" value={pay.values.date} onChange={(e) => pay.set('date', e.target.value)} />}
            </FormField>
          </div>
          <FormField label={t('payments.columns.note')} error={pay.errors.note}>
            {(c) => <Textarea {...c} rows={2} value={pay.values.note} onChange={(e) => pay.set('note', e.target.value)} />}
          </FormField>
          <Button type="submit" variant="secondary" disabled={pay.submitting}>
            {pay.submitting ? t('saving') : t('payments.add.submit')}
          </Button>
        </form>
      )}

      <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('impute.title')}</h3>
        {ticket.imputedAt ? (
          <p role="status" className="text-sm text-[var(--color-text)]">
            {t('impute.imputed', { payer: ticket.costPayer ? t(`payers.${ticket.costPayer}`) : '—' })}
          </p>
        ) : imputable ? (
          <form onSubmit={saveImputation} noValidate className="space-y-3" aria-label={t('impute.title')}>
            <p className="text-sm text-[var(--color-muted)]">{t('impute.help')}</p>
            {impute.formError != null && <ErrorNotice error={impute.formError} fallback={t('impute.error')} />}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField label={t('impute.payer')} error={impute.errors.chargedTo} required>
                {(c) => (
                  <Select {...c} value={impute.values.chargedTo} onChange={(e) => impute.set('chargedTo', e.target.value)}>
                    <option value="">{t('impute.payerPlaceholder')}</option>
                    {REPAIR_PAYERS.map((p) => (
                      <option key={p} value={p}>
                        {t(`payers.${p}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              {impute.values.chargedTo !== 'Inmobiliaria' && (
                <FormField label={t('impute.fee.label')} hint={t('impute.fee.hint')} error={impute.errors.feeMode}>
                  {(c) => (
                    <Select {...c} value={impute.values.feeMode} onChange={(e) => impute.set('feeMode', e.target.value)}>
                      {FEE_MODES.map((m) => (
                        <option key={m} value={m}>
                          {t(`impute.fee.modes.${m}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
              )}
              {impute.values.chargedTo !== 'Inmobiliaria' && impute.values.feeMode === 'Percent' && (
                <FormField label={t('impute.fee.pct')} hint={t('impute.fee.pctHint')}>
                  {(c) => <Input {...c} inputMode="decimal" value={impute.values.feePct} onChange={(e) => impute.set('feePct', e.target.value)} />}
                </FormField>
              )}
              {impute.values.chargedTo !== 'Inmobiliaria' && impute.values.feeMode === 'Fixed' && (
                <FormField label={t('impute.fee.amount')}>
                  {(c) => (
                    <Input {...c} inputMode="decimal" value={impute.values.feeAmount} onChange={(e) => impute.set('feeAmount', e.target.value)} />
                  )}
                </FormField>
              )}
            </div>
            <Button type="submit" disabled={impute.submitting || !payments || payments.items.length === 0}>
              {impute.submitting ? t('saving') : t('impute.submit')}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">{t('impute.notYet')}</p>
        )}
        {result && (
          <p role="status" className="text-sm text-[var(--color-text)]">
            {t('impute.result', { total: money(result.total) })}
            {result.feeCharge ? ` ${t('impute.resultFee', { fee: money(result.feeCharge.amount) })}` : ''}
          </p>
        )}
      </div>
    </section>
  );
}
