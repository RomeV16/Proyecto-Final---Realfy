'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { TicketPriority } from '@realfy/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Reveal } from '@/components/ui/reveal';
import { Spinner } from '@/components/ui/spinner';

interface PropertyOption {
  id: string;
  title: string;
  street?: string;
  city?: string;
}

interface CategoryOption {
  id: string;
  name: string;
}

interface CreatedTicket {
  id: string;
}

const selectClass =
  'h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-sm text-[var(--color-text)] hover:border-[var(--color-slate-400)] focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)] transition-[border-color,box-shadow] duration-300';

export default function NewTicketPage() {
  const t = useTranslations('tickets');
  const pathname = usePathname();
  const router = useRouter();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [propertyId, setPropertyId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<string>(TicketPriority.Media);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [titleError, setTitleError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [propsRes, catsRes] = await Promise.all([
          apiClient<{ items: PropertyOption[] }>('/properties?limit=100'),
          apiClient<CategoryOption[]>('/ticket-categories'),
        ]);
        if (!active) return;
        setProperties(propsRes.items || []);
        setCategories(Array.isArray(catsRes) ? catsRes : []);
      } catch {
        // Leave options empty; user still sees the form
      } finally {
        if (active) setLoadingOptions(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setTitleError('');

    if (!title.trim()) {
      setTitleError('Escribí un título para el ticket.');
      return;
    }
    if (!propertyId) {
      setError('Elegí una propiedad para el ticket.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        propertyId,
        title: title.trim(),
        priority,
      };
      if (categoryId) payload.categoryId = categoryId;
      if (description.trim()) payload.description = description.trim();

      const ticket = await apiClient<CreatedTicket>('/tickets', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      router.push(`${localePrefix}/tickets/${ticket.id}`);
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError(t('form.error'));
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href={`${localePrefix}/tickets`}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          aria-label={t('backToList')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div>
          <p className="eyebrow">Mantenimiento</p>
          <h1 className="h2">{t('newTicket')}</h1>
        </div>
      </div>

      <Reveal>
        <form onSubmit={handleSubmit} className="card-lux p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          {loadingOptions ? (
            <div className="flex items-center gap-3 text-sm text-slate-500 py-4">
              <Spinner /> Cargando opciones…
            </div>
          ) : null}

          {/* Title */}
          <Input
            label={`${t('form.title')} *`}
            placeholder={t('form.titlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            error={titleError || undefined}
            maxLength={500}
          />

          {/* Property */}
          <div className="flex flex-col gap-1">
            <label htmlFor="ticket-property" className="text-[0.8rem] font-medium text-[var(--color-text)]">
              {t('form.property')} *
            </label>
            <select
              id="ticket-property"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              className={selectClass}
            >
              <option value="">{t('form.propertyPlaceholder')}</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                  {p.street ? ` — ${p.street}` : ''}
                  {p.city ? `, ${p.city}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div className="flex flex-col gap-1">
            <label htmlFor="ticket-category" className="text-[0.8rem] font-medium text-[var(--color-text)]">
              {t('form.category')}
            </label>
            <select
              id="ticket-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={selectClass}
            >
              <option value="">{t('form.categoryPlaceholder')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div className="flex flex-col gap-1">
            <label htmlFor="ticket-priority" className="text-[0.8rem] font-medium text-[var(--color-text)]">
              {t('form.priority')}
            </label>
            <select
              id="ticket-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className={selectClass}
            >
              {Object.values(TicketPriority).map((p) => (
                <option key={p} value={p}>
                  {t(`priorities.${p}`)}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <label htmlFor="ticket-description" className="text-[0.8rem] font-medium text-[var(--color-text)]">
              {t('form.description')}
            </label>
            <textarea
              id="ticket-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('form.descriptionPlaceholder')}
              rows={5}
              maxLength={10000}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] hover:border-[var(--color-slate-400)] focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)] transition-[border-color,box-shadow] duration-300 resize-y"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? t('form.creating') : t('form.submit')}
            </Button>
            <Link href={`${localePrefix}/tickets`}>
              <Button type="button" variant="ghost">
                Cancelar
              </Button>
            </Link>
          </div>
        </form>
      </Reveal>
    </div>
  );
}
