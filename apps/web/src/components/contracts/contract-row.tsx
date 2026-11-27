'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ContractStatus, addMonthsClamped, periodToMonths } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { formatDate, formatMoneyFixed, toUtcDay } from '@/lib/format';

/* ──────────── Types ──────────── */

interface ContractPerson {
  id: string;
  role: string;
  person: { id: string; firstName: string; lastName: string };
}

export interface ContractItem {
  id: string;
  contractType: string;
  status: string;
  startDate: string;
  endDate?: string | null;
  rentAmount?: string | number | null;
  /** La API expone la moneda del alquiler como `rentCurrency`. */
  rentCurrency?: string;
  currency?: string;
  adjustmentType?: string | null;
  adjustmentPeriod?: string | null;
  property?: { id: string; title: string; street?: string; number?: string | null; city?: string } | null;
  persons?: ContractPerson[];
  isActive: boolean;
  createdAt: string;
}

/* ──────────── Cálculos de vigencia ──────────── */

const DAY_MS = 86_400_000;
const ONGOING_STATUSES = new Set<string>([ContractStatus.Activo, ContractStatus.Renovado]);
const EXPIRING_WINDOW_DAYS = 60;

function todayUtc(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

function monthsBetween(fromDay: number, toDay: number): number {
  const a = new Date(fromDay);
  const b = new Date(toDay);
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  return b.getUTCDate() < a.getUTCDate() ? months - 1 : months;
}

export interface TermInfo {
  /** Avance del plazo, de 0 a 100. */
  pct: number;
  /** Mes del contrato que está corriendo (1 = el primero). */
  currentMonth: number;
  totalMonths: number;
  /** Días hasta la fecha de fin; negativo si ya pasó. */
  daysLeft: number;
  started: boolean;
}

/**
 * Avance del plazo. Un contrato del 1/2/2026 al 31/1/2028 dura 24 meses: el
 * total se cuenta hasta el día siguiente al de fin. Sin fecha de fin no hay
 * plazo que medir.
 */
export function termInfo(startDate: string, endDate?: string | null, today = todayUtc()): TermInfo | null {
  const start = toUtcDay(startDate);
  const end = toUtcDay(endDate);
  if (start === null || end === null || end <= start) return null;
  const totalMonths = Math.max(1, monthsBetween(start, end + DAY_MS));
  const started = today >= start;
  const elapsedMonths = started ? monthsBetween(start, today) : 0;
  const pct = Math.max(0, Math.min(100, ((today - start) / (end - start)) * 100));
  return {
    pct,
    currentMonth: Math.max(1, Math.min(totalMonths, elapsedMonths + 1)),
    totalMonths,
    daysLeft: Math.round((end - today) / DAY_MS),
    started,
  };
}

/**
 * Fecha del próximo ajuste según el cronograma del contrato (inicio + N
 * períodos). Null si no tiene ajuste o si ya no queda ninguno antes del fin.
 */
export function nextAdjustmentDate(contract: ContractItem, today = todayUtc()): Date | null {
  if (!contract.adjustmentType || !contract.adjustmentPeriod) return null;
  const start = toUtcDay(contract.startDate);
  if (start === null) return null;
  let every: number;
  try {
    every = periodToMonths(contract.adjustmentPeriod);
  } catch {
    return null;
  }
  const end = toUtcDay(contract.endDate);
  const elapsed = Math.max(0, monthsBetween(start, today));
  let next = addMonthsClamped(new Date(start), (Math.floor(elapsed / every) + 1) * every);
  if (next.getTime() <= today) next = addMonthsClamped(next, every);
  if (end !== null && next.getTime() > end) return null;
  return next;
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  [ContractStatus.Activo]: 'success',
  [ContractStatus.Renovado]: 'info',
  [ContractStatus.Vencido]: 'danger',
  [ContractStatus.Borrador]: 'warning',
  [ContractStatus.Rescindido]: 'neutral',
  [ContractStatus.Archivado]: 'neutral',
};

const BAR_TONE = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  neutral: 'var(--color-muted)',
} as const;

/** Columnas compartidas por el encabezado y las filas en escritorio. */
export const CONTRACT_GRID =
  'lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(0,1.25fr)_minmax(0,0.95fr)_minmax(0,1fr)_6.5rem_1rem]';

/* ──────────── Encabezado ──────────── */

export function ContractListHeader() {
  const t = useTranslations('contracts.list.columns');
  return (
    <div
      aria-hidden="true"
      className={cn(
        'hidden items-center gap-x-5 border-b border-[var(--color-border)] px-5 py-2.5 lg:grid',
        'text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]',
        CONTRACT_GRID,
      )}
    >
      <span>{t('tenant')}</span>
      <span>{t('property')}</span>
      <span>{t('term')}</span>
      <span>{t('nextAdjustment')}</span>
      <span className="text-right">{t('rent')}</span>
      <span>{t('status')}</span>
      <span />
    </div>
  );
}

/* ──────────── Fila ──────────── */

function fullName(p?: ContractPerson): string {
  return p ? `${p.person.firstName} ${p.person.lastName}`.trim() : '';
}

export function ContractRow({ contract }: { contract: ContractItem }) {
  const t = useTranslations('contracts');
  const locale = useLocale();

  const tenant = fullName(contract.persons?.find((p) => p.role === 'Inquilino'));
  const lessors = (contract.persons ?? []).filter((p) => p.role === 'Propietario');
  const property = contract.property;
  const address = [[property?.street, property?.number].filter(Boolean).join(' '), property?.city]
    .filter(Boolean)
    .join(', ');
  const currency = contract.rentCurrency || contract.currency;

  const ongoing = ONGOING_STATUSES.has(contract.status);
  const term = termInfo(contract.startDate, contract.endDate);
  const expiringSoon = Boolean(term) && ongoing && term!.daysLeft >= 0 && term!.daysLeft <= EXPIRING_WINDOW_DAYS;
  const expired = contract.status === ContractStatus.Vencido;
  const closed = contract.status === ContractStatus.Rescindido || contract.status === ContractStatus.Archivado;
  const barTone = expired ? 'danger' : expiringSoon ? 'warning' : ongoing ? 'success' : 'neutral';
  const next = ongoing ? nextAdjustmentDate(contract) : null;

  let termCaption: string;
  if (!term) termCaption = t('list.openEnded', { start: formatDate(contract.startDate, 'medium', locale) });
  else if (expired) termCaption = t('card.expired');
  else if (closed) termCaption = t('list.closedTerm');
  else if (!term.started) termCaption = t('list.startsOn', { date: formatDate(contract.startDate, 'medium', locale) });
  else if (expiringSoon) termCaption = t('list.endsIn', { days: term.daysLeft });
  else termCaption = t('list.termProgress', { current: term.currentMonth, total: term.totalMonths });

  const statusBadge = (
    <Badge variant={STATUS_VARIANT[contract.status] ?? 'neutral'} dot>
      {t(`statuses.${contract.status}`)}
    </Badge>
  );

  return (
    <li className={cn('relative', closed && 'opacity-75')}>
      <Link
        href={`/contracts/${contract.id}`}
        className={cn(
          'group grid grid-cols-2 items-center gap-x-5 gap-y-3 px-4 py-4 transition-colors sm:px-5',
          'hover:bg-[var(--color-surface-sunken)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500',
          CONTRACT_GRID,
        )}
      >
        {/* Partes */}
        <div className="col-span-2 flex min-w-0 items-start justify-between gap-3 lg:col-span-1">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--color-text)] group-hover:text-[var(--color-brand-600)]">
              {tenant || t('list.noTenant')}
            </p>
            <p className="truncate text-xs text-[var(--color-muted)]">
              {lessors.length === 0
                ? t('list.noLessor')
                : lessors.length === 1
                  ? t('list.lessor', { name: fullName(lessors[0]) })
                  : t('list.lessors', { name: fullName(lessors[0]), count: lessors.length - 1 })}
              {contract.contractType !== 'Alquiler' && ` · ${t(`types.${contract.contractType}`)}`}
            </p>
          </div>
          <span className="shrink-0 lg:hidden">{statusBadge}</span>
        </div>

        {/* Propiedad */}
        <div className="col-span-2 min-w-0 lg:col-span-1">
          {property ? (
            <>
              <p className="truncate text-sm text-[var(--color-text)]">{property.title}</p>
              {address && <p className="truncate text-xs text-[var(--color-muted)]">{address}</p>}
            </>
          ) : (
            <p className="inline-flex items-center gap-1.5 text-sm text-[var(--color-warning)]">
              <Icon name="alert" className="h-3.5 w-3.5" strokeWidth={2} />
              {t('card.needsProperty')}
            </p>
          )}
        </div>

        {/* Vigencia */}
        <div className="col-span-2 min-w-0 lg:col-span-1">
          {term ? (
            <>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(term.pct)}
                aria-label={t('list.columns.term')}
                className="h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--color-muted)_22%,transparent)]"
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(term.pct, 2)}%`, backgroundColor: BAR_TONE[barTone] }}
                />
              </div>
              <div className="mt-1 flex justify-between gap-2 text-[11px] tabular-nums text-[var(--color-muted)]">
                <span>{formatDate(contract.startDate, 'monthYear', locale)}</span>
                <span>{formatDate(contract.endDate, 'monthYear', locale)}</span>
              </div>
            </>
          ) : null}
          <p
            className={cn(
              'truncate text-xs',
              term && 'mt-0.5',
              expired
                ? 'font-medium text-[var(--color-danger)]'
                : expiringSoon
                  ? 'font-medium text-[var(--color-warning)]'
                  : 'text-[var(--color-muted)]',
            )}
          >
            {termCaption}
          </p>
        </div>

        {/* Próximo ajuste */}
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] lg:hidden">
            {t('list.columns.nextAdjustment')}
          </p>
          {contract.adjustmentType ? (
            <>
              <p className="truncate text-sm tabular-nums text-[var(--color-text)]">
                {next ? formatDate(next, 'medium', locale) : t('list.noMoreAdjustments')}
              </p>
              <p className="truncate text-xs text-[var(--color-muted)]">
                {[
                  t(`adjustmentTypes.${contract.adjustmentType}`),
                  contract.adjustmentPeriod ? t(`adjustmentPeriods.${contract.adjustmentPeriod}`).toLowerCase() : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">{t('list.noAdjustment')}</p>
          )}
        </div>

        {/* Alquiler actual */}
        <div className="min-w-0 text-right">
          <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] lg:hidden">
            {t('list.columns.rent')}
          </p>
          {contract.rentAmount != null ? (
            <p className="truncate text-sm font-semibold tabular-nums text-[var(--color-text)]">
              {formatMoneyFixed(contract.rentAmount, currency, locale)}
            </p>
          ) : (
            <p className="text-sm text-[var(--color-warning)]">{t('card.needsRent')}</p>
          )}
        </div>

        <div className="hidden lg:block">{statusBadge}</div>
        <Icon
          name="chevronRight"
          className="hidden h-4 w-4 text-[var(--color-muted)] transition-transform group-hover:translate-x-0.5 lg:block"
          strokeWidth={1.75}
        />
      </Link>
    </li>
  );
}

/** Filas de carga con la misma estructura que `ContractRow`. */
export function ContractRowsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <ul aria-hidden="true" className="divide-y divide-[var(--color-border)]">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className={cn('grid grid-cols-2 items-center gap-x-5 gap-y-3 px-4 py-4 sm:px-5', CONTRACT_GRID)}>
          <div className="col-span-2 space-y-2 lg:col-span-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <div className="col-span-2 space-y-2 lg:col-span-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <div className="col-span-2 space-y-2 lg:col-span-1">
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="ml-auto h-4 w-24" />
          <Skeleton className="hidden h-5 w-16 rounded-full lg:block" />
          <span className="hidden lg:block" />
        </li>
      ))}
    </ul>
  );
}
