'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import {
  ContractStatus,
  ContractType,
  AdjustmentType,
} from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityCard } from '@/components/ui/entity-card';
import { CardGrid } from '@/components/ui/card-grid';
import { Badge } from '@/components/ui/badge';
import { ProgressRing } from '@/components/ui/micro-viz';

/* ──────────── Types ──────────── */

interface ContractPerson {
  id: string;
  role: string;
  person: { id: string; firstName: string; lastName: string };
}

interface ContractItem {
  id: string;
  contractType: string;
  status: string;
  startDate: string;
  endDate?: string;
  rentAmount?: string | number;
  currency?: string;
  adjustmentType?: string;
  adjustmentPeriod?: string;
  property?: { id: string; title: string; street?: string; city?: string };
  persons?: ContractPerson[];
  isActive: boolean;
  createdAt: string;
}

interface PaginatedResponse {
  items: ContractItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ──────────── Filters ──────────── */

interface Filters {
  status: string;
  adjustmentType: string;
  search: string;
  page: number;
}

const INITIAL_FILTERS: Filters = {
  status: '',
  adjustmentType: '',
  search: '',
  page: 1,
};

const LIMIT = 12;

/* ──────────── Formatting ──────────── */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function formatCurrency(amount: string | number | undefined, currency?: string): string {
  if (amount == null) return '—';
  const prefix = currency === 'USD' ? 'US$ ' : '$ ';
  return prefix + Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Whole calendar months between two dates (can be negative). */
function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** Days from today to `iso` — negative once it's past. */
function daysUntil(iso: string): number {
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

interface TermInfo {
  pct: number;
  elapsed: number;
  total: number;
}

/** "8 de 24 meses" — null when the contract has no end date to measure against. */
function termInfo(contract: ContractItem): TermInfo | null {
  if (!contract.endDate) return null;
  const start = new Date(contract.startDate);
  const end = new Date(contract.endDate);
  const total = Math.max(1, monthsBetween(start, end));
  const elapsed = Math.max(0, Math.min(total, monthsBetween(start, new Date())));
  return { pct: (elapsed / total) * 100, elapsed, total };
}

const ONGOING_STATUSES = new Set([ContractStatus.Activo, ContractStatus.Renovado]);
const EXPIRING_WINDOW_DAYS = 60;

type Accent = 'success' | 'warning' | 'danger' | 'none';

/** Left accent: active reads success, close to term end reads warning,
 *  already expired reads danger, anything terminated/draft stays neutral. */
function contractAccent(contract: ContractItem, expiringSoon: boolean): Accent {
  if (contract.status === ContractStatus.Vencido) return 'danger';
  if (contract.status === ContractStatus.Rescindido || contract.status === ContractStatus.Archivado) return 'none';
  if (contract.status === ContractStatus.Borrador) return 'none';
  return expiringSoon ? 'warning' : 'success';
}

/* ──────────── Card ──────────── */

function ContractCard({ contract, localePrefix }: { contract: ContractItem; localePrefix: string }) {
  const t = useTranslations('contracts');

  const inquilino = contract.persons?.find((p) => p.role === 'Inquilino');
  const tenantName = inquilino
    ? `${inquilino.person.firstName} ${inquilino.person.lastName}`
    : t('wizard.step2.noInquilino');
  const propertyTitle = contract.property?.title || t('card.noProperty');

  const term = termInfo(contract);
  const expiringSoon =
    Boolean(contract.endDate) &&
    ONGOING_STATUSES.has(contract.status as ContractStatus) &&
    (() => {
      const days = daysUntil(contract.endDate!);
      return days >= 0 && days <= EXPIRING_WINDOW_DAYS;
    })();

  const accent = contractAccent(contract, expiringSoon);
  const badgeVariant = accent === 'none' ? 'neutral' : accent;
  const ringTone = accent === 'none' ? 'neutral' : accent;

  /* The card states what's blocking this contract, so the grid doubles as a
     worklist instead of just a catalogue. Priority: missing data first,
     then the contract's actual lifecycle state. */
  const alert = !contract.property
    ? { tone: 'warning' as const, icon: 'alert' as const, text: t('card.needsProperty') }
    : contract.rentAmount == null
      ? { tone: 'warning' as const, icon: 'alert' as const, text: t('card.needsRent') }
      : !contract.endDate
        ? { tone: 'info' as const, icon: 'calendarClock' as const, text: t('card.noEndDate') }
        : contract.status === ContractStatus.Vencido
          ? { tone: 'danger' as const, icon: 'alert' as const, text: t('card.expired') }
          : expiringSoon
            ? { tone: 'warning' as const, icon: 'calendarClock' as const, text: t('guarantee.expiresIn', { days: daysUntil(contract.endDate) }) }
            : null;

  const address = [contract.property?.street, contract.property?.city].filter(Boolean).join(', ');
  const href = `${localePrefix}/contracts/${contract.id}`;

  return (
    <EntityCard href={href} label={`${tenantName} · ${propertyTitle}`} accent={accent}>
      <EntityCard.Cover
        seed={contract.id}
        icon="contracts"
        band
        topLeft={<Badge variant="brand" onCover>{t(`types.${contract.contractType}`)}</Badge>}
        topRight={
          <Badge variant={badgeVariant} dot onCover>
            {t(`statuses.${contract.status}`)}
          </Badge>
        }
      />

      <EntityCard.Body>
        <div className="flex items-start gap-3">
          {term && <ProgressRing value={term.pct} tone={ringTone} label={`${term.elapsed}`} />}
          <div className="min-w-0 flex-1 space-y-0.5">
            <EntityCard.Title>
              {tenantName} → {propertyTitle}
            </EntityCard.Title>
            <EntityCard.Subtitle>
              {term ? t('card.termProgress', { elapsed: term.elapsed, total: term.total }) : formatDate(contract.startDate)}
            </EntityCard.Subtitle>
          </div>
        </div>

        {contract.endDate && (
          <EntityCard.Meta
            items={[{ icon: 'calendar', label: t('card.dateRange', { start: formatDate(contract.startDate), end: formatDate(contract.endDate) }) }]}
          />
        )}

        {contract.rentAmount != null ? (
          <EntityCard.Amount
            value={formatCurrency(contract.rentAmount, contract.currency)}
            hint={contract.adjustmentType ? t(`adjustmentTypes.${contract.adjustmentType}`) : t('card.rent')}
          />
        ) : (
          <EntityCard.Amount value={t('card.noRent')} tone="muted" />
        )}

        {alert && (
          <EntityCard.Alert tone={alert.tone} icon={alert.icon}>
            {alert.text}
          </EntityCard.Alert>
        )}
      </EntityCard.Body>

      <EntityCard.Footer>
        <p className="min-w-0 truncate text-[11px] text-[var(--color-muted)]">
          {address || t('card.noProperty')}
        </p>
        <EntityCard.Actions>
          <EntityCard.Action href={href} icon="arrowRight" variant="ghost">
            {t('card.view')}
          </EntityCard.Action>
        </EntityCard.Actions>
      </EntityCard.Footer>
    </EntityCard>
  );
}

/* ──────────── Main Component ──────────── */

export function ContractList() {
  const t = useTranslations('contracts');
  const tFilters = useTranslations('contracts.filters');
  const tPagination = useTranslations('contracts.pagination');
  const tCommon = useTranslations('common');
  const { user } = useAuth();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);

  const canCreate = ['Admin', 'Gerente', 'Ventas'].includes(user?.role || '');

  const fetchContracts = useCallback(async (f: Filters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(f.page));
      params.set('limit', String(LIMIT));
      if (f.status) params.set('status', f.status);
      if (f.adjustmentType) params.set('adjustmentType', f.adjustmentType);

      const res = await apiClient<PaginatedResponse>(`/contracts?${params.toString()}`);
      setData(res);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        console.error(`[ContractList] fetch error: ${err.statusCode} ${err.errorCode}`);
      }
      setData({ items: [], total: 0, page: 1, limit: LIMIT, totalPages: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContracts(filters);
  }, [filters, fetchContracts]);

  function updateFilter(key: keyof Filters, value: string | number) {
    setFilters((prev) => ({ ...prev, [key]: value, page: key === 'page' ? (value as number) : 1 }));
  }

  function clearFilters() {
    setFilters(INITIAL_FILTERS);
  }

  const hasFilters = filters.status || filters.adjustmentType || filters.search;
  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Link
              href={`${localePrefix}/contracts/new`}
              className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 active:bg-brand-700 transition-colors shadow-sm flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {t('newContract')}
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label htmlFor="filter-status" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('status')}
            </label>
            <select
              id="filter-status"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{tFilters('statusPlaceholder')}</option>
              {Object.values(ContractStatus).map((s) => (
                <option key={s} value={s}>{t(`statuses.${s}`)}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-adjType" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('adjustmentType')}
            </label>
            <select
              id="filter-adjType"
              value={filters.adjustmentType}
              onChange={(e) => updateFilter('adjustmentType', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{tFilters('adjustmentTypePlaceholder')}</option>
              {Object.values(AdjustmentType).map((at) => (
                <option key={at} value={at}>{t(`adjustmentTypes.${at}`)}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-search" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('property')}
            </label>
            <div className="flex gap-2">
              <input
                id="filter-search"
                type="text"
                value={filters.search}
                onChange={(e) => updateFilter('search', e.target.value)}
                placeholder={tFilters('propertyPlaceholder')}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              />
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                  title={tFilters('clear')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Grid — owns the loading → content → empty transition */}
      <div>
        <CardGrid
          items={items}
          loading={loading && !data}
          busy={loading && !!data}
          columns={3}
          skeletonCount={6}
          keyOf={(c) => c.id}
          renderItem={(contract) => (
            <ContractCard contract={contract} localePrefix={localePrefix} />
          )}
          empty={
            hasFilters ? (
              <EmptyState
                variant="filtered"
                iconName="search"
                title={tCommon('noResults')}
                subtitle={t('empty.filtered')}
                action={
                  <button
                    onClick={clearFilters}
                    className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg)]"
                  >
                    {tFilters('clear')}
                  </button>
                }
              />
            ) : (
              <EmptyState
                iconName="contracts"
                title={t('empty.title')}
                subtitle={t('empty.description')}
                steps={[t('empty.step1'), t('empty.step2'), t('empty.step3')]}
                action={
                  canCreate && (
                    <Link
                      href={`${localePrefix}/contracts/new`}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-brand-500)] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--color-brand-600)]"
                    >
                      {t('newContract')}
                    </Link>
                  )
                }
              />
            )
          }
        />
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <p className="text-sm text-slate-500">
            {tPagination('showing', {
              from: (filters.page - 1) * LIMIT + 1,
              to: Math.min(filters.page * LIMIT, total),
              total,
            })}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => updateFilter('page', filters.page - 1)}
              disabled={filters.page <= 1}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {tPagination('prev')}
            </button>
            <span className="text-sm text-slate-600 tabular-nums px-2">
              {tCommon('page')} {filters.page} {tCommon('of')} {totalPages}
            </span>
            <button
              onClick={() => updateFilter('page', filters.page + 1)}
              disabled={filters.page >= totalPages}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {tPagination('next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
