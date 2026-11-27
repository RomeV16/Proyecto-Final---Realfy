'use client';

import { useTranslations } from 'next-intl';
import { CollectionStage } from '@realfy/shared';
import { cn } from '@/lib/cn';

/** El recorrido de un caso, en orden. `Cerrado` no es un paso: es el final desde cualquiera. */
export const STAGE_PATH = [
  CollectionStage.Recordatorio,
  CollectionStage.Prejudicial,
  CollectionStage.Abogado,
  CollectionStage.Judicial,
] as const;

const TONE: Record<string, string> = {
  [CollectionStage.Recordatorio]: 'var(--color-info)',
  [CollectionStage.Prejudicial]: 'var(--color-warning)',
  [CollectionStage.Abogado]: 'var(--color-danger)',
  [CollectionStage.Judicial]: 'var(--color-danger)',
};

interface Props {
  stage: string;
  /** `compact`: cuatro tramos y la etapa actual (cola). `full`: cada paso con su nombre (detalle). */
  variant?: 'compact' | 'full';
  className?: string;
}

/** Etapa de la gestión como pasos: hasta dónde llegó el caso en el camino recordatorio → judicial. */
export function StageSteps({ stage, variant = 'compact', className }: Props) {
  const t = useTranslations('collections');
  const index = STAGE_PATH.indexOf(stage as (typeof STAGE_PATH)[number]);
  const closed = stage === CollectionStage.Cerrado;
  const color = TONE[stage] ?? 'var(--color-muted)';
  const label = closed ? t('stages.Cerrado') : t('queue.stageOf', { n: index + 1, total: STAGE_PATH.length });

  if (variant === 'compact') {
    return (
      <div className={cn('min-w-0', className)}>
        <p className="truncate text-sm font-medium text-[var(--color-text)]">{t(`stages.${stage}`)}</p>
        <div className="mt-1.5 flex items-center gap-1" role="img" aria-label={label}>
          {STAGE_PATH.map((s, i) => (
            <span
              key={s}
              className="h-1.5 w-6 rounded-full bg-[var(--color-border)]"
              style={!closed && i <= index ? { background: color } : undefined}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <ol className={cn('flex flex-wrap gap-x-2 gap-y-3', className)} aria-label={t('queue.stagePath')}>
      {STAGE_PATH.map((s, i) => {
        const reached = !closed && i <= index;
        const current = !closed && i === index;
        return (
          <li key={s} className="flex min-w-[7rem] flex-1 flex-col gap-1.5" aria-current={current ? 'step' : undefined}>
            <span
              className="h-1.5 w-full rounded-full bg-[var(--color-border)]"
              style={reached ? { background: color } : undefined}
            />
            <span
              className={cn(
                'text-xs',
                current ? 'font-semibold text-[var(--color-text)]' : 'text-[var(--color-muted)]',
              )}
            >
              {i + 1}. {t(`stages.${s}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
