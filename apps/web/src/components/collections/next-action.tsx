'use client';

import { useTranslations } from 'next-intl';
import { CollectionActionKind, CollectionStage, type CollectionCaseItem } from '@realfy/shared';
import { DateText } from '@/components/ui/date-text';

type PlanFields = Pick<CollectionCaseItem, 'nextAction' | 'nextActionAt' | 'planStatus' | 'pausedUntil'>;

/** Texto de lo que toca después en un caso: la acción y el día, o por qué no hay una. */
export function NextActionText({ item }: { item: PlanFields }) {
  const t = useTranslations('collections');
  if (item.planStatus === 'Paused' && item.pausedUntil) {
    return (
      <span>
        {t('plan.Paused')} <DateText value={item.pausedUntil} />
      </span>
    );
  }
  if (item.planStatus === 'AwaitingLetterConfirmation') return <span>{t('plan.AwaitingLetterConfirmation')}</span>;
  if (item.planStatus === 'Manual') return <span>{t('plan.Manual')}</span>;
  if (!item.nextAction) return <span className="text-[var(--color-muted)]">{t('plan.none')}</span>;
  return (
    <span>
      {t(`actionKinds.${item.nextAction}`)}
      {item.nextActionAt && (
        <>
          {' · '}
          <DateText value={item.nextActionAt} />
        </>
      )}
    </span>
  );
}

/** Lo que conviene hacer ahora con un caso, como una orden corta. */
export type StepKey = 'none' | 'wait' | 'confirmLetter' | 'lawyer' | 'court' | 'person' | 'remind' | 'remindFirm' | 'letter' | 'derive' | 'call';

const STEP_OF_ACTION: Partial<Record<string, StepKey>> = {
  [CollectionActionKind.Recordatorio]: 'remind',
  [CollectionActionKind.RecordatorioFirme]: 'remindFirm',
  [CollectionActionKind.CartaDocumento]: 'letter',
  [CollectionActionKind.DerivacionAbogado]: 'derive',
};

export function suggestedStep(item: PlanFields & Pick<CollectionCaseItem, 'stage'>): StepKey {
  // Cerrado o ya sin deuda vencida: no queda nada que reclamar.
  if (item.stage === CollectionStage.Cerrado || item.planStatus === 'Close') return 'none';
  if (item.planStatus === 'Paused' && item.pausedUntil) return 'wait';
  if (item.planStatus === 'AwaitingLetterConfirmation') return 'confirmLetter';
  if (item.planStatus === 'Manual') {
    if (item.stage === CollectionStage.Abogado) return 'lawyer';
    return item.stage === CollectionStage.Judicial ? 'court' : 'person';
  }
  return (item.nextAction && STEP_OF_ACTION[item.nextAction]) || 'call';
}

/**
 * Próxima gestión sugerida de un caso de la cola: qué hacer (llamar, recordar, intimar, esperar) y, debajo, el
 * dato que lo explica (la fecha programada, hasta cuándo rige el acuerdo o que lo lleva una persona).
 */
export function SuggestedStep({ item }: { item: PlanFields & Pick<CollectionCaseItem, 'stage'> }) {
  const t = useTranslations('collections');
  const step = suggestedStep(item);
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-[var(--color-text)]">{t(`queue.steps.${step}`)}</p>
      <p className="text-xs text-[var(--color-muted)]">
        {step === 'none' && t(item.stage === CollectionStage.Cerrado ? 'queue.hints.closed' : 'queue.hints.settled')}
        {step === 'wait' && (
          <>
            {t('plan.Paused')} <DateText value={item.pausedUntil} />
          </>
        )}
        {step === 'confirmLetter' && t('queue.hints.confirmLetter')}
        {(step === 'lawyer' || step === 'court' || step === 'person') && t('plan.Manual')}
        {step === 'call' && t('queue.hints.call')}
        {(step === 'remind' || step === 'remindFirm' || step === 'letter' || step === 'derive') &&
          (item.nextActionAt ? (
            <>
              {t('queue.hints.scheduled')} <DateText value={item.nextActionAt} />
            </>
          ) : (
            t('queue.hints.pending')
          ))}
      </p>
    </div>
  );
}
