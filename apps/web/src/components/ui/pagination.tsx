'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

interface PaginationBarProps {
  page: number;
  totalPages: number;
  total: number;
  /** Tamaño de página, para el "Mostrando 1-12 de 40". */
  limit: number;
  onPageChange: (page: number) => void;
  className?: string;
}

const BUTTON =
  'rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-sunken)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';

/** Barra de paginación de las listas: rango visible, anterior y siguiente. No se muestra con una sola página. */
export function PaginationBar({ page, totalPages, total, limit, onPageChange, className }: PaginationBarProps) {
  const t = useTranslations('dataTable.pagination');
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label={t('label')}
      className={cn('flex flex-col items-center justify-between gap-4 pt-2 sm:flex-row', className)}
    >
      <p className="text-sm text-[var(--color-muted)]">
        {t('showing', { from: (page - 1) * limit + 1, to: Math.min(page * limit, total), total })}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" className={BUTTON} onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          {t('prev')}
        </button>
        <span className="px-2 text-sm tabular-nums text-[var(--color-muted)]" aria-current="page">
          {t('page', { page, totalPages })}
        </span>
        <button type="button" className={BUTTON} onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          {t('next')}
        </button>
      </div>
    </nav>
  );
}
