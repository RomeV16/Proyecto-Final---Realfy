'use client';

import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import { RendicionStatus } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { StatusBadge } from '@/components/ui/status-badge';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { formatLocalDate, formatMoneyFixed } from '@/lib/format';

/* ──────────── Tipos y cálculo ──────────── */

export interface RenditionSummary {
  id: string;
  status: RendicionStatus;
  /** La API manda `period` (primer día del mes); `month`/`year` quedan por compatibilidad. */
  period?: string | null;
  month?: number;
  year?: number;
  rentCollected: string | number;
  commissionAmount?: string | number;
  adminFeeAmount?: string | number;
  deductionTotal?: string | number;
  netDeposit: string | number;
  currency?: string;
  sentAt?: string | null;
  depositedAt?: string | null;
  contract?: {
    id: string;
    property?: { id: string; title: string; street?: string; number?: string | null; city?: string };
  };
  ownerId?: string;
  owner?: { firstName: string; lastName: string; cuit?: string | null } | null;
  ownerName?: string;
}

/** "Septiembre 2026", con el nombre del mes que da `monthName`; guion si no hay período. */
export function renditionPeriodLabel(
  r: Pick<RenditionSummary, 'period' | 'month' | 'year'>,
  monthName: (month: number) => string,
): string {
  if (r.year && r.month) return `${monthName(r.month)} ${r.year}`;
  const date = r.period ? new Date(r.period) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  return `${monthName(date.getUTCMonth() + 1)} ${date.getUTCFullYear()}`;
}

export function renditionOwnerName(r: Pick<RenditionSummary, 'owner' | 'ownerName'>): string | null {
  if (r.owner) return `${r.owner.firstName} ${r.owner.lastName}`.trim() || null;
  return r.ownerName || null;
}

export interface RenditionBreakdown {
  collected: number;
  /** Comisión más honorarios de administración. */
  fees: number;
  expenses: number;
  net: number;
}

const num = (value: string | number | null | undefined) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function renditionBreakdown(r: RenditionSummary): RenditionBreakdown {
  return {
    collected: num(r.rentCollected),
    fees: num(r.commissionAmount) + num(r.adminFeeAmount),
    expenses: num(r.deductionTotal),
    net: num(r.netDeposit),
  };
}

/** Número corto del talón: los primeros 8 caracteres del id. */
export function renditionNumber(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export const BREAKDOWN_COLORS = {
  net: 'var(--color-success)',
  fees: 'var(--color-brand-500)',
  expenses: 'var(--color-warning)',
} as const;

/** Barra apilada: cómo se reparte lo cobrado entre el locador, los honorarios y los gastos. */
export function BreakdownBar({ breakdown, label, className }: { breakdown: RenditionBreakdown; label: string; className?: string }) {
  const base = breakdown.collected > 0 ? breakdown.collected : breakdown.net + breakdown.fees + breakdown.expenses;
  const parts = (['net', 'fees', 'expenses'] as const).filter((key) => breakdown[key] > 0);
  return (
    <div
      role="img"
      aria-label={label}
      className={cn('flex h-2.5 gap-0.5 overflow-hidden rounded-sm bg-[var(--color-border)]', className)}
    >
      {base > 0 &&
        parts.map((key) => (
          <span
            key={key}
            className="h-full"
            style={{ width: `${(breakdown[key] / base) * 100}%`, backgroundColor: BREAKDOWN_COLORS[key] }}
          />
        ))}
    </div>
  );
}

/* ──────────── Talón ──────────── */

interface VoucherProps {
  rendition: RenditionSummary;
  onDownloadPdf: (id: string) => void;
}

/**
 * Una rendición como talón de pago: a la izquierda el período y el número,
 * a la derecha la cuenta que explica cuánto se le transfiere al locador.
 */
export function RenditionVoucher({ rendition, onDownloadPdf }: VoucherProps) {
  const t = useTranslations('renditions');
  const tVoucher = useTranslations('renditions.voucher');
  const tCard = useTranslations('renditions.card');

  const tMonths = useTranslations('renditions.months');
  const period = renditionPeriodLabel(rendition, (m) => tMonths(String(m) as '1'));
  const owner = renditionOwnerName(rendition);
  const property = rendition.contract?.property;
  const propertyLine = property
    ? [property.title, [property.street, property.number].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
    : tCard('noProperty');
  const breakdown = renditionBreakdown(rendition);
  const money = (value: number) => formatMoneyFixed(value, rendition.currency);
  const deposited = rendition.status === RendicionStatus.Depositada;
  const href = `/renditions/${rendition.id}`;

  const stamp =
    deposited && rendition.depositedAt
      ? tVoucher('depositedOn', { date: formatLocalDate(rendition.depositedAt) })
      : rendition.sentAt
        ? tVoucher('sentOn', { date: formatLocalDate(rendition.sentAt) })
        : null;

  const terms = [
    { key: 'collected', op: null, label: tVoucher('collected'), value: breakdown.collected, color: null },
    { key: 'fees', op: '−', label: tVoucher('fees'), value: breakdown.fees, color: BREAKDOWN_COLORS.fees },
    { key: 'expenses', op: '−', label: tVoucher('expenses'), value: breakdown.expenses, color: BREAKDOWN_COLORS.expenses },
  ] as const;

  return (
    <article
      aria-label={`${period} · ${owner ?? tCard('noOwner')}`}
      className="relative flex flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] sm:flex-row"
    >
      {/* Talón */}
      <div className="relative flex shrink-0 flex-row items-center justify-between gap-3 border-b border-dashed border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-4 py-3 sm:w-52 sm:flex-col sm:items-start sm:justify-between sm:border-b-0 sm:border-r sm:py-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">{tVoucher('stub')}</p>
          <h3 className="font-display text-base font-semibold leading-tight tracking-tight text-[var(--color-text)]">{period}</h3>
        </div>
        <div className="text-right sm:text-left">
          <p className="font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
            {tVoucher('number', { number: renditionNumber(rendition.id) })}
          </p>
          <StatusBadge domain="rendicion" status={rendition.status} className="mt-1.5" />
        </div>
        {/* Muescas de la línea de corte */}
        <span aria-hidden="true" className="absolute -right-2 -top-2 hidden h-4 w-4 rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] sm:block" />
        <span aria-hidden="true" className="absolute -bottom-2 -right-2 hidden h-4 w-4 rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] sm:block" />
      </div>

      {/* Cuerpo */}
      <div className="min-w-0 flex-1 space-y-3 px-4 py-3.5 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{tVoucher('payTo')}</p>
            <p className="truncate text-sm font-semibold text-[var(--color-text)]">{owner ?? tCard('noOwner')}</p>
            <p className="truncate text-xs text-[var(--color-muted)]">{propertyLine}</p>
          </div>
          {stamp && (
            <p className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)]">
              {deposited && <Icon name="check" className="h-3.5 w-3.5 text-[var(--color-success)]" strokeWidth={2.25} />}
              {stamp}
            </p>
          )}
        </div>

        {/* cobrado − honorarios − gastos = neto */}
        <dl className="flex flex-col gap-1 sm:flex-row sm:items-end sm:gap-3">
          {terms.map((term) => (
            <Fragment key={term.key}>
              {term.op && (
                <span aria-hidden="true" className="hidden pb-0.5 font-mono text-base text-[var(--color-muted)] sm:block">
                  {term.op}
                </span>
              )}
              <div className="flex items-baseline justify-between gap-3 sm:block">
                <dt className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
                  {term.color && <span aria-hidden="true" className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: term.color }} />}
                  {term.label}
                </dt>
                <dd
                  className={cn(
                    'font-mono text-sm tabular-nums',
                    term.value === 0 && term.op ? 'text-[var(--color-muted)]' : 'text-[var(--color-text)]',
                  )}
                >
                  {term.op && <span aria-hidden="true" className="sm:hidden">{term.op} </span>}
                  {money(term.value)}
                </dd>
              </div>
            </Fragment>
          ))}
          <span aria-hidden="true" className="hidden pb-0.5 font-mono text-base text-[var(--color-muted)] sm:block">=</span>
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-[var(--color-border)] pt-2 sm:ml-auto sm:mt-0 sm:block sm:border-t-0 sm:pt-0 sm:text-right">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text)] sm:justify-end">
              <span aria-hidden="true" className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: BREAKDOWN_COLORS.net }} />
              {deposited ? tVoucher('netPaid') : tVoucher('net')}
            </dt>
            <dd className="font-mono text-lg font-semibold tabular-nums text-[var(--color-text)]">{money(breakdown.net)}</dd>
          </div>
        </dl>

        <BreakdownBar
          breakdown={breakdown}
          label={tVoucher('barLabel', { net: money(breakdown.net), collected: money(breakdown.collected) })}
        />

        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => onDownloadPdf(rendition.id)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]"
          >
            <Icon name="download" className="h-3.5 w-3.5" strokeWidth={2} />
            {t('pdf.download')}
          </button>
          <Link
            href={href}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-sunken)]"
          >
            {tCard('view')}
            <Icon name="arrowRight" className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        </div>
      </div>
    </article>
  );
}

export function VoucherSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="hidden w-44 space-y-2 border-r border-dashed border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-4 sm:block">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-28" />
          </div>
          <div className="flex-1 space-y-3 p-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-2.5 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
