'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import type { Paged } from '@/lib/cash';
import { KINDS, LIGHTS, type FollowUp } from '@/lib/follow-ups';
import { useOptionalAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { PaginationBar } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FollowUpAgenda } from './follow-up-agenda';
import { FollowUpDrawer } from './follow-up-drawer';

// Lo más que devuelve la API por página: la agenda cuenta por tramo lo que tiene cargado.
const LIMIT = 100;

interface Filters {
  light: string;
  kind: string;
  status: string;
  mine: boolean;
}

const INITIAL: Filters = { light: '', kind: '', status: 'Abierto', mine: false };

/**
 * Vencimientos: la agenda de los contratos que se acercan a su fin (o ya lo pasaron), agrupados por cuándo
 * vencen, con el responsable y el avance del checklist de cada seguimiento. Cada renglón abre el seguimiento.
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

  const items = data?.items ?? [];
  const filtered = filters.light !== '' || filters.kind !== '' || filters.status !== INITIAL.status || filters.mine;

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

      {error != null && <ErrorNotice error={error} />}

      {data === null && error == null && (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      )}

      {data !== null && items.length === 0 && (
        <EmptyState
          variant={filtered ? 'filtered' : 'default'}
          iconName={filtered ? 'search' : 'calendarClock'}
          title={filtered ? t('empty.filteredTitle') : t('empty.title')}
          subtitle={filtered ? t('empty.filteredSubtitle') : t('empty.subtitle')}
          action={
            filtered ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => change(INITIAL)}>
                {t('empty.clear')}
              </Button>
            ) : undefined
          }
        />
      )}

      {items.length > 0 && <FollowUpAgenda items={items} userId={userId} onOpen={setSelected} />}

      {data && data.totalPages > 1 && (
        <PaginationBar page={data.page} totalPages={data.totalPages} total={data.total} limit={data.limit} onPageChange={setPage} />
      )}

      {selected && <FollowUpDrawer followUp={selected} onClose={() => setSelected(null)} onChanged={updated} />}
    </div>
  );
}
