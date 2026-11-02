'use client';

import { useTranslations } from 'next-intl';
import { FEE_KINDS, FEE_PAYER_ROLES } from '@/lib/fees';
import type { DataTablePagination } from '@/components/ui/data-table';
import { inputStyles } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/** Un `type` (no una interfaz) para que sirva como filtros de `usePaginatedList`. */
export type FeeFilterValues = {
  kind: string;
  status: string;
  payerRole: string;
  period: string;
};

export const EMPTY_FEE_FILTERS: FeeFilterValues = { kind: '', status: '', payerRole: '', period: '' };

type FilterName = keyof FeeFilterValues & string;

interface Props {
  idPrefix: string;
  values: FeeFilterValues;
  onFilter: (name: FilterName, value: string) => void;
  /** Estados que se ofrecen y la clave i18n de su etiqueta (los del honorario o los de la cuota). */
  statuses: readonly string[];
  statusLabel: (status: string) => string;
}

/** Filtros de los listados de honorarios y de cuotas: operación, estado, quién paga y mes. */
export function FeeFilters({ idPrefix, values, onFilter, statuses, statusLabel }: Props) {
  const t = useTranslations('fees');
  const id = (name: string) => `${idPrefix}-${name}`;
  const label = (name: string) => (
    <label htmlFor={id(name)} className="text-xs font-medium text-[var(--color-muted)]">
      {t(`filters.${name}`)}
    </label>
  );

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1">
        {label('kind')}
        <Select id={id('kind')} value={values.kind} onChange={(e) => onFilter('kind', e.target.value)} className="w-48">
          <option value="">{t('filters.all')}</option>
          {FEE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        {label('status')}
        <Select id={id('status')} value={values.status} onChange={(e) => onFilter('status', e.target.value)} className="w-40">
          <option value="">{t('filters.all')}</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        {label('payerRole')}
        <Select id={id('payerRole')} value={values.payerRole} onChange={(e) => onFilter('payerRole', e.target.value)} className="w-40">
          <option value="">{t('filters.all')}</option>
          {FEE_PAYER_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        {label('period')}
        <input
          id={id('period')}
          type="month"
          value={values.period}
          onChange={(e) => onFilter('period', e.target.value)}
          className={inputStyles({ className: 'w-44' })}
        />
      </div>
    </div>
  );
}


/** Paginación de un listado de `usePaginatedList`; sin barra si entra en una página. */
export function listPagination(list: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  setPage: (page: number) => void;
}): DataTablePagination | undefined {
  return list.totalPages > 1
    ? { page: list.page, totalPages: list.totalPages, total: list.total, limit: list.limit, onPageChange: list.setPage }
    : undefined;
}
