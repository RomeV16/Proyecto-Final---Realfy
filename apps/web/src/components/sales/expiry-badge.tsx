'use client';

import { useTranslations } from 'next-intl';
import { expiryState, type SalesDeposit } from '@/lib/sales';
import { Badge } from '@/components/ui/badge';
import { DateText } from '@/components/ui/date-text';

type Props = Pick<SalesDeposit, 'kind' | 'status' | 'expiresAt' | 'expired'> & { today?: Date };

const TONE = { expired: 'danger', today: 'warning', soon: 'warning', ok: 'neutral' } as const;

/** Vencimiento de una reserva: la fecha y, si ya pasó o está cerca, el aviso (vencida, vence hoy, vence pronto). */
export function ExpiryBadge({ today, ...deposit }: Props) {
  const t = useTranslations('sales.expiry');
  const state = expiryState(deposit, today);
  if (state === 'none' || !deposit.expiresAt) return null;
  return (
    <Badge variant={TONE[state]} size="sm" dot>
      {t(state)} · <DateText value={deposit.expiresAt} />
    </Badge>
  );
}
