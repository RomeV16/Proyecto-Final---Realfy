'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { portalApiClient, PortalApiRequestError } from '@/lib/portal-api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Icon } from '@/components/ui/icon';
import { usePortalCategories, usePortalContracts } from './portal-data';

/**
 * New claim.
 *
 * A sheet on phones and a centred dialog from `sm` up — the tenant usually
 * files a claim standing in front of whatever broke. The form asks for the
 * least it can: everything except the title is optional, and the property is
 * preselected when there is only one contract.
 */
export function NewClaimDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations();

  const { data: contracts } = usePortalContracts();
  const { data: categories } = usePortalCategories();

  const [propertyId, setPropertyId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const properties = (contracts ?? []).filter((c) => c.propertyId);
  // Preselect the only property when there's exactly one.
  const effectivePropertyId =
    propertyId || (properties.length === 1 ? properties[0].propertyId : '');

  const mutation = useMutation({
    mutationFn: (payload: {
      propertyId: string;
      title: string;
      description?: string;
      categoryId?: string;
    }) =>
      portalApiClient('/portal/tickets', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: onCreated,
    onError: (err) => {
      setError(
        err instanceof PortalApiRequestError ? t('portal.claims.form.error') : t('common.error'),
      );
    },
  });

  // Fresh form every time the sheet opens, and no page scrolling behind it.
  useEffect(() => {
    if (!open) return;
    setPropertyId('');
    setCategoryId('');
    setTitle('');
    setDescription('');
    setError('');

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!effectivePropertyId) {
      setError(t('portal.claims.form.propertyRequired'));
      return;
    }
    if (!title.trim()) {
      setError(t('portal.claims.form.titleRequired'));
      return;
    }
    mutation.mutate({
      propertyId: effectivePropertyId,
      title: title.trim(),
      description: description.trim() || undefined,
      categoryId: categoryId || undefined,
    });
  };

  const fieldClass =
    'h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-sm text-[var(--color-text)] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)]';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-claim-title"
        className="relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-t-[var(--radius-3xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl sm:max-w-md sm:rounded-[var(--radius-3xl)] sm:p-6"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="new-claim-title" className="h3">
              {t('portal.claims.newClaim')}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {t('portal.claims.form.hint')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('portal.claims.form.cancel')}
            className="-mr-1 -mt-1 shrink-0 rounded-full p-2 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]"
          >
            <Icon name="close" className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-4 py-3 text-sm text-[var(--color-danger)]"
            >
              {error}
            </p>
          )}

          {properties.length > 1 && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor="claim-property"
                className="text-[0.8rem] font-medium text-[var(--color-text)]"
              >
                {t('portal.claims.form.property')}
              </label>
              <select
                id="claim-property"
                className={fieldClass}
                value={effectivePropertyId}
                onChange={(e) => setPropertyId(e.target.value)}
              >
                <option value="">{t('portal.claims.form.propertyPlaceholder')}</option>
                {properties.map((c) => (
                  <option key={c.id} value={c.propertyId}>
                    {c.property?.address || c.property?.name || c.propertyId}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Input
            id="claim-title"
            label={t('portal.claims.form.title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('portal.claims.form.titlePlaceholder')}
            maxLength={500}
            autoFocus
          />

          {categories && categories.length > 0 && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor="claim-category"
                className="text-[0.8rem] font-medium text-[var(--color-text)]"
              >
                {t('portal.claims.form.category')}
              </label>
              <select
                id="claim-category"
                className={fieldClass}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">{t('portal.claims.form.categoryPlaceholder')}</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label
              htmlFor="claim-description"
              className="text-[0.8rem] font-medium text-[var(--color-text)]"
            >
              {t('portal.claims.form.description')}
            </label>
            <textarea
              id="claim-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('portal.claims.form.descriptionPlaceholder')}
              rows={4}
              maxLength={10000}
              className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)]"
            />
          </div>

          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending && <Spinner className="h-4 w-4 text-white" />}
            {mutation.isPending ? t('portal.claims.form.submitting') : t('portal.claims.form.submit')}
          </Button>
        </form>
      </div>
    </div>
  );
}
