'use client';

import { useTranslations } from 'next-intl';
import { useOptionalAuth } from '@/lib/auth-context';
import { useBillReviewCount } from '@/lib/bill-documents';
import { can } from '@/lib/permissions';
import { NavCountBadge } from './nav-count-badge';

/** Contador de boletas recibidas que esperan revisión, en el menú junto a "Boletas recibidas". */
export function BillReviewNavBadge({ floating = false }: { floating?: boolean }) {
  const t = useTranslations('billDocuments.nav');
  const role = useOptionalAuth()?.user?.role;
  const count = useBillReviewCount(can(role, 'billDocuments.view'));
  return <NavCountBadge count={count} label={t('pending', { count })} floating={floating} />;
}
