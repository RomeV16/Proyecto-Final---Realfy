'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

type Status = 'idle' | 'submitting' | 'success' | 'error';

interface InquiryFormProps {
  slug: string;
  /** Presente en la ficha de una propiedad: liga la consulta a ese aviso. */
  propertyId?: string;
}

/**
 * Formulario de consulta del portal público. Es el único punto de la
 * portada (y de la ficha de propiedad) que habla directo con el navegador:
 * pega contra `/api/public/:slug/inquiries`, que pasa por el rewrite de
 * Next hacia la API, así que no hace falta conocer el host del backend acá.
 */
export function InquiryForm({ slug, propertyId }: InquiryFormProps) {
  const t = useTranslations('portalPublico.inquiry');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorKey, setErrorKey] = useState<string>('errorGeneric');
  const [contactError, setContactError] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!email.trim() && !phone.trim()) {
      setContactError(true);
      return;
    }
    setContactError(false);
    setStatus('submitting');

    try {
      const res = await fetch(`/api/public/${slug}/inquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          message,
          propertyId,
        }),
      });

      if (res.ok) {
        setStatus('success');
        return;
      }

      if (res.status === 409) setErrorKey('errorClosed');
      else if (res.status === 429) setErrorKey('errorRateLimited');
      else if (res.status === 400) setErrorKey('errorValidation');
      else setErrorKey('errorGeneric');
      setStatus('error');
    } catch {
      setErrorKey('errorGeneric');
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-[var(--radius-2xl)] border border-[color-mix(in_oklab,var(--color-success)_28%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-success)_10%,var(--color-surface))] p-5"
      >
        <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-success)]" strokeWidth={2} />
        <p className="text-sm text-[var(--color-text)]">{t('success')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label={t('firstName')}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
        />
        <Input
          label={t('lastName')}
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label={t('email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={contactError ? t('contactRequired') : undefined}
        />
        <Input
          label={t('phone')}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={contactError ? t('contactRequired') : undefined}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="inquiry-message" className="text-[0.8rem] font-medium text-[var(--color-text)]">
          {t('message')}
        </label>
        <textarea
          id="inquiry-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('messagePlaceholder')}
          required
          rows={4}
          className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] transition-[border-color,box-shadow] duration-300 [transition-timing-function:var(--ease-luxe)] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)]"
        />
      </div>

      {status === 'error' && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-danger)_28%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-danger)_10%,var(--color-surface))] px-3 py-2.5 text-sm text-[color-mix(in_oklab,var(--color-danger)_75%,var(--color-text))]"
        >
          <Icon name="alert" className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span>{t(errorKey)}</span>
        </p>
      )}

      <Button type="submit" disabled={status === 'submitting'} className="w-full sm:w-auto">
        {status === 'submitting' ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
