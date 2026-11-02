'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { formatMoneyFixed, formatNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

interface Payoff {
  date: string;
  balance: string;
  total: string;
  penalty: {
    accrued: string;
    waived: string;
    alreadyBilled: string;
    due: string;
    daysOverdue: number;
    graceDays: number;
    capHit: boolean;
    rule: {
      source: 'contract' | 'tenant';
      mode: string;
      daysWithoutRate?: number;
      bnaDays?: number;
      floorDays?: number;
    };
  } | null;
}

/** Día de hoy en formato `YYYY-MM-DD` (calendario local del navegador). */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * "Calcular para pagar hoy": el saldo más los punitorios devengados a una fecha,
 * sin guardar nada. Es el monto exacto que se le da al inquilino; desde acá se
 * registra el pago ya con los punitorios.
 */
export function PayoffPanel({
  liquidacionId,
  currency,
  onPay,
}: {
  liquidacionId: string;
  currency?: string;
  onPay: (amount: string, date: string) => void;
}) {
  const t = useTranslations('punitorios.payoff');
  const [date, setDate] = useState(today);
  const [result, setResult] = useState<Payoff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function calculate() {
    setLoading(true);
    setError(null);
    try {
      setResult(await apiClient<Payoff>(`/liquidaciones/${liquidacionId}/payoff?date=${date}`));
    } catch (err) {
      setResult(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  const penalty = result?.penalty ?? null;
  const due = penalty ? Number(penalty.due) : 0;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="payoff-title">
      <h2 id="payoff-title" className="text-sm font-semibold text-slate-900">
        {t('title')}
      </h2>
      <p className="mt-1 text-xs text-slate-500">{t('description')}</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <FormField label={t('date')}>
          {(c) => <Input {...c} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </FormField>
        <Button variant="secondary" onClick={calculate} disabled={loading || !date}>
          {loading && <Spinner className="h-4 w-4" />}
          {t('calculate')}
        </Button>
      </div>
      {error != null && (
        <div className="mt-3">
          <ErrorNotice error={error} fallback={t('error')} />
        </div>
      )}
      {result && (
        <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-4 text-sm" aria-live="polite">
          <div className="flex justify-between text-slate-600">
            <span>{t('balance')}</span>
            <span className="tabular-nums">{formatMoneyFixed(result.balance, currency)}</span>
          </div>
          {penalty && (
            <>
              <div className="flex justify-between text-slate-600">
                <span>{t('penalties', { days: penalty.daysOverdue })}</span>
                <span className="tabular-nums">{formatMoneyFixed(penalty.due, currency)}</span>
              </div>
              {Number(penalty.waived) > 0 && (
                <p className="text-xs text-slate-500">{t('waived', { amount: formatMoneyFixed(penalty.waived, currency) })}</p>
              )}
              {Number(penalty.alreadyBilled) > 0 && (
                <p className="text-xs text-slate-500">
                  {t('alreadyBilled', { amount: formatMoneyFixed(penalty.alreadyBilled, currency) })}
                </p>
              )}
              {penalty.capHit && <p className="text-xs text-amber-700">{t('capHit')}</p>}
              {penalty.rule.mode === 'max_bna_or_daily' && (penalty.rule.daysWithoutRate ?? 0) > 0 && (
                <p className="text-xs text-amber-700">{t('noRate', { days: formatNumber(penalty.rule.daysWithoutRate) })}</p>
              )}
              <p className="text-xs text-slate-400">
                {t(penalty.rule.source === 'contract' ? 'ruleContract' : 'ruleTenant')}
              </p>
            </>
          )}
          <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold text-slate-900">
            <span>{t('total')}</span>
            <span className="tabular-nums">{formatMoneyFixed(result.total, currency)}</span>
          </div>
          <div className="pt-2">
            <Button variant="accent" size="sm" onClick={() => onPay(result.total, result.date)}>
              {due > 0 ? t('registerWithPenalties') : t('register')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
