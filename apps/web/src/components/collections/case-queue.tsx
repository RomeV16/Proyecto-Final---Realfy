'use client';

import { useTranslations } from 'next-intl';
import type { CollectionCaseItem } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { caseHref } from '@/lib/collections';
import { MoneyText } from '@/components/ui/money-text';
import { SuggestedStep } from './next-action';
import { StageSteps } from './stage-steps';

interface Props {
  items: CollectionCaseItem[];
  /** Puesto del primer caso de la página (la cola sigue entre páginas). */
  firstRank?: number;
}

/** Color de la marca de urgencia: ámbar el primer mes de mora, rojo después. */
function urgencyColor(days: number): string {
  if (days >= 30) return 'var(--color-danger)';
  return days > 0 ? 'var(--color-warning)' : 'var(--color-border)';
}

/**
 * Cola de cobranza: los casos en el orden en que conviene atenderlos (primero la mora más vieja). Cada renglón
 * dice a quién se le reclama, en qué paso está la gestión, cuánto debe hoy y qué hacer ahora.
 */
export function CaseQueue({ items, firstRank = 1 }: Props) {
  const t = useTranslations('collections');
  return (
    <ol
      aria-label={t('queue.label')}
      className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      {items.map((c, i) => (
        <li
          key={c.id}
          className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 py-4 pl-6 pr-4 lg:grid-cols-[2rem_minmax(0,1.5fr)_9rem_5rem_minmax(0,1fr)_minmax(0,1.3fr)] lg:items-center lg:gap-x-5 lg:pr-5"
        >
          <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: urgencyColor(c.daysOverdue) }} />

          <span className="hidden font-mono text-sm tabular-nums text-[var(--color-muted)] lg:block">
            <span className="sr-only">{t('queue.rank')} </span>
            {String(firstRank + i).padStart(2, '0')}
          </span>

          <div className="min-w-0">
            <Link href={caseHref(c.id)} className="block font-medium text-[var(--color-text)] hover:underline lg:truncate">
              {c.propertyLabel || t('noProperty')}
            </Link>
            <p className="text-sm text-[var(--color-muted)] lg:truncate">{c.tenantNames || t('noTenant')}</p>
            <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
              {c.assigneeName ? (
                <>
                  {t('queue.assignee')} <span className="text-[var(--color-text)]">{c.assigneeName}</span>
                </>
              ) : (
                t('queue.unassigned')
              )}
            </p>
          </div>

          <div className="text-right lg:col-start-4 lg:row-start-1 lg:text-left">
            <p aria-hidden className="text-xl font-semibold leading-none tabular-nums" style={{ color: urgencyColor(c.daysOverdue) }}>
              {c.daysOverdue}
            </p>
            <p aria-hidden className="mt-1 text-[11px] leading-tight text-[var(--color-muted)]">
              {t('queue.daysLabel', { n: c.daysOverdue })}
            </p>
            <span className="sr-only">{t('days', { n: c.daysOverdue })}</span>
          </div>

          <StageSteps stage={c.stage} className="lg:col-start-3 lg:row-start-1" />

          <div className="text-right lg:col-start-5 lg:row-start-1">
            <MoneyText
              value={c.payoffToday}
              currency={c.currency}
              decimals={2}
              className="block font-semibold tabular-nums text-[var(--color-text)]"
            />
            <p className="text-xs text-[var(--color-muted)]">
              {t('queue.balance')} <MoneyText value={c.balance} currency={c.currency} decimals={2} className="tabular-nums" />
            </p>
          </div>

          <div className="col-span-2 flex items-center justify-between gap-3 border-t border-dashed border-[var(--color-border)] pt-3 lg:col-span-1 lg:col-start-6 lg:row-start-1 lg:border-0 lg:pt-0">
            <SuggestedStep item={c} />
            <Link
              href={caseHref(c.id)}
              aria-label={t('queue.openCase', { name: c.propertyLabel || t('noProperty') })}
              className="shrink-0 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-sunken)]"
            >
              {t('queue.open')}
            </Link>
          </div>
        </li>
      ))}
    </ol>
  );
}
