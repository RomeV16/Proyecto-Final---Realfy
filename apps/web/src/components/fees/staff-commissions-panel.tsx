'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { agencyAccounts, today } from '@/lib/cash';
import { feePlace, payCommissionFormSchema, type PayCommissionFormValues, type StaffCommissionItem } from '@/lib/fees';
import { formatMoney } from '@/lib/format';
import { toast } from '@/lib/toast';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { Dialog, DialogBody, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormDialogFooter } from '@/components/ui/form-dialog-footer';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { PaymentFields } from '@/components/cash/payment-fields';
import { useCashAccounts } from '@/components/cash/use-cash-data';
import { listPagination } from './fee-filters';

const LIMIT = 50;
const INITIAL_FILTERS = { paid: 'false' };

/** Pago de una comisión al personal: un egreso de una cuenta de la inmobiliaria. */
function PayCommissionDialog({ item, onClose, onDone }: { item: StaffCommissionItem; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('fees.commissions');
  const accounts = useCashAccounts(true);
  const options = agencyAccounts(accounts.data?.items ?? [], item.currency);
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: payCommissionFormSchema,
    initialValues: { accountId: '', date: today(), note: '' } satisfies PayCommissionFormValues,
    translate: useSchemaMessages(),
  });

  const save = submit(async (body) => {
    await apiClient(`/staff-commissions/${item.id}/pay`, { method: 'POST', body: JSON.stringify(body) });
    toast.success(t('done'));
    onDone();
    onClose();
  });

  return (
    <Dialog open onClose={onClose} busy={submitting} size="md">
      <form onSubmit={save} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            {t('payTitle', { name: item.beneficiaryName, amount: formatMoney(item.amount, item.currency, { decimals: 2 }) })}
          </h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {formError != null && <ErrorNotice error={formError} fallback={t('error')} />}
          <PaymentFields
            values={values}
            errors={errors}
            onField={(field, value) => set(field as keyof PayCommissionFormValues, value)}
            labels={{ account: t('account'), accountPlaceholder: t('accountPlaceholder'), date: t('date'), note: t('note') }}
            accounts={options}
            accountRequired
          />
        </DialogBody>
        <FormDialogFooter onCancel={onClose} busy={submitting} submitLabel={t('confirm')} />
      </form>
    </Dialog>
  );
}

/** Comisiones del personal sobre los honorarios: las pendientes de pagar y las pagadas. */
export function StaffCommissionsPanel() {
  const t = useTranslations('fees');
  const list = usePaginatedList<StaffCommissionItem, typeof INITIAL_FILTERS>({
    key: 'staff-commissions',
    path: '/staff-commissions',
    limit: LIMIT,
    initialFilters: INITIAL_FILTERS,
  });
  const [paying, setPaying] = useState<StaffCommissionItem | null>(null);

  const columns: DataTableColumn<StaffCommissionItem>[] = [
    { key: 'beneficiary', header: t('columns.beneficiary'), render: (row) => row.beneficiaryName },
    {
      key: 'fee',
      header: t('columns.fee'),
      render: (row) => (
        <div>
          <p className="text-[var(--color-text)]">{t(`kinds.${row.fee.kind}`)}</p>
          <p className="text-xs text-[var(--color-muted)]">{[feePlace(row.fee), row.fee.payerName].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    {
      key: 'amount',
      header: t('columns.commission'),
      alignRight: true,
      render: (row) => (
        <div className="text-right">
          <MoneyText value={row.amount} currency={row.currency} />
          <p className="text-xs text-[var(--color-muted)]">{t('commissions.pctOf', { pct: row.pct, base: formatMoney(row.baseAmount, row.currency) })}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (row) =>
        row.paidAt ? (
          <Badge variant="success">
            {t('commissions.paid')} · <DateText value={row.paidAt} />
          </Badge>
        ) : (
          <Badge variant="warning">{t('commissions.pending')}</Badge>
        ),
    },
    {
      key: 'actions',
      header: t('columns.actions'),
      render: (row) =>
        row.paidAt ? null : (
          <Button type="button" size="sm" onClick={() => setPaying(row)}>
            {t('actions.pay')}
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="staff-commissions-paid" className="text-xs font-medium text-[var(--color-muted)]">
          {t('filters.status')}
        </label>
        <Select id="staff-commissions-paid" value={list.filters.paid} onChange={(e) => list.setFilter('paid', e.target.value)} className="w-48">
          <option value="false">{t('commissions.pending')}</option>
          <option value="true">{t('commissions.paid')}</option>
          <option value="">{t('filters.all')}</option>
        </Select>
      </div>
      <DataTable
        items={list.items}
        columns={columns}
        keyExtractor={(row) => row.id}
        loading={list.isLoading}
        error={list.error}
        pagination={listPagination(list)}
        empty={{ title: t('commissions.empty'), iconName: 'team' }}
      />
      {paying && <PayCommissionDialog item={paying} onClose={() => setPaying(null)} onDone={() => void list.refetch()} />}
    </div>
  );
}
