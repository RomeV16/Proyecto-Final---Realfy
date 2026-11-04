'use client';

import { useTranslations } from 'next-intl';
import { useOptionalAuth } from '@/lib/auth-context';
import { useInboxSummary } from '@/lib/inbox-summary';
import { can } from '@/lib/permissions';
import { NavCountBadge } from './nav-count-badge';

/**
 * Contador de la bandeja de consultas en el menú: mensajes sin leer propios o sin responsable. Si hay plazos
 * vencidos se pinta de rojo. `floating` lo apoya sobre el ícono (menú colapsado y barra de íconos).
 */
export function InboxNavBadge({ floating = false }: { floating?: boolean }) {
  const t = useTranslations('inbox.nav');
  const role = useOptionalAuth()?.user?.role;
  const enabled = can(role, 'inbox.access');
  const { unread, breached } = useInboxSummary(enabled);
  if (!enabled) return null;
  return <NavCountBadge count={unread} label={t('unread', { count: unread })} danger={breached > 0} floating={floating} />;
}
