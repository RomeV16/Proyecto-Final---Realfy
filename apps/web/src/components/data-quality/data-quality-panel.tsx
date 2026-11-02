'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  DATA_QUALITY_CHECKS,
  type DataQualityCheckId,
  type DataQualityFinding,
  type DataQualityPage,
  type DataQualitySummary,
} from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Icon } from '@/components/ui/icon';
import { MergePersonsDialog } from './merge-persons';

const PAGE_SIZE = 20;
const GROUPS = ['duplicates', 'lessors', 'ownerships', 'contracts'] as const;
const FIELD_KEYS = new Set([
  'cuit', 'dni', 'bankAccounts', 'phone', 'email', 'name', 'lessors', 'ownerships', 'payoutMethod',
  'status', 'endDate', 'tenant', 'rentAmount', 'adjustment',
]);

/** Panel de calidad de datos: un resumen por control y, al elegir uno, sus hallazgos con el enlace para corregirlos. */
export function DataQualityPanel() {
  const t = useTranslations('dataQuality');
  const locale = useLocale();
  const canView = useCan('dataQuality.view');
  const canMerge = useCan('dataQuality.merge');

  const [summary, setSummary] = useState<DataQualitySummary | null>(null);
  const [summaryError, setSummaryError] = useState<unknown>(null);
  const [selected, setSelected] = useState<DataQualityCheckId | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DataQualityPage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [merging, setMerging] = useState<DataQualityFinding | null>(null);

  const loadSummary = useCallback(async () => {
    setSummaryError(null);
    try {
      const s = await apiClient<DataQualitySummary>('/data-quality');
      setSummary(s);
      // Si no hay ninguno elegido, se abre el primer control con hallazgos.
      setSelected((current) => current ?? s.checks.find((c) => c.count > 0)?.check ?? null);
    } catch (err) {
      setSummaryError(err);
    }
  }, []);

  useEffect(() => {
    if (canView) void loadSummary();
  }, [canView, loadSummary]);

  const loadFindings = useCallback(async () => {
    if (!selected) return;
    setData(null);
    setError(null);
    try {
      setData(await apiClient<DataQualityPage>(`/data-quality/${selected}?page=${page}&limit=${PAGE_SIZE}`));
    } catch (err) {
      setError(err);
    }
  }, [selected, page]);

  useEffect(() => {
    if (canView && selected) void loadFindings();
  }, [canView, selected, loadFindings]);

  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  function choose(check: DataQualityCheckId) {
    setSelected(check);
    setPage(1);
  }

  function refresh() {
    void loadSummary();
    void loadFindings();
  }

  function detail(f: DataQualityFinding): string | null {
    const d = f.details ?? {};
    switch (f.check) {
      case 'lessors-sum':
        return t('details.lessorsSum', { sum: d.sum as number, lessors: d.lessors as number });
      case 'ownership-sum': {
        const base = t('details.ownershipSum', { sum: d.sum as number, owners: d.owners as number });
        return (d.withoutShare as number) > 0 ? `${base} · ${t('details.withoutShare', { count: d.withoutShare as number })}` : base;
      }
      case 'contract-expired-undecided':
        return t('details.expired', { date: formatDate(String(d.effectiveEnd), undefined, locale) });
      default:
        return f.members ? t('details.duplicate', { count: f.members.length }) : null;
    }
  }

  const columns: DataTableColumn<DataQualityFinding>[] = [
    {
      key: 'finding',
      header: t('columns.finding'),
      render: (f) =>
        f.members ? (
          <ul className="space-y-0.5">
            {f.members.map((m) => (
              <li key={m.id}>
                <Link href={`/persons/${m.id}`} className="font-medium hover:underline">
                  {m.label}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Link href={f.link} className="font-medium hover:underline">
            {f.label}
          </Link>
        ),
    },
    {
      key: 'fields',
      header: t('columns.fields'),
      render: (f) => (
        <span className="flex flex-wrap gap-1">
          {f.fields.map((field) => (
            <Badge key={field} variant="neutral">
              {FIELD_KEYS.has(field) ? t(`fields.${field}` as 'fields.cuit') : field}
            </Badge>
          ))}
        </span>
      ),
    },
    { key: 'detail', header: t('columns.detail'), render: (f) => detail(f) ?? '—' },
    {
      key: 'severity',
      header: t('columns.severity'),
      render: (f) => (
        <Badge variant={f.severity === 'error' ? 'danger' : 'warning'} dot>
          {t(`severity.${f.severity}`)}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t('columns.actions'),
      render: (f) => (
        <span className="flex flex-wrap items-center gap-2">
          <Link
            href={f.link}
            aria-label={t('openFinding', { label: f.label })}
            className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
          >
            <Icon name="externalLink" className="h-4 w-4" />
            {t('open')}
          </Link>
          {canMerge && f.members && f.members.length > 1 && (
            <Button size="sm" variant="secondary" onClick={() => setMerging(f)}>
              {t('merge.button')}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
          {summary && (
            <p className="mt-2 text-sm font-medium" aria-live="polite">
              {t('total', { count: summary.total })}
            </p>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={refresh}>
          <Icon name="refresh" className="h-4 w-4" />
          {t('refresh')}
        </Button>
      </div>

      {summaryError ? <ErrorNotice error={summaryError} fallback={t('loadError')} /> : null}

      {summary &&
        GROUPS.map((group) => (
          <section key={group} aria-labelledby={`dq-group-${group}`} className="space-y-2">
            <h2 id={`dq-group-${group}`} className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              {t(`groups.${group}`)}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {summary.checks
                .filter((c) => DATA_QUALITY_CHECKS.find((d) => d.id === c.check)?.group === group)
                .map((c) => (
                  <button
                    key={c.check}
                    type="button"
                    onClick={() => choose(c.check)}
                    aria-pressed={selected === c.check}
                    className={cn(
                      'rounded-xl border bg-[var(--color-surface)] p-4 text-left transition-colors hover:border-[var(--color-brand-500)]',
                      selected === c.check ? 'border-[var(--color-brand-500)]' : 'border-[var(--color-border)]',
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{t(`checks.${c.check}.title`)}</span>
                      <Badge variant={c.count === 0 ? 'success' : c.severity === 'error' ? 'danger' : 'warning'}>
                        {c.count}
                      </Badge>
                    </span>
                    <span className="mt-1 block text-xs text-[var(--color-muted)]">{t(`checks.${c.check}.description`)}</span>
                  </button>
                ))}
            </div>
          </section>
        ))}

      {selected && (
        <section aria-label={t(`checks.${selected}.title`)} className="space-y-3">
          <h2 className="text-base font-semibold">{t(`checks.${selected}.title`)}</h2>
          <DataTable
            items={data?.items ?? []}
            columns={columns}
            keyExtractor={(f) => f.id}
            loading={data === null && !error}
            error={error}
            empty={{ iconName: 'check', title: t('empty.title'), subtitle: t('empty.subtitle') }}
            pagination={
              data
                ? { page: data.page, totalPages: data.totalPages, total: data.total, limit: data.limit, onPageChange: setPage }
                : undefined
            }
          />
        </section>
      )}

      {merging?.members && (
        <MergePersonsDialog
          key={merging.id}
          members={merging.members}
          open
          onClose={() => setMerging(null)}
          onMerged={() => {
            setMerging(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
