'use client';

import { useTranslations } from 'next-intl';
import { useOptionalAuth } from '@/lib/auth-context';
import { useInboxSummary } from '@/lib/inbox-summary';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/cn';

/**
 * Contador de la bandeja de consultas en el menú: mensajes sin leer propios o sin responsable. Si hay plazos
 * vencidos se pinta de rojo. `floating` lo apoya sobre el ícono (menú colapsado y barra de íconos).
 */
export function InboxNavBadge({ floating = false }: { floating?: boolean }) {
  const t = useTranslations('inbox.nav');
  const role = useOptionalAuth()?.user?.role;
  const enabled = can(role, 'inbox.access');
  const { unread, breached } = useInboxSummary(enabled);
  if (!enabled || unread === 0) return null;
  return (
    <span
      role="status"
      aria-label={t('unread', { count: unread })}
      className={cn(
        'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[0.65rem] font-semibold leading-5 tabular-nums text-white',
        breached > 0 ? 'bg-[var(--color-danger)]' : 'bg-brand-500',
        floating && 'absolute -right-1 -top-1',
      )}
    >
      {unread > 99 ? '99+' : unread}
    </span>
  );
}
