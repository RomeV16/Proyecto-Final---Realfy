'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import type { PublicationSettings } from '@/lib/listings';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormDialogFooter } from '@/components/ui/form-dialog-footer';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

interface PortalDraft {
  key: string;
  name: string;
  urlTemplate: string;
  enabled: boolean;
}

/** `Clasificados La Voz` -> `clasificados-la-voz`: la clave interna del portal. */
export function portalKeyFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

/** Portales de la inmobiliaria (nombre y plantilla de dirección) y privacidad de avisos y micrositio. */
export function PortalsSettingsDialog({ onClose, onSaved }: Props) {
  const t = useTranslations('publication.settings');
  const [portals, setPortals] = useState<PortalDraft[] | null>(null);
  const [hideExactAddress, setHideExactAddress] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const [expiryWarnDays, setExpiryWarnDays] = useState('7');
  const [newName, setNewName] = useState('');
  const [newError, setNewError] = useState<string | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient<PublicationSettings>('/listings/portals')
      .then((data) => {
        if (cancelled) return;
        setPortals(data.portals.map((p) => ({ ...p, urlTemplate: p.urlTemplate ?? '' })));
        setHideExactAddress(data.hideExactAddress);
        setShowMap(data.showMap);
        setExpiryWarnDays(String(data.expiryWarnDays));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function update(index: number, patch: Partial<PortalDraft>) {
    setPortals((list) => (list ? list.map((p, i) => (i === index ? { ...p, ...patch } : p)) : list));
  }

  function addPortal() {
    const name = newName.trim();
    const key = portalKeyFromName(name);
    if (key.length < 2 || key === 'micrositio' || portals?.some((p) => p.key === key)) {
      setNewError(t('newPortalInvalid'));
      return;
    }
    setNewError(undefined);
    setNewName('');
    setPortals((list) => [...(list ?? []), { key, name, urlTemplate: '', enabled: true }]);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!portals) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient('/listings/portals', {
        method: 'PUT',
        body: JSON.stringify({
          portals: portals.map((p) => ({
            key: p.key,
            name: p.name.trim(),
            urlTemplate: p.urlTemplate.trim() || null,
            enabled: p.enabled,
          })),
          hideExactAddress,
          showMap,
          expiryWarnDays: Number(expiryWarnDays),
        }),
      });
      toast.success(t('saved'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} busy={submitting} size="lg">
      <form onSubmit={(e) => void save(e)} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t('intro')}</p>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {loadError != null && <ErrorNotice error={loadError} fallback={t('loadError')} />}
          {error != null && <ErrorNotice error={error} fallback={t('saveError')} />}
          {loadError == null && !portals && <Skeleton className="h-32 w-full" />}

          {portals && (
            <>
              <div className="space-y-3">
                {portals.map((p, i) => (
                  <fieldset key={p.key} className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
                    <legend className="px-1 text-xs text-[var(--color-muted)]">{p.key}</legend>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <FormField label={t('portalName')} required>
                        {(c) => (
                          <Input {...c} maxLength={60} value={p.name} onChange={(e) => update(i, { name: e.target.value })} />
                        )}
                      </FormField>
                      <FormField label={t('urlTemplate')} hint={t('urlTemplateHint')}>
                        {(c) => (
                          <Input
                            {...c}
                            type="url"
                            inputMode="url"
                            maxLength={300}
                            value={p.urlTemplate}
                            onChange={(e) => update(i, { urlTemplate: e.target.value })}
                          />
                        )}
                      </FormField>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={p.enabled}
                          onChange={(e) => update(i, { enabled: e.target.checked })}
                        />
                        {t('enabled')}
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setPortals((list) => (list ? list.filter((_, idx) => idx !== i) : list))}
                      >
                        {t('remove')}
                      </Button>
                    </div>
                  </fieldset>
                ))}
                <div className="flex flex-wrap items-end gap-2">
                  <FormField label={t('newPortal')} error={newError} className="min-w-0 flex-1 basis-48">
                    {(c) => (
                      <Input
                        {...c}
                        maxLength={60}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                      />
                    )}
                  </FormField>
                  <Button type="button" size="sm" variant="secondary" onClick={addPortal}>
                    {t('addPortal')}
                  </Button>
                </div>
              </div>

              <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={hideExactAddress}
                    onChange={(e) => setHideExactAddress(e.target.checked)}
                  />
                  <span>
                    {t('hideExactAddress')}
                    <span className="block text-xs text-[var(--color-muted)]">{t('hideExactAddressHint')}</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={showMap}
                    onChange={(e) => setShowMap(e.target.checked)}
                  />
                  <span>
                    {t('showMap')}
                    <span className="block text-xs text-[var(--color-muted)]">{t('showMapHint')}</span>
                  </span>
                </label>
                <FormField label={t('expiryWarnDays')} hint={t('expiryWarnDaysHint')} className="max-w-[12rem]">
                  {(c) => (
                    <Input
                      {...c}
                      type="number"
                      min={1}
                      max={60}
                      value={expiryWarnDays}
                      onChange={(e) => setExpiryWarnDays(e.target.value)}
                    />
                  )}
                </FormField>
              </div>
            </>
          )}
        </DialogBody>
        <FormDialogFooter onCancel={onClose} busy={submitting || !portals} submitLabel={submitting ? t('saving') : t('save')} />
      </form>
    </Dialog>
  );
}
