'use client';

import { useTranslations } from 'next-intl';
import { EntityRow } from '@/components/ui/entity-card';
import { Badge } from '@/components/ui/badge';
import { Plate } from './portal-primitives';
import {
  addressOf,
  claimTone,
  daysBetween,
  formatDate,
  isClaimOpen,
  todayUtcDay,
  toUtcDay,
  type PortalClaim,
} from './portal-data';

/**
 * One claim. The row answers "what is happening with it" rather than just
 * naming a status: every open state maps to the next step the tenant can
 * expect, which is the whole reason they come back to this screen.
 */
export function ClaimRow({ claim }: { claim: PortalClaim }) {
  const t = useTranslations();

  const tone = claimTone(claim);
  const open = isClaimOpen(claim);
  const created = toUtcDay(claim.createdAt);
  const days = created !== null ? Math.max(0, daysBetween(created, todayUtcDay())) : 0;

  return (
    <EntityRow
      accent={tone === 'neutral' ? 'none' : tone}
      leading={<Plate icon="tickets" tone={tone} size="md" />}
      title={claim.title}
      subtitle={addressOf(claim.property) ?? undefined}
      meta={
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant={tone} dot>
            {t(`portal.claims.statuses.${claim.status}` as Parameters<typeof t>[0])}
          </Badge>
          {claim.category && (
            <span className="text-xs text-[var(--color-muted)]">{claim.category.name}</span>
          )}
          <span className="text-xs text-[var(--color-muted)]">
            {open
              ? t('portal.claims.openFor', { days })
              : t('portal.claims.openedOn', { date: formatDate(claim.createdAt) })}
          </span>
        </div>
      }
      alert={
        open ? (
          <EntityRow.Alert tone="info" icon="clock">
            {t(`portal.claims.next.${claim.status}` as Parameters<typeof t>[0])}
          </EntityRow.Alert>
        ) : undefined
      }
    />
  );
}
