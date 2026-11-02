'use client';

import { useTranslations } from 'next-intl';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { FEE_STATUSES, type Fee } from '@/lib/fees';
import { EMPTY_FEE_FILTERS, FeeFilters, listPagination } from './fee-filters';
import { FeeTable } from './fee-table';

const LIMIT = 50;

/** Honorarios cargados, con filtros; cada uno abre su detalle con las cuotas y los repartos. */
export function FeeListPanel() {
  const t = useTranslations('fees');
  const list = usePaginatedList<Fee, typeof EMPTY_FEE_FILTERS>({
    key: 'fees',
    path: '/fees',
    limit: LIMIT,
    initialFilters: EMPTY_FEE_FILTERS,
  });

  return (
    <div className="space-y-4">
      <FeeFilters
        idPrefix="fees"
        values={list.filters}
        onFilter={list.setFilter}
        statuses={FEE_STATUSES}
        statusLabel={(s) => t(`statuses.${s}`)}
      />
      <FeeTable
        items={list.items}
        loading={list.isLoading}
        error={list.error}
        onChanged={() => void list.refetch()}
        pagination={listPagination(list)}
      />
    </div>
  );
}
