'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { holderLabel, type KeyMovement, type KeySet } from '@/lib/sales';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DateText } from '@/components/ui/date-text';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Skeleton } from '@/components/ui/skeleton';
import { KeyCheckInDialog, KeyCheckOutDialog, KeySetDialog } from './key-dialogs';

type Dialog = { kind: 'add' } | { kind: 'out' | 'in'; set: KeySet };

/** Llaves de la propiedad: cada juego con quién lo tiene, dónde se guarda en la oficina, sus salidas y devoluciones. */
export function PropertyKeysCard({ propertyId }: { propertyId: string }) {
  const t = useTranslations('keys');
  const canView = useCan('keys.view');
  const canManage = useCan('keys.manage');
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const query = useQuery({
    queryKey: ['keys', propertyId],
    queryFn: () => apiClient<{ items: KeySet[] }>(`/properties/${propertyId}/keys`),
    enabled: canView,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['keys'] });
  };

  if (!canView) return null;
  const sets = query.data?.items ?? [];

  return (
    <section aria-labelledby="property-keys-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="property-keys-title" className="sr-only">
          {t('card.title')}
        </h3>
        {canManage && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setDialog({ kind: 'add' })}>
            {t('card.add')}
          </Button>
        )}
      </div>
      {query.isPending && <Skeleton className="h-16 w-full" />}
      {query.error != null && <ErrorNotice error={query.error} fallback={t('card.loadError')} />}
      {!query.isPending && !query.error && sets.length === 0 && <p className="text-sm text-[var(--color-muted)]">{t('card.none')}</p>}
      <ul className="space-y-3">
        {sets.map((set) => (
          <li key={set.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[var(--color-text)]">{set.label}</span>
              <span className="text-xs text-[var(--color-muted)]">{t('card.copies', { count: set.copies })}</span>
              {!set.isActive && <Badge variant="neutral" size="sm">{t('card.inactive')}</Badge>}
              <Badge variant={set.holder === 'Oficina' ? 'success' : set.overdue ? 'danger' : 'warning'} size="sm" dot>
                {set.holder === 'Oficina'
                  ? t('card.inOffice')
                  : t('card.heldBy', { holder: t(`holders.${set.holder}`), name: holderLabel(set) })}
              </Badge>
              {set.overdue && <Badge variant="danger" size="sm">{t('card.overdue', { days: set.daysOverdue })}</Badge>}
              {canManage && set.isActive && (
                <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => setDialog({ kind: set.openMovement ? 'in' : 'out', set })}>
                  {set.openMovement ? t('card.checkIn') : t('card.checkOut')}
                </Button>
              )}
            </div>
            {set.location && set.holder === 'Oficina' && (
              <p className="mt-1 text-xs text-[var(--color-muted)]">{t('card.location', { location: set.location })}</p>
            )}
            {set.openMovement && <OpenMovement movement={set.openMovement} />}
            {set.movements.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-[var(--color-muted)]">{t('card.history', { count: set.movements.length })}</summary>
                <ul className="mt-1 space-y-1 text-xs text-[var(--color-muted)]">
                  {set.movements.map((m) => (
                    <li key={m.id}>
                      <DateText value={m.outAt} /> · {t(`holders.${m.holder}`)} {holderLabel(m)}
                      {m.returnedAt ? (
                        <>
                          {' '}
                          → <DateText value={m.returnedAt} />
                        </>
                      ) : (
                        ` · ${t('card.stillOut')}`
                      )}
                      {m.reason ? ` · ${m.reason}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>

      {dialog?.kind === 'add' && <KeySetDialog propertyId={propertyId} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'out' && <KeyCheckOutDialog keySetId={dialog.set.id} label={dialog.set.label} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'in' && <KeyCheckInDialog keySetId={dialog.set.id} label={dialog.set.label} onClose={() => setDialog(null)} onDone={refresh} />}
    </section>
  );
}

function OpenMovement({ movement }: { movement: KeyMovement }) {
  const t = useTranslations('keys.card');
  return (
    <p className="mt-1 text-xs text-[var(--color-muted)]">
      {t('since')} <DateText value={movement.outAt} />
      {movement.reason ? ` · ${movement.reason}` : ''}
      {movement.expectedReturnAt && (
        <>
          {' · '}
          {t('expected')} <DateText value={movement.expectedReturnAt} />
        </>
      )}
    </p>
  );
}
