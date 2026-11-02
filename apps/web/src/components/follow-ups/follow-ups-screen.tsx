'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import type { Paged } from '@/lib/cash';
import { KINDS, LIGHTS, type FollowUp } from '@/lib/follow-ups';
import { useOptionalAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { FollowUpDrawer } from './follow-up-drawer';

const LIMIT = 25;

interface Filters {
  light: string;
  kind: string;
  status: string;
  mine: boolean;
}

const INITIAL: Filters = { light: '', kind: '', status: 'Abierto', mine: false };

/**
 * Vencimientos: los contratos que se acercan a su fin (o ya lo pasaron) con el semáforo, el responsable y el avance
 * del checklist de cada seguimiento. Cada fila abre el seguimiento para trabajarlo.
 */
export function FollowUpsScreen() {
  const t = useTranslations('followUps');
  const userId = useOptionalAuth()?.user?.id ?? null;
  // Los hallazgos de calidad de datos enlazan acá con el contrato elegido.
  const contractId = useSearchParams()?.get('contractId') ?? '';
  const [filters, setFilters] = useState<Filters>(INITIAL);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<FollowUp> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<FollowUp | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (filters.light) params.set('light', filters.light);
      if (filters.kind) params.set('kind', filters.kind);
      if (!filters.light && filters.status) params.set('status', filters.status);
      if (contractId) params.set('contractId', contractId);
      if (filters.mine && userId) params.set('assigneeId', userId);
      setData(await apiClient<Paged<FollowUp>>(`/follow-ups?${params.toString()}`));
    } catch (err) {
      setError(err);
      setData(null);
    }
  }, [filters, page, userId, contractId]);

  useEffect(() => {
    void load();
  }, [load]);

  function change(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }

  function updated(next: FollowUp) {
    setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === next.id ? next : i)) } : d));
  }

  const columns: DataTableColumn<FollowUp>[] = [
    {
      key: 'light',
      header: t('columns.light'),
      render: (f) => (f.light ? <StatusBadge domain="vencimiento" status={f.light} /> : <span className="text-[var(--color-muted)]">—</span>),
    },
    { key: 'property', header: t('columns.property'), render: (f) => f.property ?? '—' },
    { key: 'tenant', header: t('columns.tenant'), render: (f) => f.tenantName ?? '—' },
    {
      key: 'end',
      header: t('columns.end'),
      render: (f) => (
        <div>
          <DateText value={f.effectiveEnd} />
          {f.effectiveEnd !== f.signedEnd && (
            <span className="ml-1.5 text-xs text-[var(--color-muted)]">({t('oralExtension.badge')})</span>
          )}
        </div>
      ),
    },
    {
      key: 'days',
      header: t('columns.days'),
      alignRight: true,
      render: (f) => <span className="tabular-nums">{f.daysLeft}</span>,
    },
    { key: 'kind', header: t('columns.kind'), render: (f) => t(`kinds.${f.kind}`) },
    {
      key: 'progress',
      header: t('columns.progress'),
      render: (f) => (
        <span className="tabular-nums">
          {f.progress.done}/{f.progress.total}
        </span>
      ),
    },
    {
      key: 'assignee',
      header: t('columns.assignee'),
      render: (f) => (f.assigneeId ? (f.assigneeId === userId ? t('drawer.me') : t('columns.assigned')) : t('drawer.unassigned')),
    },
    {
      key: 'actions',
      header: t('columns.actions'),
      render: (f) => (
        <Button type="button" size="sm" variant="secondary" onClick={() => setSelected(f)}>
          {t('open')}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <FormField label={t('filters.light')} className="w-44">
          {(c) => (
            <Select {...c} value={filters.light} onChange={(e) => change({ light: e.target.value })}>
              <option value="">{t('filters.all')}</option>
              {LIGHTS.map((light) => (
                <option key={light} value={light}>
                  {t(`lights.${light}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t('filters.kind')} className="w-44">
          {(c) => (
            <Select {...c} value={filters.kind} onChange={(e) => change({ kind: e.target.value })}>
              <option value="">{t('filters.all')}</option>
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`kinds.${kind}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t('filters.status')} className="w-44">
          {(c) => (
            <Select {...c} value={filters.status} disabled={!!filters.light} onChange={(e) => change({ status: e.target.value })}>
              <option value="">{t('filters.all')}</option>
              <option value="Abierto">{t('statuses.Abierto')}</option>
              <option value="Cerrado">{t('statuses.Cerrado')}</option>
            </Select>
          )}
        </FormField>
        <label className="flex items-center gap-2 pb-2 text-sm text-[var(--color-text)]">
          <input type="checkbox" checked={filters.mine} onChange={(e) => change({ mine: e.target.checked })} className="h-4 w-4" />
          {t('filters.mine')}
        </label>
      </div>

      <DataTable
        items={data?.items ?? []}
        columns={columns}
        keyExtractor={(f) => f.id}
        loading={data === null && error == null}
        error={error}
        pagination={
          data && data.totalPages > 1
            ? { page: data.page, totalPages: data.totalPages, total: data.total, limit: data.limit, onPageChange: setPage }
            : undefined
        }
        empty={{ title: t('empty.title'), subtitle: t('empty.subtitle'), iconName: 'contracts' }}
      />

      {selected && <FollowUpDrawer followUp={selected} onClose={() => setSelected(null)} onChanged={updated} />}
    </div>
  );
}
