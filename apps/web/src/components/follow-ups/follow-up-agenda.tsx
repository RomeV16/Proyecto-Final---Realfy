'use client';

import { useTranslations } from 'next-intl';
import type { FollowUp } from '@/lib/follow-ups';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { DateText } from '@/components/ui/date-text';
import { StatusBadge } from '@/components/ui/status-badge';
import { groupAgenda, type AgendaKey } from './agenda';

interface Props {
  items: FollowUp[];
  /** Usuario actual, para decir "yo" en el responsable. */
  userId: string | null;
  onOpen: (followUp: FollowUp) => void;
}

/** Color del tramo: lo vencido y lo de hoy en rojo, la semana en ámbar, el resto neutro. */
const TONE: Record<AgendaKey, string> = {
  overdue: 'var(--color-danger)',
  today: 'var(--color-danger)',
  week: 'var(--color-warning)',
  month: 'var(--color-info)',
  later: 'var(--color-muted)',
  closed: 'var(--color-muted)',
};

/** Los tramos que se cuentan en la cabecera (los cerrados no son agenda). */
const COUNTED: AgendaKey[] = ['overdue', 'today', 'week', 'month', 'later'];

function AgendaRow({ followUp, userId, onOpen, tone }: { followUp: FollowUp; userId: string | null; onOpen: Props['onOpen']; tone: string }) {
  const t = useTranslations('followUps');
  const { daysLeft, progress } = followUp;
  const closed = followUp.status === 'Cerrado';
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  let when: string;
  if (closed) when = t(`outcomes.${followUp.outcome}`);
  else if (daysLeft < 0) when = t('agenda.ago', { n: -daysLeft });
  else if (daysLeft === 0) when = t('agenda.today');
  else when = t('agenda.inDays', { n: daysLeft });

  let assignee = t('drawer.unassigned');
  if (followUp.assigneeId) assignee = followUp.assigneeId === userId ? t('drawer.me') : t('columns.assigned');

  return (
    <li className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-3.5 lg:grid-cols-[3.25rem_minmax(0,1.6fr)_minmax(0,1fr)_8.5rem_7rem_auto] lg:px-5">
      <div className="text-center leading-none">
        <DateText
          value={followUp.effectiveEnd}
          style={{ weekday: 'short' }}
          className="block text-[11px] uppercase tracking-wide text-[var(--color-muted)]"
        />
        <DateText
          value={followUp.effectiveEnd}
          style={{ day: '2-digit' }}
          className="mt-1 block font-display text-2xl tabular-nums text-[var(--color-text)]"
        />
        <DateText value={followUp.effectiveEnd} style="monthYear" className="mt-1 block text-[11px] text-[var(--color-muted)]" />
      </div>

      <div className="min-w-0">
        <p className="font-medium text-[var(--color-text)] lg:truncate">{followUp.property ?? t('agenda.noProperty')}</p>
        <p className="text-sm text-[var(--color-muted)] lg:truncate">
          {followUp.tenantName ?? t('agenda.noTenant')}
          {followUp.effectiveEnd !== followUp.signedEnd && <> · {t('oralExtension.badge')}</>}
        </p>
      </div>

      <div className="col-start-2 lg:col-start-auto">
        <p className="text-sm font-medium" style={{ color: closed ? undefined : tone }}>
          {when}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
          <span>{t(`kinds.${followUp.kind}`)}</span>
          {followUp.light && <StatusBadge domain="vencimiento" status={followUp.light} />}
        </div>
      </div>

      <div className="col-start-2 lg:col-start-auto">
        <div className="flex items-baseline justify-between gap-2 text-xs text-[var(--color-muted)]">
          <span>{t('columns.progress')}</span>
          <span className="tabular-nums text-[var(--color-text)]">
            {progress.done}/{progress.total}
          </span>
        </div>
        <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
          <span className="block h-full rounded-full bg-[var(--color-success)]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <p className="hidden text-sm text-[var(--color-muted)] lg:block">
        <span className="block text-xs">{t('columns.assignee')}</span>
        <span className="text-[var(--color-text)]">{assignee}</span>
      </p>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="col-start-3 row-start-1 lg:col-start-auto lg:row-start-auto"
        onClick={() => onOpen(followUp)}
      >
        {t('open')}
      </Button>
    </li>
  );
}

/**
 * Agenda de vencimientos: los seguimientos agrupados por cuándo termina el contrato (vencidos, hoy, esta
 * semana, este mes, más adelante), cada uno con su fecha, cuánto falta, el avance del checklist y quién lo lleva.
 */
export function FollowUpAgenda({ items, userId, onOpen }: Props) {
  const t = useTranslations('followUps');
  const groups = groupAgenda(items);
  const count = (key: AgendaKey) => groups.find((g) => g.key === key)?.items.length ?? 0;
  const showCounts = COUNTED.some((key) => count(key) > 0);

  return (
    <div className="space-y-6">
      {showCounts && (
        <dl
          aria-label={t('agenda.summary')}
          className="grid grid-cols-5 divide-x divide-[var(--color-border)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]"
        >
          {COUNTED.map((key) => (
            <div key={key} className={cn('px-2 py-3 text-center sm:px-4 sm:text-left', count(key) === 0 && 'opacity-55')}>
              <dt className="text-[11px] leading-tight text-[var(--color-muted)] sm:text-xs">{t(`agenda.short.${key}`)}</dt>
              <dd
                className="mt-1 text-xl font-semibold tabular-nums"
                style={{ color: count(key) > 0 ? TONE[key] : 'var(--color-muted)' }}
              >
                {count(key)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.key} aria-label={t(`agenda.groups.${g.key}`)}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: TONE[g.key] }} />
              {t(`agenda.groups.${g.key}`)}
              <span className="font-normal tabular-nums text-[var(--color-muted)]">{g.items.length}</span>
            </h2>
            <ul className="divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              {g.items.map((f) => (
                <AgendaRow key={f.id} followUp={f} userId={userId} onOpen={onOpen} tone={TONE[g.key]} />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
