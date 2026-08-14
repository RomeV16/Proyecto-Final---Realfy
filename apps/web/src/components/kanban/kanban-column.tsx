'use client';

import { useTranslations } from 'next-intl';
import { useDroppable } from '@dnd-kit/react';
import { CollisionPriority } from '@dnd-kit/abstract';
import type { UniqueIdentifier } from '@dnd-kit/abstract';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/* ──────────── Types ──────────── */

interface KanbanColumnProps {
  id: UniqueIdentifier;
  stageName: string;
  leadCount: number;
  /** Suma de presupuestos de la etapa, ya formateada (ej. "US$ 45.000"). */
  totalValueLabel?: string | null;
  children: ReactNode;
}

/* ──────────── Component ──────────── */

export function KanbanColumn({ id, stageName, leadCount, totalValueLabel, children }: KanbanColumnProps) {
  const t = useTranslations('kanban.column');

  const { ref, isDropTarget } = useDroppable({
    id,
    type: 'column',
    collisionPriority: CollisionPriority.Low,
  });

  const countLabel = leadCount === 1 ? t('leadsSingular') : t('leads', { count: leadCount });

  return (
    <div className="flex min-w-[280px] w-[280px] max-w-[320px] shrink-0 flex-col">
      {/* Encabezado de columna */}
      <div className="mb-2 flex items-start justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[var(--color-text)]" title={stageName}>
            {stageName}
          </h3>
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-muted)]" title={countLabel}>
            {countLabel}
            {totalValueLabel && <span className="tabular-nums"> · {totalValueLabel}</span>}
          </p>
        </div>
        <span className="inline-flex h-5 min-w-[28px] shrink-0 items-center justify-center rounded-full bg-[var(--color-bg)] px-1.5 text-xs font-medium tabular-nums text-[var(--color-muted)]">
          {leadCount}
        </span>
      </div>

      {/* Área de tarjetas con scroll */}
      <div
        ref={ref}
        className={cn(
          'flex-1 space-y-2 overflow-y-auto rounded-[var(--radius-xl)] p-2 transition-colors duration-150',
          isDropTarget
            ? 'bg-[color-mix(in_oklab,var(--color-brand-500)_8%,var(--color-surface))] ring-2 ring-inset ring-[var(--color-brand-300)]'
            : 'bg-[var(--color-bg)]',
        )}
        style={{ minHeight: '120px' }}
      >
        {leadCount === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--color-border)] text-xs text-[var(--color-muted)]">
            {t('empty')}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
