'use client';

import { useTranslations } from 'next-intl';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { formatCountdown, slaState } from '@/lib/inbox';
import { useElapsedText } from '@/components/tickets/elapsed';

interface SlaBadgeProps {
  conversation: { slaDueAt: string | null; firstResponseAt: string | null; status: string };
  slaMinutes: number;
  /** Reloj de la pantalla: una sola fuente para toda la lista, así los plazos cambian a la vez. */
  now: Date;
}

const TONE: Record<string, BadgeVariant> = { ok: 'info', warning: 'warning', breached: 'danger', met: 'success' };

/** Plazo de primera respuesta: cuenta regresiva mientras corre, "sin responder hace" si pasó y "respondida" si ya se contestó. */
export function SlaBadge({ conversation, slaMinutes, now }: SlaBadgeProps) {
  const t = useTranslations('inbox.sla');
  const elapsed = useElapsedText();
  const state = slaState(conversation, slaMinutes, now);
  if (state === 'none') return null;
  if (state === 'met') {
    return (
      <Badge variant={TONE.met} size="sm">
        {t('met')}
      </Badge>
    );
  }
  const ms = new Date(conversation.slaDueAt as string).getTime() - now.getTime();
  const left = formatCountdown(ms);
  // El reloj con segundos sirve mientras el plazo es de minutos; de una hora en adelante se dice en palabras.
  const time = Math.abs(ms) >= 3_600_000 ? elapsed(ms) : left.text;
  return (
    <Badge variant={TONE[state]} size="sm" dot>
      <span className="tabular-nums">{left.overdue ? t('overdue', { time }) : t('dueIn', { time })}</span>
    </Badge>
  );
}
