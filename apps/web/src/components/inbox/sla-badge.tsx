'use client';

import { useTranslations } from 'next-intl';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { formatCountdown, slaState } from '@/lib/inbox';

interface SlaBadgeProps {
  conversation: { slaDueAt: string | null; firstResponseAt: string | null; status: string };
  slaMinutes: number;
  /** Reloj de la pantalla: una sola fuente para toda la lista, así los plazos cambian a la vez. */
  now: Date;
}

const TONE: Record<string, BadgeVariant> = { ok: 'info', warning: 'warning', breached: 'danger', met: 'success' };

/** Plazo de primera respuesta: cuenta regresiva mientras corre, "vencido hace" si pasó y "respondida" si ya se contestó. */
export function SlaBadge({ conversation, slaMinutes, now }: SlaBadgeProps) {
  const t = useTranslations('inbox.sla');
  const state = slaState(conversation, slaMinutes, now);
  if (state === 'none') return null;
  if (state === 'met') {
    return (
      <Badge variant={TONE.met} size="sm">
        {t('met')}
      </Badge>
    );
  }
  const left = formatCountdown(new Date(conversation.slaDueAt as string).getTime() - now.getTime());
  return (
    <Badge variant={TONE[state]} size="sm" dot>
      <span className="tabular-nums">{left.overdue ? t('overdue', { time: left.text }) : t('dueIn', { time: left.text })}</span>
    </Badge>
  );
}
