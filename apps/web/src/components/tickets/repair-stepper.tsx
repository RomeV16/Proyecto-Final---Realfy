'use client';

import { useTranslations } from 'next-intl';
import { TICKET_STEPS, ticketStepIndex } from '@realfy/shared';
import { cn } from '@/lib/cn';

/**
 * Avance de una incidencia por sus etapas: caso, autorización, presupuesto, aprobación, ejecución,
 * resuelto y cerrado. Los pasos anteriores quedan hechos, el actual marcado (`aria-current="step"`) y
 * los siguientes pendientes. Una incidencia cancelada no avanza: se muestra un aviso en lugar de los pasos.
 */
export function RepairStepper({ status }: { status: string }) {
  const t = useTranslations('tickets');
  const current = ticketStepIndex(status as never);

  if (current < 0) {
    return (
      <p role="status" className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)]">
        {t('repair.stepper.cancelled')}
      </p>
    );
  }

  return (
    <ol aria-label={t('repair.stepper.label')} className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {TICKET_STEPS.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo';
        return (
          <li
            key={step}
            aria-current={state === 'current' ? 'step' : undefined}
            data-state={state}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs',
              state === 'done' && 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]',
              state === 'current' && 'border-brand-500 bg-brand-50 font-semibold text-brand-700',
              state === 'todo' && 'border-dashed border-[var(--color-border)] text-[var(--color-muted)]',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                state === 'done' && 'bg-brand-500 text-white',
                state === 'current' && 'border-2 border-brand-500',
                state === 'todo' && 'border border-[var(--color-border)]',
              )}
            >
              {state === 'done' ? '✓' : index + 1}
            </span>
            <span>{t(`statuses.${step}`)}</span>
            <span className="sr-only">
              {state === 'done' ? t('repair.stepper.done') : state === 'current' ? t('repair.stepper.current') : t('repair.stepper.todo')}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
