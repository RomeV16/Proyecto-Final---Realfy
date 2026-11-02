'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import { useCan } from '@/lib/permissions';
import {
  OWNER_CURRENCIES,
  STATEMENT_STATUSES,
  currentPeriod,
  type GenerateResult,
  type StatementSummary,
} from '@/lib/owner-accounts';
import type { Paged } from '@/lib/cash';
import { formatPeriod } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ErrorNotice } from '@/components/ui/error-notice';
import { inputStyles } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { BalanceAmount } from './balance-amount';

const LIMIT = 50;

/** Cuenta los omitidos por motivo. */
function skippedByReason(skipped: GenerateResult['skipped']): [string, number][] {
  const counts = new Map<string, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Estados de cuenta mensuales: uno por locador y moneda con todas sus unidades.
 * Se generan como borradores para el mes elegido, se revisan y se emiten.
 */
export function OwnerStatements() {
  const t = useTranslations('ownerAccounts');
  const canView = useCan('ownerAccounts.view');
  const canManage = useCan('ownerAccounts.manage');
  const [period, setPeriod] = useState(currentPeriod());
  const [status, setStatus] = useState('');
  const [currency, setCurrency] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<StatementSummary> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [generateError, setGenerateError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (period) params.set('period', period);
      if (status) params.set('status', status);
      if (currency) params.set('currency', currency);
      setData(await apiClient<Paged<StatementSummary>>(`/owner-statements?${params.toString()}`));
    } catch (err) {
      setError(err);
      setData(null);
    }
  }, [period, status, currency, page]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load, version]);

  if (!canView) {
    return <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>;
  }

  const filter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  async function generate() {
    setGenerating(true);
    setGenerateError(null);
    setResult(null);
    try {
      setResult(await apiClient<GenerateResult>(`/owner-statements/generate?period=${period}`, { method: 'POST' }));
      setVersion((v) => v + 1);
    } catch (err) {
      setGenerateError(err);
    } finally {
      setGenerating(false);
    }
  }

  const money = (field: 'opening' | 'credits' | 'debits' | 'payouts') => ({
    key: field,
    header: t(`statements.columns.${field}`),
    alignRight: true,
    render: (s: StatementSummary) => <MoneyText value={s[field]} currency={s.currency} decimals={2} className="tabular-nums" />,
  });

  const columns: DataTableColumn<StatementSummary>[] = [
    {
      key: 'person',
      header: t('statements.columns.person'),
      render: (s) => (
        <Link href={`/estados-de-cuenta/${s.id}`} className="font-medium text-[var(--color-brand-600)] hover:underline">
          {s.person.name}
        </Link>
      ),
    },
    { key: 'period', header: t('statements.columns.period'), render: (s) => formatPeriod(s.period) },
    { key: 'currency', header: t('statements.columns.currency'), render: (s) => s.currency },
    money('opening'),
    money('credits'),
    money('debits'),
    money('payouts'),
    {
      key: 'closing',
      header: t('statements.columns.closing'),
      alignRight: true,
      render: (s) => <BalanceAmount value={s.closing} currency={s.currency} />,
    },
    { key: 'status', header: t('statements.columns.status'), render: (s) => <StatusBadge domain="estadoCuenta" status={s.status} /> },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t('statements.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('statements.subtitle')}</p>
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="statements-period" className="text-xs font-medium text-[var(--color-muted)]">
            {t('statements.period')}
          </label>
          <input
            id="statements-period"
            type="month"
            value={period}
            onChange={(e) => filter(() => setPeriod(e.target.value))}
            className={inputStyles({ className: 'w-44' })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="statements-status" className="text-xs font-medium text-[var(--color-muted)]">
            {t('statements.status')}
          </label>
          <Select id="statements-status" value={status} onChange={(e) => filter(() => setStatus(e.target.value))} className="w-40">
            <option value="">{t('statements.allStatuses')}</option>
            {STATEMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="statements-currency" className="text-xs font-medium text-[var(--color-muted)]">
            {t('statements.currency')}
          </label>
          <Select id="statements-currency" value={currency} onChange={(e) => filter(() => setCurrency(e.target.value))} className="w-36">
            <option value="">{t('balances.allCurrencies')}</option>
            {OWNER_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        {canManage && (
          <Button type="button" onClick={() => void generate()} disabled={generating || !/^\d{4}-\d{2}$/.test(period)}>
            {generating ? t('statements.generating') : t('statements.generate')}
          </Button>
        )}
      </div>

      {generateError != null && <ErrorNotice error={generateError} fallback={t('statements.generateError')} />}
      {result && (
        <div role="status" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
          <p className="font-medium text-[var(--color-text)]">
            {t('statements.generated', {
              period: formatPeriod(`${result.period}-01T00:00:00.000Z`),
              created: result.created,
              updated: result.updated,
            })}
          </p>
          {result.chargesPosted > 0 && (
            <p className="mt-1 text-[var(--color-muted)]">{t('statements.chargesPosted', { count: result.chargesPosted })}</p>
          )}
          {skippedByReason(result.skipped).map(([reason, count]) => (
            <p key={reason} className="mt-1 text-[var(--color-muted)]">
              {t('statements.skipped', { count })}: {t.has(`statements.skipReasons.${reason}`) ? t(`statements.skipReasons.${reason}`) : reason}
            </p>
          ))}
        </div>
      )}

      <DataTable
        items={data?.items ?? []}
        columns={columns}
        keyExtractor={(s) => s.id}
        loading={data === null && error == null}
        error={error}
        pagination={
          data && data.totalPages > 1
            ? { page: data.page, totalPages: data.totalPages, total: data.total, limit: data.limit, onPageChange: setPage }
            : undefined
        }
        empty={{ title: t('statements.empty.title'), subtitle: t('statements.empty.subtitle'), iconName: 'renditions' }}
      />
    </div>
  );
}
