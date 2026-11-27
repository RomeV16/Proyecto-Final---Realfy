'use client';

import { useTranslations } from 'next-intl';
import { LiquidacionStatus } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { formatDate, formatLocalDate, formatMoneyFixed, formatPeriod, toUtcDay } from '@/lib/format';

/* ──────────── Tipos ──────────── */

export interface LedgerItem {
  id: string;
  status: string;
  period?: string;
  month?: number;
  year?: number;
  dueDate?: string;
  paidAt?: string | null;
  totalAmount?: string | number;
  total?: string | number;
  subtotal?: string | number;
  currency?: string;
  kind?: string;
  isProvisional?: boolean;
  contractId?: string;
  contract?: {
    id: string;
    property?: { id: string; title: string; street?: string; number?: string | null; city?: string };
  };
  _count?: { payments: number };
}

export interface LedgerTotals {
  currency: string;
  issued: number;
  collected: number;
  pending: number;
  overdue: number;
}

export interface LedgerGroup {
  /** `2026-12`, o `none` si la liquidación no trae período. */
  key: string;
  year?: number;
  month?: number;
  items: LedgerItem[];
  totals: LedgerTotals[];
}

type Attention = 'overdue' | 'approval' | 'open' | 'paid' | 'void';

const DAY_MS = 86_400_000;
const ATTENTION_ORDER: Attention[] = ['overdue', 'approval', 'open', 'paid', 'void'];

/* ──────────── Cálculo ──────────── */

export function amountOf(item: LedgerItem): number {
  const value = Number(item.totalAmount || item.total || item.subtotal || 0);
  return Number.isFinite(value) ? value : 0;
}

/** Qué le pide cada liquidación a quien administra: es lo que ordena y resalta las filas. */
export function attentionOf(item: LedgerItem): Attention {
  switch (item.status) {
    case LiquidacionStatus.Vencida:
      return 'overdue';
    case LiquidacionStatus.Borrador:
    case LiquidacionStatus.Revision:
      return 'approval';
    case LiquidacionStatus.Pagada:
      return 'paid';
    case LiquidacionStatus.Anulada:
      return 'void';
    default:
      return 'open';
  }
}

function periodOf(item: LedgerItem): { year?: number; month?: number } {
  if (item.month && item.year) return { year: item.year, month: item.month };
  const date = item.period ? new Date(item.period) : null;
  if (!date || Number.isNaN(date.getTime())) return {};
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** Totales del mes por moneda. Las anuladas no suman. */
export function summarize(items: LedgerItem[]): LedgerTotals[] {
  const byCurrency = new Map<string, LedgerTotals>();
  for (const item of items) {
    const attention = attentionOf(item);
    if (attention === 'void') continue;
    const currency = item.currency || 'ARS';
    const totals = byCurrency.get(currency) ?? { currency, issued: 0, collected: 0, pending: 0, overdue: 0 };
    const amount = amountOf(item);
    totals.issued += amount;
    if (attention === 'paid') totals.collected += amount;
    else if (attention === 'overdue') totals.overdue += amount;
    else totals.pending += amount;
    byCurrency.set(currency, totals);
  }
  return [...byCurrency.values()].sort((a, b) => (a.currency === 'ARS' ? -1 : b.currency === 'ARS' ? 1 : 0));
}

/** Agrupa por período, del más reciente al más viejo; dentro del mes, primero lo que hay que atender. */
export function groupByPeriod(items: LedgerItem[]): LedgerGroup[] {
  const groups = new Map<string, LedgerGroup>();
  for (const item of items) {
    const { year, month } = periodOf(item);
    const key = year && month ? `${year}-${String(month).padStart(2, '0')}` : 'none';
    const group = groups.get(key) ?? { key, year, month, items: [], totals: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const titleOf = (item: LedgerItem) => item.contract?.property?.title ?? '';
  return [...groups.values()]
    .sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : b.key.localeCompare(a.key)))
    .map((group) => ({
      ...group,
      items: [...group.items].sort(
        (a, b) =>
          ATTENTION_ORDER.indexOf(attentionOf(a)) - ATTENTION_ORDER.indexOf(attentionOf(b)) ||
          titleOf(a).localeCompare(titleOf(b)),
      ),
      totals: summarize(group.items),
    }));
}

function todayUtc(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/* ──────────── Encabezado del mes ──────────── */

const SEGMENTS = [
  { key: 'collected', color: 'var(--color-success)' },
  { key: 'pending', color: 'var(--color-warning)' },
  { key: 'overdue', color: 'var(--color-danger)' },
] as const;

function TotalsLine({ totals }: { totals: LedgerTotals }) {
  const t = useTranslations('liquidaciones.ledger');
  const money = (value: number) => formatMoneyFixed(value, totals.currency);
  const share = (value: number) => (totals.issued > 0 ? (value / totals.issued) * 100 : 0);

  return (
    <div className="space-y-2.5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{t('issued')}</dt>
          <dd className="font-mono text-sm font-medium tabular-nums text-[var(--color-text)]">{money(totals.issued)}</dd>
        </div>
        {SEGMENTS.map((segment) => {
          const value = totals[segment.key];
          const quiet = value === 0;
          return (
            <div key={segment.key}>
              <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-[2px]"
                  style={{ backgroundColor: segment.color, opacity: quiet ? 0.35 : 1 }}
                />
                {t(segment.key)}
              </dt>
              <dd
                className={cn(
                  'font-mono text-sm tabular-nums',
                  quiet ? 'text-[var(--color-muted)]' : 'font-medium text-[var(--color-text)]',
                )}
                style={
                  !quiet && segment.key === 'overdue'
                    ? { color: 'color-mix(in oklab, var(--color-danger) 80%, var(--color-text))' }
                    : undefined
                }
              >
                {money(value)}
              </dd>
            </div>
          );
        })}
      </dl>
      <div
        role="img"
        aria-label={t('barLabel', { collected: money(totals.collected), issued: money(totals.issued) })}
        className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-[var(--color-border)]"
      >
        {SEGMENTS.map((segment) =>
          totals[segment.key] > 0 ? (
            <span
              key={segment.key}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${share(totals[segment.key])}%`, backgroundColor: segment.color }}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}

/* ──────────── Fila ──────────── */

const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 md:grid-cols-[minmax(0,1fr)_8.5rem_9.5rem_9.5rem_5.5rem] md:items-center md:gap-x-4';

interface RowProps {
  item: LedgerItem;
  tenantName?: string;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  onDownload: () => void;
}

function LedgerRow({ item, tenantName, selectable, selected, onToggle, onDownload }: RowProps) {
  const t = useTranslations('liquidaciones');
  const tLedger = useTranslations('liquidaciones.ledger');
  const tCard = useTranslations('liquidaciones.card');
  const tKinds = useTranslations('liquidaciones.kinds');

  const attention = attentionOf(item);
  const property = item.contract?.property;
  const title = property?.title || tCard('noProperty');
  const address = property ? [[property.street, property.number].filter(Boolean).join(' '), property.city].filter(Boolean).join(', ') : '';
  const secondary = [tenantName, address].filter(Boolean).join(' · ');
  const href = `/liquidaciones/${item.id}`;

  const due = toUtcDay(item.dueDate);
  const daysLate = attention === 'overdue' && due !== null ? Math.max(0, Math.round((todayUtc() - due) / DAY_MS)) : null;
  const calm = attention === 'paid' || attention === 'void';

  return (
    <li
      className={cn(
        ROW_GRID,
        'border-l-2 px-4 py-2.5 transition-colors',
        attention === 'overdue' && 'bg-[color-mix(in_oklab,var(--color-danger)_6%,var(--color-surface))]',
        selected && 'bg-[color-mix(in_oklab,var(--color-brand-500)_8%,var(--color-surface))]',
      )}
      style={{
        borderLeftColor:
          attention === 'overdue'
            ? 'var(--color-danger)'
            : attention === 'approval'
              ? 'var(--color-warning)'
              : 'transparent',
      }}
    >
      {/* Propiedad e inquilino */}
      <div className="col-start-1 row-start-1 flex min-w-0 items-start gap-3 md:col-auto md:row-auto md:items-center">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={tLedger('selectRow', { name: title })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--color-border)] accent-[var(--color-brand-500)] md:mt-0"
          />
        )}
        <div className="min-w-0">
          <Link
            href={href}
            className={cn(
              'block truncate text-sm font-medium hover:underline',
              calm ? 'text-[var(--color-muted)]' : 'text-[var(--color-text)]',
              attention === 'void' && 'line-through',
            )}
          >
            {title}
          </Link>
          {secondary && <p className="truncate text-xs text-[var(--color-muted)]">{secondary}</p>}
        </div>
      </div>

      {/* Vencimiento y estado: una línea en móvil, dos columnas en escritorio */}
      <div className="col-start-1 row-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
        <div className="min-w-0 md:col-auto md:row-auto">
          <p className={cn('font-mono text-xs tabular-nums', calm ? 'text-[var(--color-muted)]' : 'text-[var(--color-text)]')}>
            <span className="md:hidden">{tLedger('dueShort')} </span>
            {formatDate(item.dueDate)}
          </p>
          {daysLate !== null && (
            <p
              className="text-xs font-medium"
              style={{ color: 'color-mix(in oklab, var(--color-danger) 80%, var(--color-text))' }}
            >
              {tLedger('overdueDays', { days: daysLate })}
            </p>
          )}
          {attention === 'paid' && item.paidAt && (
            <p className="hidden text-xs text-[var(--color-muted)] md:block">
              {tLedger('paidOn', { date: formatLocalDate(item.paidAt, 'dayMonth') })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 md:col-auto md:row-auto">
          <StatusBadge domain="liquidacion" status={item.status} />
          {attention === 'approval' && (
            <span
              className="inline-flex items-center gap-1 text-xs font-medium"
              style={{ color: 'color-mix(in oklab, var(--color-warning) 75%, var(--color-text))' }}
            >
              <Icon name="clock" className="h-3.5 w-3.5" strokeWidth={2} />
              {tLedger('needsApproval')}
            </span>
          )}
          {item.kind && item.kind !== 'Mensual' && <Badge variant="info">{tKinds(item.kind)}</Badge>}
          {item.isProvisional && <Badge variant="warning">{t('provisional')}</Badge>}
        </div>
      </div>

      {/* Importe */}
      <p
        className={cn(
          'col-start-2 row-start-1 text-right font-mono text-sm tabular-nums md:col-auto md:row-auto',
          calm ? 'text-[var(--color-muted)]' : 'font-semibold text-[var(--color-text)]',
          attention === 'void' && 'line-through',
        )}
      >
        {formatMoneyFixed(amountOf(item), item.currency)}
      </p>

      {/* Acciones */}
      <div className="col-start-2 row-start-2 flex items-center justify-end gap-1 md:col-auto md:row-auto">
        {attention !== 'void' && (
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]"
          >
            <Icon name="download" className="h-3.5 w-3.5" strokeWidth={2} />
            {tCard('downloadPdf')}
          </button>
        )}
        <Link
          href={href}
          aria-label={`${tCard('view')}: ${title}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]"
        >
          <Icon name="arrowRight" className="h-4 w-4" strokeWidth={2} />
        </Link>
      </div>
    </li>
  );
}

/* ──────────── Mes ──────────── */

interface MonthProps {
  group: LedgerGroup;
  tenantNames: Record<string, string>;
  selectable: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleMany: (ids: string[], select: boolean) => void;
  onDownload: (id: string) => void;
}

export function LedgerMonth({ group, tenantNames, selectable, selectedIds, onToggle, onToggleMany, onDownload }: MonthProps) {
  const t = useTranslations('liquidaciones.ledger');
  const tTable = useTranslations('liquidaciones.table');
  const tBulk = useTranslations('liquidaciones.bulk');
  const label = group.year && group.month ? formatPeriod(group.year, group.month) : t('noPeriod');
  const ids = group.items.map((item) => item.id);
  const allSelected = ids.every((id) => selectedIds.has(id));

  return (
    <section
      aria-label={label}
      className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <header className="space-y-3 border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-4 py-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-display text-lg font-semibold tracking-tight text-[var(--color-text)]">{label}</h2>
          <div className="flex items-center gap-4">
            {selectable && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-muted)]">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onToggleMany(ids, !allSelected)}
                  className="h-3.5 w-3.5 rounded border-[var(--color-border)] accent-[var(--color-brand-500)]"
                />
                {tBulk('selectAll')}
              </label>
            )}
            <p className="text-xs text-[var(--color-muted)]">{t('count', { count: group.items.length })}</p>
          </div>
        </div>
        {group.totals.map((totals) => (
          <TotalsLine key={totals.currency} totals={totals} />
        ))}
      </header>

      <div
        aria-hidden="true"
        className={cn(
          ROW_GRID,
          'hidden border-b border-l-2 border-[var(--color-border)] border-l-transparent px-4 py-1.5 text-[11px] uppercase tracking-wider text-[var(--color-muted)] md:grid',
        )}
      >
        <span>{t('colProperty')}</span>
        <span>{tTable('dueDate')}</span>
        <span>{tTable('status')}</span>
        <span className="text-right">{t('colAmount')}</span>
        <span />
      </div>

      <ul className="divide-y divide-[var(--color-border)]">
        {group.items.map((item) => (
          <LedgerRow
            key={item.id}
            item={item}
            tenantName={item.contract?.id ? tenantNames[item.contract.id] : undefined}
            selectable={selectable}
            selected={selectedIds.has(item.id)}
            onToggle={() => onToggle(item.id)}
            onDownload={() => onDownload(item.id)}
          />
        ))}
      </ul>
    </section>
  );
}

/** Esqueleto con la forma del libro: encabezado de mes y filas. */
export function LedgerSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-5">
      {[5, 3].map((rows, i) => (
        <div key={i} className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="space-y-3 bg-[var(--color-surface-sunken)] px-4 py-3.5">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {Array.from({ length: rows }).map((_, row) => (
              <div key={row} className="flex items-center justify-between gap-4 px-4 py-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
