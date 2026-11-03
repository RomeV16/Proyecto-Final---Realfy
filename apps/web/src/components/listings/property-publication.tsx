'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { safeHref, type ListingRow, type PortalEntry, type PropertyListings } from '@/lib/listings';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { DateText } from '@/components/ui/date-text';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { AdCopyDialog } from './ad-copy-dialog';
import { ListingEditDialog } from './listing-edit-dialog';

interface Props {
  propertyId: string;
}

type Dialog =
  | { kind: 'edit'; operationType: string; portal: PortalEntry }
  | { kind: 'copy'; operationType: string; portal: string }
  | null;

/**
 * Publicación de la propiedad: por operación, el estado del aviso en cada portal (y en el micrositio propio),
 * con su vencimiento, y el aviso listo para copiar.
 */
export function PropertyPublication({ propertyId }: Props) {
  const t = useTranslations('publication');
  const tOps = useTranslations('properties.operationTypes');
  const tStates = useTranslations('properties.states');
  const canManage = useCan('listings.manage');
  const [data, setData] = useState<PropertyListings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiClient<PropertyListings>(`/properties/${propertyId}/listings`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error != null) return <ErrorNotice error={error} fallback={t('loadError')} />;
  if (!data) return <Skeleton className="h-24 w-full" />;
  if (data.operations.length === 0) {
    return <p className="text-sm text-[var(--color-muted)]">{t('card.noOperations')}</p>;
  }

  const rowOf = (operationType: string, portal: string): ListingRow | undefined =>
    data.listings.find((l) => l.operationType === operationType && l.portal === portal);
  // Un portal dado de baja sólo se muestra si la propiedad todavía tiene algo ahí.
  const visiblePortals = (operationType: string) =>
    data.portals.filter((p) => p.enabled || rowOf(operationType, p.key));
  const enabledPortals = data.portals.filter((p) => p.enabled);

  return (
    <div className="space-y-5">
      {data.operations.map((op) => (
        <div key={op.operationType} className="space-y-2">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            {tOps(op.operationType)}
            <span className="text-xs font-normal text-[var(--color-muted)]">
              {tStates.has(op.state) ? tStates(op.state) : op.state}
            </span>
          </h3>
          <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
            {visiblePortals(op.operationType).map((portal) => {
              const row = rowOf(op.operationType, portal.key);
              const status = row?.effectiveStatus ?? 'NoPublicado';
              const href = safeHref(row?.externalUrl);
              return (
                <li key={portal.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 basis-40 font-medium text-[var(--color-text)]">{portal.name}</span>
                  <StatusBadge domain="aviso" status={status} />
                  {row?.expiresAt && (
                    <span className="text-xs text-[var(--color-muted)]">
                      {t('card.expires')} <DateText value={row.expiresAt} />
                    </span>
                  )}
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--color-brand-600)] hover:underline"
                    >
                      {t('card.open')}
                    </a>
                  )}
                  {portal.builtin && status === 'Publicado' && data.micrositePath && (
                    <a
                      href={data.micrositePath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--color-brand-600)] hover:underline"
                    >
                      {t('card.viewOnSite')}
                    </a>
                  )}
                  <span className="ml-auto flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog({ kind: 'copy', operationType: op.operationType, portal: portal.key })}
                    >
                      {t('card.copyAd')}
                    </Button>
                    {canManage && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setDialog({ kind: 'edit', operationType: op.operationType, portal })}
                      >
                        {t('card.edit')}
                      </Button>
                    )}
                  </span>
                  {row?.updatedBy && (
                    <span className="basis-full text-xs text-[var(--color-muted)]">
                      {t('card.updatedBy', { name: row.updatedBy })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {dialog?.kind === 'edit' && (
        <ListingEditDialog
          propertyId={propertyId}
          operationType={dialog.operationType}
          portal={dialog.portal}
          current={rowOf(dialog.operationType, dialog.portal.key)}
          onClose={() => setDialog(null)}
          onSaved={() => void load()}
        />
      )}
      {dialog?.kind === 'copy' && (
        <AdCopyDialog
          propertyId={propertyId}
          operationType={dialog.operationType}
          portals={enabledPortals}
          initialPortal={dialog.portal}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
