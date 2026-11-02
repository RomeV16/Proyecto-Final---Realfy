'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { CHARGE_STATUSES, type ChargesResponse } from '@/lib/charges';
import { useCan } from '@/lib/permissions';
import { currentMonth } from '@/lib/service-bills';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { inputStyles } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ChargeBulkEntry } from './charge-bulk-entry';
import { ChargeQuickAdd } from './charge-quick-add';
import { ChargeTable } from './charge-table';
import { useChargeTargets } from './use-charge-targets';

const LIMIT = 50;

/**
 * Centro de carga: los gastos del mes (reparaciones, expensas extraordinarias, devoluciones, honorarios por gestión)
 * que se imputan al inquilino en su próxima liquidación o al locador en su estado. Un gasto que supera el umbral de
 * anticipo queda marcado para pedir el pago por adelantado en lugar de entrar solo en la liquidación.
 */
export function ChargeCenter() {
  const t = useTranslations('charges');
  const canManage = useCan('charges.manage');
  const targets = useChargeTargets(canManage);

  const [status, setStatus] = useState('Pendiente');
  const [period, setPeriod] = useState('');
  const [upfrontOnly, setUpfrontOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ChargesResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (status) params.set('status', status);
      if (period) params.set('period', period);
      if (upfrontOnly) params.set('requiresUpfront', 'true');
      setData(await apiClient<ChargesResponse>(`/charges?${params.toString()}`));
    } catch (err) {
      setError(err);
      setData(null);
    }
  }, [status, period, upfrontOnly, page]);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load, version]);

  if (!canManage) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  const refresh = () => setVersion((v) => v + 1);
  const filter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setShowBulk((v) => !v)} aria-expanded={showBulk}>
            {showBulk ? t('bulk.hide') : t('bulk.show')}
          </Button>
          <Button type="button" onClick={() => setShowAdd(true)}>
            {t('add')}
          </Button>
        </div>
      </header>

      {targets.error != null && <ErrorNotice error={targets.error} fallback={t('targetsError')} />}

      {showBulk && (
        <ChargeBulkEntry
          contracts={targets.contracts}
          onSaved={() => {
            refresh();
          }}
        />
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="charges-status" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.status')}
          </label>
          <Select id="charges-status" value={status} onChange={(e) => filter(() => setStatus(e.target.value))} className="w-48">
            <option value="">{t('filters.all')}</option>
            {CHARGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="charges-period" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.period')}
          </label>
          <input
            id="charges-period"
            type="month"
            value={period}
            placeholder={currentMonth()}
            onChange={(e) => filter(() => setPeriod(e.target.value))}
            className={inputStyles({ className: 'w-44' })}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-[var(--color-text)]">
          <input
            type="checkbox"
            checked={upfrontOnly}
            onChange={(e) => filter(() => setUpfrontOnly(e.target.checked))}
          />
          {t('filters.upfrontOnly')}
        </label>
      </div>

      <ChargeTable
        items={data?.items ?? []}
        loading={data === null && error == null}
        error={error}
        canManage={canManage}
        onChanged={refresh}
        pagination={
          data && data.totalPages > 1
            ? { page: data.page, totalPages: data.totalPages, total: data.total, limit: data.limit, onPageChange: setPage }
            : undefined
        }
        emptyAction={
          <Button type="button" size="sm" onClick={() => setShowAdd(true)}>
            {t('add')}
          </Button>
        }
      />
      <p className="text-xs text-[var(--color-muted)]">{t('lateNote')}</p>

      {showAdd && (
        <ChargeQuickAdd
          contracts={targets.contracts}
          properties={targets.properties}
          onClose={() => setShowAdd(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
