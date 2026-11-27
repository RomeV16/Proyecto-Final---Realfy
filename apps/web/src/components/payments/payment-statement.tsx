'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatLocalDate, formatMoney, formatPercent, formatPeriod } from '@/lib/format';
import { Icon } from '@/components/ui/icon';
import {
  groupByDay,
  methodBreakdown,
  totalsByCurrency,
  type CurrencyTotal,
  type PaymentRow,
} from './statement';

type Tone = 'info' | 'success' | 'brand' | 'warning' | 'neutral';

const METHOD_TONE: Record<string, Tone> = {
  Transferencia: 'info',
  Efectivo: 'success',
  MercadoPago: 'brand',
  Cheque: 'warning',
  AplicacionDeposito: 'neutral',
};

const TONE_COLOR: Record<Tone, string> = {
  info: 'var(--color-info)',
  success: 'var(--color-success)',
  brand: 'var(--color-brand-500)',
  warning: 'var(--color-warning)',
  neutral: 'var(--color-muted)',
};

const toneOf = (method: string): Tone => METHOD_TONE[method] ?? 'neutral';

/** Nombre del medio de pago; uno que la pantalla no conoce se muestra tal cual. */
function useMethodLabel() {
  const t = useTranslations('payments');
  return (method: string) => (t.has(`methods.${method}`) ? t(`methods.${method}`) : method);
}

/** Chapa del medio de pago: rectangular y en mayúsculas, como el código de operación de un resumen bancario. */
export function MethodTag({ method }: { method: string }) {
  const label = useMethodLabel();
  const color = TONE_COLOR[toneOf(method)];
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-[4px] border px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-wider"
      style={{
        color: `color-mix(in oklab, ${color} 78%, var(--color-text))`,
        borderColor: `color-mix(in oklab, ${color} 34%, var(--color-border))`,
        backgroundColor: `color-mix(in oklab, ${color} 9%, var(--color-surface))`,
      }}
    >
      {label(method)}
    </span>
  );
}

/* ──────────── Navegación por mes ──────────── */

interface MonthNavProps {
  /** `YYYY-MM`. */
  month: string;
  isCurrent: boolean;
  onOlder?: () => void;
  onNewer?: () => void;
}

export function monthLabel(month: string, locale?: string): string {
  const [year, m] = month.split('-').map(Number);
  return formatPeriod(year, m, locale);
}

export function MonthNav({ month, isCurrent, onOlder, onNewer }: MonthNavProps) {
  const t = useTranslations('payments');
  const locale = useLocale();
  const arrow =
    'inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-sunken)] disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={arrow} onClick={onOlder} disabled={!onOlder} aria-label={t('statement.older')}>
        <Icon name="chevronLeft" className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" className={arrow} onClick={onNewer} disabled={!onNewer} aria-label={t('statement.newer')}>
        <Icon name="chevronRight" className="h-4 w-4" aria-hidden="true" />
      </button>
      <h2 className="ml-1 font-display text-xl text-[var(--color-text)]" aria-live="polite">
        {monthLabel(month, locale)}
      </h2>
      {isCurrent && (
        <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-muted)]">
          {t('statement.thisMonth')}
        </span>
      )}
    </div>
  );
}

/* ──────────── Resumen del mes ──────────── */

export interface DebtSummary {
  pendiente: { count: number; monto: number };
  vencida: { count: number; monto: number };
}

interface SummaryProps {
  /** Cobros del mes elegido. */
  items: PaymentRow[];
  debt: DebtSummary | null;
  debtLoading: boolean;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-muted)]">{children}</p>;
}

/** Cabecera del extracto: lo cobrado en el mes, su reparto por medio de pago y lo que falta cobrar. */
export function PaymentSummary({ items, debt, debtLoading }: SummaryProps) {
  const t = useTranslations('payments');
  const locale = useLocale();
  const label = useMethodLabel();
  const totals = totalsByCurrency(items);
  const main: CurrencyTotal = totals[0] ?? { currency: 'ARS', amount: '0.00', count: 0 };
  const others = totals.slice(1);
  const methods = methodBreakdown(items, main.currency);
  const money = (value: string | number, currency = 'ARS', decimals = 2) => formatMoney(value, currency, { decimals, locale });

  return (
    <section
      aria-label={t('summary.label')}
      className="grid grid-cols-1 divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0"
    >
      <div className="p-5">
        <Eyebrow>{t('summary.collected')}</Eyebrow>
        <p className="mt-2 break-words font-mono text-[28px] font-medium leading-tight tracking-tight text-[var(--color-text)] tabular-nums">
          {money(main.amount, main.currency)}
        </p>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{t('collectedHint', { count: main.count })}</p>
        {others.map((o) => (
          <p key={o.currency} className="mt-1 text-sm text-[var(--color-muted)]">
            {t('summary.alsoIn', { amount: money(o.amount, o.currency), count: o.count })}
          </p>
        ))}
      </div>

      <div className="p-5">
        <Eyebrow>{t('summary.byMethod')}</Eyebrow>
        {methods.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">{t('summary.noMethods')}</p>
        ) : (
          <>
            <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
              {methods.map((m) => (
                <span
                  key={m.method}
                  className="h-full min-w-[3px] rounded-full"
                  style={{ width: `${m.share}%`, backgroundColor: TONE_COLOR[toneOf(m.method)] }}
                />
              ))}
            </div>
            <ul className="mt-3 space-y-1.5">
              {methods.map((m) => (
                <li key={m.method} className="flex items-baseline gap-2 text-sm">
                  <span
                    className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-[2px]"
                    style={{ backgroundColor: TONE_COLOR[toneOf(m.method)] }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">
                    {label(m.method)}
                    <span className="ml-1.5 text-xs text-[var(--color-muted)]">{t('summary.count', { count: m.count })}</span>
                  </span>
                  <span className="font-mono text-[13px] text-[var(--color-text)] tabular-nums">{money(m.amount, main.currency)}</span>
                  <span className="w-12 text-right font-mono text-xs text-[var(--color-muted)] tabular-nums">
                    {formatPercent(m.share, { decimals: 0, locale })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="p-5">
        <Eyebrow>{t('summary.toCollect')}</Eyebrow>
        {debtLoading ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">{t('summary.loadingDebt')}</p>
        ) : debt === null ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">{t('summary.debtError')}</p>
        ) : (
          <dl className="mt-3 space-y-2.5">
            <DebtLine
              label={t('overdueDebt')}
              amount={money(debt.vencida.monto, 'ARS', 0)}
              hint={t('summary.settlements', { count: debt.vencida.count })}
              tone={debt.vencida.count > 0 ? 'var(--color-danger)' : undefined}
            />
            <DebtLine
              label={t('pendingDebt')}
              amount={money(debt.pendiente.monto, 'ARS', 0)}
              hint={t('summary.settlements', { count: debt.pendiente.count })}
            />
          </dl>
        )}
        <Link
          href="/cobranza"
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[var(--color-brand-600)] hover:underline"
        >
          {t('summary.goToCollections')}
          <Icon name="arrowRight" className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function DebtLine({ label, amount, hint, tone }: { label: string; amount: string; hint: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-[var(--color-text)]">
        {label}
        <span className="ml-1.5 text-xs text-[var(--color-muted)]">{hint}</span>
      </dt>
      <dd className="font-mono text-[15px] font-medium tabular-nums" style={{ color: tone ?? 'var(--color-text)' }}>
        {amount}
      </dd>
    </div>
  );
}

/* ──────────── Extracto ──────────── */

export interface ContractLabel {
  property: string;
  tenant: string;
}

interface StatementProps {
  items: PaymentRow[];
  /** Propiedad e inquilino de cada contrato, para nombrar el cobro. */
  contracts: Record<string, ContractLabel>;
  /** Acción por cobro (por ejemplo, abrir su facturación). */
  renderAction?: (payment: PaymentRow) => ReactNode;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Extracto de cobros de un mes, como un resumen bancario: una línea de tiempo con un bloque por día, cada cobro
 * en su renglón con el medio de pago y el importe alineado, el total de cada día y el total del mes al pie.
 */
export function PaymentStatement({ items, contracts, renderAction }: StatementProps) {
  const t = useTranslations('payments');
  const locale = useLocale();
  const days = groupByDay(items);
  const monthTotals = totalsByCurrency(items);
  const money = (value: string, currency: string) => formatMoney(value, currency, { decimals: 2, locale });

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <ol>
        {days.map((day) => {
          const date = new Date(`${day.day}T12:00:00`);
          return (
            <li
              key={day.day}
              className="border-b border-[var(--color-border)] md:grid md:grid-cols-[112px_minmax(0,1fr)]"
            >
              <div className="flex items-baseline gap-2 bg-[var(--color-surface-sunken)] px-4 py-2 md:block md:bg-transparent md:px-5 md:py-4 md:text-right">
                <time dateTime={day.day} className="md:block">
                  <span className="font-mono text-base font-medium text-[var(--color-text)] tabular-nums md:block md:text-2xl md:leading-none">
                    {formatLocalDate(date, { day: '2-digit' }, locale)}
                  </span>{' '}
                  <span className="text-xs text-[var(--color-muted)] md:mt-1 md:block">
                    {capitalize(formatLocalDate(date, { weekday: 'long' }, locale))}
                  </span>
                </time>
              </div>

              <div className="relative md:border-l md:border-[var(--color-border)]">
                <span
                  className="absolute -left-[5px] top-[22px] hidden h-[9px] w-[9px] rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-brand-500)] md:block"
                  aria-hidden="true"
                />
                <ul className="divide-y divide-dashed divide-[var(--color-border)]">
                  {day.items.map((p) => {
                    const contract = p.liquidacion?.contract?.id ? contracts[p.liquidacion.contract.id] : undefined;
                    const period = p.liquidacion?.period ? formatPeriod(p.liquidacion.period, undefined, locale) : null;
                    const concept = period ? t('statement.rentOf', { period: locale === 'es' ? period.toLowerCase() : period }) : t('statement.noPeriod');
                    return (
                      <li
                        key={p.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 md:grid-cols-[minmax(0,1fr)_128px_150px_auto] md:px-5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--color-text)]">{contract?.property ?? concept}</p>
                          <p className="truncate text-xs text-[var(--color-muted)]">
                            {[contract ? concept : null, contract?.tenant, p.reference ? t('statement.reference', { reference: p.reference }) : null]
                              .filter(Boolean)
                              .join(' · ') || t('statement.noDetail')}
                          </p>
                        </div>
                        <div className="col-start-1 row-start-2 md:col-start-auto md:row-start-auto">
                          <MethodTag method={p.method} />
                        </div>
                        <p className="col-start-2 row-start-1 text-right font-mono text-sm font-medium text-[var(--color-text)] tabular-nums md:col-start-auto md:row-start-auto">
                          {money(p.amount, p.currency)}
                        </p>
                        {renderAction && (
                          <div className="col-start-2 row-start-2 justify-self-end md:col-start-auto md:row-start-auto">
                            {renderAction(p)}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-0.5 border-t border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-surface-sunken)_60%,var(--color-surface))] px-4 py-2 md:px-5">
                  <span className="text-xs text-[var(--color-muted)]">{t('statement.dayTotal', { count: day.items.length })}</span>
                  {day.totals.map((total) => (
                    <span key={total.currency} className="font-mono text-[13px] font-medium text-[var(--color-text)] tabular-nums">
                      {money(total.amount, total.currency)}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5 md:px-5">
        <span className="text-sm font-medium text-[var(--color-text)]">{t('statement.monthTotal', { count: items.length })}</span>
        <span className="flex flex-wrap items-baseline justify-end gap-x-4">
          {monthTotals.map((total) => (
            <span key={total.currency} className="font-mono text-base font-semibold text-[var(--color-text)] tabular-nums">
              {money(total.amount, total.currency)}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
