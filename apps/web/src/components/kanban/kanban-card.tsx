'use client';

import { useTranslations } from 'next-intl';
import { useSortable } from '@dnd-kit/react/sortable';
import type { UniqueIdentifier } from '@dnd-kit/abstract';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';

/* ──────────── Types ──────────── */

export interface KanbanLead {
  id: string;
  person: { id?: string; firstName: string; lastName: string };
  currentStage: { id: string; name: string };
  pipeline: { id: string; name: string };
  source: string;
  status: string;
  assignedToUser?: { firstName: string; lastName: string } | null;
  createdAt: string;
  updatedAt: string;
  lastContactAt?: string | null;
  property?: { title?: string } | null;
  budget?: string | number | null;
  budgetCurrency?: string | null;
}

interface KanbanCardProps {
  id: UniqueIdentifier;
  index: number;
  column: UniqueIdentifier;
  lead: KanbanLead;
  staleDays?: number | null;
}

/* ──────────── Helpers ──────────── */

function daysAgo(dateStr: string): number {
  const now = new Date();
  const d = new Date(dateStr);
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

function formatBudget(value: string | number | null | undefined, currency?: string | null): string | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  const symbol = currency === 'USD' ? 'US$' : '$';
  return `${symbol} ${n.toLocaleString('es-AR')}`;
}

/* ──────────── Component ──────────── */

/**
 * Tarjeta compacta de arrastre. Deliberadamente plana — sin `EntityCard` (sin
 * link estirado, sin animación de layout): dnd-kit necesita controlar el
 * `transform` de este elemento mientras se arrastra, y una transición `layout`
 * o un link superpuesto compitiendo con eso lo rompería. El levantamiento y
 * escalado al arrastrar viene de `data-dragging`, aplicado más abajo.
 */
export function KanbanCard({ id, index, column, lead, staleDays }: KanbanCardProps) {
  const t = useTranslations('kanban.card');
  const tSources = useTranslations('leads.sources');

  const { ref, isDragging } = useSortable({
    id,
    index,
    type: 'item',
    accept: ['item'],
    group: column,
  });

  const fullName = `${lead.person.firstName} ${lead.person.lastName}`;
  const propertyName = lead.property?.title || t('noProperty');
  const days = daysAgo(lead.updatedAt);
  const budgetLabel = formatBudget(lead.budget, lead.budgetCurrency);

  // Sin contacto: compara lastContactAt (o updatedAt) contra el staleDays de la etapa.
  const contactDays = daysAgo(lead.lastContactAt ?? lead.updatedAt);
  const isStale = staleDays != null && contactDays > staleDays;

  return (
    <div
      ref={ref}
      data-dragging={isDragging || undefined}
      className={cn(
        'group relative flex cursor-grab flex-col gap-2 rounded-[var(--radius-xl)] border bg-[var(--color-surface)] p-3',
        'shadow-[var(--shadow-sm)] transition-[box-shadow,border-color] duration-150 active:cursor-grabbing',
        'hover:border-[color-mix(in_oklab,var(--color-brand-500)_30%,var(--color-border))] hover:shadow-[var(--shadow-md)]',
        'data-[dragging]:z-10 data-[dragging]:scale-[1.03] data-[dragging]:opacity-90 data-[dragging]:shadow-[var(--shadow-xl)]',
        'data-[dragging]:border-[var(--color-brand-400)]',
        isStale ? 'border-[color-mix(in_oklab,var(--color-warning)_45%,var(--color-border))]' : 'border-[var(--color-border)]',
      )}
    >
      {isStale && (
        <span
          className="absolute inset-y-0 left-0 w-1 rounded-l-[var(--radius-xl)]"
          style={{ backgroundColor: 'var(--color-warning)' }}
          aria-hidden="true"
        />
      )}

      {/* Avatar + nombre */}
      <div className="flex items-center gap-2.5">
        <Avatar name={fullName} seed={lead.person.id || fullName} size="sm" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight text-[var(--color-text)]">
          {fullName}
        </p>
      </div>

      {/* Propiedad */}
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
        <Icon name="properties" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{propertyName}</span>
      </div>

      {/* Valor, si el lead tiene presupuesto */}
      {budgetLabel && (
        <p className="text-sm font-bold tabular-nums tracking-[var(--tracking-tight)] text-[var(--color-text)]">
          {budgetLabel}
        </p>
      )}

      {/* Origen + días en etapa */}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-muted)]">
          {tSources(lead.source as any)}
        </span>
        <div className="flex items-center gap-1.5">
          {isStale && (
            <span
              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--color-warning) 16%, var(--color-surface))',
                color: 'color-mix(in oklab, var(--color-warning) 75%, var(--color-text))',
              }}
            >
              {t('stale')}
            </span>
          )}
          <span className="whitespace-nowrap text-[11px] tabular-nums text-[var(--color-muted)]">
            {t('daysInStage', { days })}
          </span>
        </div>
      </div>

      {/* Responsable */}
      <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-muted)]">
        {lead.assignedToUser ? (
          <>
            <Avatar
              name={`${lead.assignedToUser.firstName} ${lead.assignedToUser.lastName}`}
              size="xs"
            />
            <span className="truncate">
              {lead.assignedToUser.firstName} {lead.assignedToUser.lastName.charAt(0)}.
            </span>
          </>
        ) : (
          <span className="italic">{t('unassigned')}</span>
        )}
      </div>
    </div>
  );
}
