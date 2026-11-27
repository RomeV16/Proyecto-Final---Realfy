'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { CHARGE_KINDS, CHARGE_STATUSES, CHARGE_TARGETS, type ChargesResponse } from '@/lib/charges';
import { cn } from '@/lib/cn';
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
  const [chargedTo, setChargedTo] = useState('');
  const [kind, setKind] = useState('');
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
      if (chargedTo) params.set('chargedTo', chargedTo);
      if (period) params.set('period', period);
      if (upfrontOnly) params.set('requiresUpfront', 'true');
      setData(await apiClient<ChargesResponse>(`/charges?${params.toString()}`));
    } catch (err) {
      setError(err);
      setData(null);
    }
  }, [status, chargedTo, period, upfrontOnly, page]);

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
  const visible = (data?.items ?? []).filter((row) => !kind || row.kind === kind);
  const hasFilters = status !== 'Pendiente' || !!chargedTo || !!kind || !!period || upfrontOnly;
  const filter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h1">{t('title')}</h1>
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

      <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <ChipGroup
            label={t('filters.status')}
            value={status}
            onChange={(value) => filter(() => setStatus(value))}
            options={[...CHARGE_STATUSES.map((s) => ({ value: s as string, label: t(`statuses.${s}`) })), { value: '', label: t('filters.all') }]}
          />
          <ChipGroup
            label={t('filters.chargedTo')}
            value={chargedTo}
            onChange={(value) => filter(() => setChargedTo(value))}
            options={[{ value: '', label: t('filters.all') }, ...CHARGE_TARGETS.map((c) => ({ value: c as string, label: t(`targets.${c}`) }))]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--color-border)] pt-3">
          <div className="flex items-center gap-2">
            <label htmlFor="charges-kind" className="text-xs font-medium text-[var(--color-muted)]">
              {t('filters.kind')}
            </label>
            <Select id="charges-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-52">
              <option value="">{t('filters.allKinds')}</option>
              {CHARGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
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
          <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
            <input
              type="checkbox"
              checked={upfrontOnly}
              onChange={(e) => filter(() => setUpfrontOnly(e.target.checked))}
            />
            {t('filters.upfrontOnly')}
          </label>
        </div>
      </div>

      <ChargeTable
        items={visible}
        filtered={hasFilters}
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
      {kind && data && data.totalPages > 1 && <p className="text-xs text-[var(--color-muted)]">{t('filters.kindPageNote')}</p>}
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

interface ChipGroupProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

/** Filtro rápido: una fila de chapas donde siempre hay una elegida. */
function ChipGroup({ label, value, options, onChange }: ChipGroupProps) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-medium text-[var(--color-muted)]">{label}</span>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value || 'all'}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-7 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500',
              active
                ? 'border-[var(--color-text)] bg-[var(--color-text)] text-[var(--color-surface)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-slate-400)] hover:text-[var(--color-text)]',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
