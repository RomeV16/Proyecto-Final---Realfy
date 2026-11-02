'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CashDirection } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { CASH_CATEGORIES, personLabel, signedAmount, type CashMovementRow, type FinancialAccount, type Paged } from '@/lib/cash';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { inputStyles } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { ConversionForm } from './conversion-form';
import { MovementForm } from './movement-form';
import { useContractOptions } from './use-cash-data';

const LIMIT = 50;

interface Props {
  accounts: FinancialAccount[];
  canManage: boolean;
  /** Después de cargar un movimiento cambian los saldos de las cuentas. */
  onChanged: () => void;
}

/** Libro de movimientos con filtros, más la carga manual y las conversiones de moneda. */
export function MovementsPanel({ accounts, canManage, onChanged }: Props) {
  const t = useTranslations('cash');
  const contracts = useContractOptions(true);
  const [accountId, setAccountId] = useState('');
  const [category, setCategory] = useState('');
  const [contractId, setContractId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<CashMovementRow> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState<'movement' | 'conversion' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (accountId) params.set('accountId', accountId);
      if (category) params.set('category', category);
      if (contractId) params.set('contractId', contractId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      setData(await apiClient<Paged<CashMovementRow>>(`/cash-movements?${params.toString()}`));
    } catch (err) {
      setError(err);
      setData(null);
    }
  }, [accountId, category, contractId, from, to, page]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const filter = (apply: () => void) => {
    apply();
    setPage(1);
  };
  const saved = () => {
    setVersion((v) => v + 1);
    onChanged();
  };

  const columns: DataTableColumn<CashMovementRow>[] = [
    { key: 'date', header: t('movements.columns.date'), render: (m) => <DateText value={m.date} className="whitespace-nowrap" /> },
    { key: 'account', header: t('movements.columns.account'), render: (m) => m.account.name },
    { key: 'category', header: t('movements.columns.category'), render: (m) => t(`categories.${m.category}`) },
    {
      key: 'direction',
      header: t('movements.columns.direction'),
      render: (m) => (
        <Badge variant={m.direction === CashDirection.In ? 'success' : 'danger'}>{t(`directions.${m.direction}`)}</Badge>
      ),
    },
    {
      key: 'amount',
      header: t('movements.columns.amount'),
      alignRight: true,
      render: (m) => (
        <MoneyText
          value={signedAmount(m)}
          currency={m.currency}
          decimals={2}
          className={cn(
            'tabular-nums font-medium',
            m.direction === CashDirection.In ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]',
          )}
        />
      ),
    },
    { key: 'counterparty', header: t('movements.columns.counterparty'), render: (m) => personLabel(m.counterparty) || '—' },
    {
      key: 'note',
      header: t('movements.columns.note'),
      render: (m) => (
        <div className="text-sm">
          {m.note && <p className="text-[var(--color-text)]">{m.note}</p>}
          {m.sourceType && m.sourceType !== 'Manual' && (
            <p className="text-xs text-[var(--color-muted)]">
              {t.has(`sources.${m.sourceType}`) ? t(`sources.${m.sourceType}`) : m.sourceType}
              {m.rate ? ` · ${t('movements.rate', { rate: m.rate })}` : ''}
            </p>
          )}
        </div>
      ),
    },
  ];

  return (
    <section className="space-y-5" aria-labelledby="cash-movements-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="cash-movements-title" className="text-base font-semibold text-[var(--color-text)]">
          {t('movements.title')}
        </h2>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setForm('conversion')}>
              {t('conversion.open')}
            </Button>
            <Button type="button" onClick={() => setForm('movement')}>
              {t('movements.add')}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="cash-filter-account" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.account')}
          </label>
          <Select id="cash-filter-account" value={accountId} onChange={(e) => filter(() => setAccountId(e.target.value))} className="w-52">
            <option value="">{t('filters.allAccounts')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cash-filter-category" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.category')}
          </label>
          <Select id="cash-filter-category" value={category} onChange={(e) => filter(() => setCategory(e.target.value))} className="w-48">
            <option value="">{t('filters.allCategories')}</option>
            {CASH_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cash-filter-contract" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.contract')}
          </label>
          <Select id="cash-filter-contract" value={contractId} onChange={(e) => filter(() => setContractId(e.target.value))} className="w-56">
            <option value="">{t('filters.allContracts')}</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cash-filter-from" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.from')}
          </label>
          <input
            id="cash-filter-from"
            type="date"
            value={from}
            onChange={(e) => filter(() => setFrom(e.target.value))}
            className={inputStyles({ className: 'w-40' })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cash-filter-to" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.to')}
          </label>
          <input
            id="cash-filter-to"
            type="date"
            value={to}
            onChange={(e) => filter(() => setTo(e.target.value))}
            className={inputStyles({ className: 'w-40' })}
          />
        </div>
      </div>

      <DataTable
        items={data?.items ?? []}
        columns={columns}
        keyExtractor={(m) => m.id}
        loading={data === null && error == null}
        error={error}
        pagination={
          data && data.totalPages > 1
            ? { page: data.page, totalPages: data.totalPages, total: data.total, limit: data.limit, onPageChange: setPage }
            : undefined
        }
        empty={{ title: t('movements.empty.title'), subtitle: t('movements.empty.subtitle'), iconName: 'wallet' }}
      />

      {form === 'movement' && (
        <MovementForm accounts={accounts} contracts={contracts} onClose={() => setForm(null)} onSaved={saved} />
      )}
      {form === 'conversion' && <ConversionForm accounts={accounts} onClose={() => setForm(null)} onSaved={saved} />}
    </section>
  );
}
