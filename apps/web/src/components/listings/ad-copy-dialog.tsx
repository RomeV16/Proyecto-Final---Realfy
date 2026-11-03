'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { copyText, type AdCopy, type PortalEntry } from '@/lib/listings';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  propertyId: string;
  operationType: string;
  portals: PortalEntry[];
  initialPortal: string;
  onClose: () => void;
}

/** Aviso optimizado para un portal: título, descripción y orden de fotos, cada uno con su botón de copiar. */
export function AdCopyDialog({ propertyId, operationType, portals, initialPortal, onClose }: Props) {
  const t = useTranslations('publication.adCopy');
  const tCommon = useTranslations('common');
  const [portal, setPortal] = useState(initialPortal);
  const [ad, setAd] = useState<AdCopy | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setAd(null);
    setError(null);
    apiClient<AdCopy>(
      `/properties/${propertyId}/ad-copy?portal=${encodeURIComponent(portal)}&operation=${encodeURIComponent(operationType)}`,
    )
      .then((data) => {
        if (!cancelled) setAd(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, operationType, portal]);

  async function copy(text: string) {
    if (await copyText(text)) toast.success(t('copied'));
    else toast.error(t('copyFailed'));
  }

  return (
    <Dialog open onClose={onClose} size="lg">
      <DialogHeader>
        <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{t('intro')}</p>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormField label={t('portal')}>
          {(c) => (
            <Select {...c} value={portal} onChange={(e) => setPortal(e.target.value)}>
              {portals.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        {error != null && <ErrorNotice error={error} fallback={t('loadError')} />}
        {error == null && ad == null && (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {ad && (
          <>
            {ad.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-sm text-[var(--color-text)]">
                {ad.warnings.map((w) => (
                  <li key={w}>{t(`warnings.${w}`)}</li>
                ))}
              </ul>
            )}

            <section className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('titleField')}</h3>
                <span className="text-xs tabular-nums text-[var(--color-muted)]">
                  {t('counter', { count: ad.title.length, max: ad.limits.title })}
                </span>
              </div>
              <p className="rounded-lg border border-[var(--color-border)] p-3 text-sm [overflow-wrap:anywhere]">
                {ad.title}
              </p>
              <Button type="button" size="sm" variant="secondary" onClick={() => void copy(ad.title)}>
                {t('copyTitle')}
              </Button>
            </section>

            <section className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('descriptionField')}</h3>
                <span className="text-xs tabular-nums text-[var(--color-muted)]">
                  {t('counter', { count: ad.description.length, max: ad.limits.description })}
                </span>
              </div>
              <p className="max-h-64 overflow-y-auto whitespace-pre-line rounded-lg border border-[var(--color-border)] p-3 text-sm [overflow-wrap:anywhere]">
                {ad.description}
              </p>
              <Button type="button" size="sm" variant="secondary" onClick={() => void copy(ad.description)}>
                {t('copyDescription')}
              </Button>
            </section>

            <section className="space-y-1.5">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                {t('photosField', { count: ad.photos.length, max: ad.limits.photos })}
              </h3>
              {ad.photos.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">{t('noPhotos')}</p>
              ) : (
                <ol className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {ad.photos.map((p) => (
                    <li key={p.id} className="relative overflow-hidden rounded-lg border border-[var(--color-border)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={t('photoAlt', { position: p.position })} className="aspect-square w-full object-cover" />
                      <span className="absolute left-1 top-1 rounded bg-[var(--color-surface)] px-1.5 text-xs font-semibold tabular-nums">
                        {p.position}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {ad.photos.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void copy(ad.photos.map((p) => p.url).join('\n'))}
                >
                  {t('copyPhotoLinks')}
                </Button>
              )}
            </section>

            <Button
              type="button"
              variant="primary"
              onClick={() => void copy(`${ad.title}\n\n${ad.description}`)}
            >
              {t('copyAll')}
            </Button>
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          {tCommon('close')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
