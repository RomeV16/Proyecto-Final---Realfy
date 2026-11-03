'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ListingStatus } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { toDateInput, type ListingRow, type PortalEntry } from '@/lib/listings';
import { toast } from '@/lib/toast';
import { Dialog, DialogBody, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormDialogFooter } from '@/components/ui/form-dialog-footer';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface Props {
  propertyId: string;
  operationType: string;
  portal: PortalEntry;
  current?: ListingRow;
  onClose: () => void;
  onSaved: () => void;
}

const STATUSES = [ListingStatus.NoPublicado, ListingStatus.Publicado, ListingStatus.Pausado, ListingStatus.Vencido];

/** Estado de una operación en un portal: estado, dirección y código del aviso, fechas de publicación y vencimiento. */
export function ListingEditDialog({ propertyId, operationType, portal, current, onClose, onSaved }: Props) {
  const t = useTranslations('publication');
  const tOps = useTranslations('properties.operationTypes');
  const [status, setStatus] = useState<string>(current?.status ?? ListingStatus.Publicado);
  const [externalUrl, setExternalUrl] = useState(current?.externalUrl ?? '');
  const [externalCode, setExternalCode] = useState(current?.externalCode ?? '');
  const [publishedAt, setPublishedAt] = useState(toDateInput(current?.publishedAt));
  const [expiresAt, setExpiresAt] = useState(toDateInput(current?.expiresAt));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient(`/properties/${propertyId}/listings`, {
        method: 'PUT',
        body: JSON.stringify({
          listings: [
            {
              operationType,
              portal: portal.key,
              status,
              externalUrl: externalUrl.trim() || null,
              externalCode: externalCode.trim() || null,
              publishedAt: publishedAt ? `${publishedAt}T12:00:00.000Z` : null,
              expiresAt: expiresAt ? `${expiresAt}T23:59:59.000Z` : null,
            },
          ],
        }),
      });
      toast.success(t('edit.saved'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onClose={onClose} busy={submitting} size="md">
      <form onSubmit={(e) => void save(e)} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            {t('edit.title', { portal: portal.name })}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{tOps(operationType)}</p>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error != null && <ErrorNotice error={error} fallback={t('edit.saveError')} />}
          <FormField label={t('edit.status')} required>
            {(c) => (
              <Select {...c} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`statuses.${s}`)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {!portal.builtin && (
            <>
              <FormField label={t('edit.externalUrl')} hint={t('edit.externalUrlHint')}>
                {(c) => (
                  <Input
                    {...c}
                    type="url"
                    inputMode="url"
                    maxLength={500}
                    value={externalUrl}
                    onChange={(e) => setExternalUrl(e.target.value)}
                  />
                )}
              </FormField>
              <FormField
                label={t('edit.externalCode')}
                hint={portal.urlTemplate ? t('edit.externalCodeHint') : undefined}
              >
                {(c) => (
                  <Input
                    {...c}
                    maxLength={80}
                    value={externalCode}
                    onChange={(e) => setExternalCode(e.target.value)}
                  />
                )}
              </FormField>
            </>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={t('edit.publishedAt')}>
              {(c) => <Input {...c} type="date" value={publishedAt} onChange={(e) => setPublishedAt(e.target.value)} />}
            </FormField>
            <FormField label={t('edit.expiresAt')} hint={t('edit.expiresAtHint')}>
              {(c) => <Input {...c} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />}
            </FormField>
          </div>
        </DialogBody>
        <FormDialogFooter
          onCancel={onClose}
          busy={submitting}
          submitLabel={submitting ? t('edit.saving') : t('edit.save')}
        />
      </form>
    </Dialog>
  );
}
