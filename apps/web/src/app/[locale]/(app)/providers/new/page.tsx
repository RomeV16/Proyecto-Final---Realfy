'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Reveal } from '@/components/ui/reveal';
import { Spinner } from '@/components/ui/spinner';

/** Split a comma-separated string into a clean list of trimmed, non-empty values. */
function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function ProviderCreatePage() {
  const t = useTranslations('providers');
  const tForm = useTranslations('providers.form');
  const pathname = usePathname();
  const router = useRouter();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [rubrosRaw, setRubrosRaw] = useState('');
  const [zonesRaw, setZonesRaw] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const rubros = parseList(rubrosRaw);
  const zones = parseList(zonesRaw);
  const canSubmit =
    !!firstName.trim() && !!lastName.trim() && rubros.length > 0 && zones.length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!canSubmit) {
      setError('Completá nombre, apellido, al menos un rubro y una zona de cobertura.');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        rubros,
        coverageZones: zones,
      };
      if (email.trim()) body.email = email.trim();
      if (phone.trim()) body.phone = phone.trim();
      if (notes.trim()) body.notes = notes.trim();

      const created = await apiClient<{ id: string }>('/providers', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      router.push(`${localePrefix}/providers/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : tForm('error'));
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 pb-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href={`${localePrefix}/providers`}
          className="p-2 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-sunken)] transition-colors"
          aria-label={t('backToList')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <div>
          <p className="eyebrow mb-1">Pool de proveedores</p>
          <h1 className="h1">{t('createTitle')}</h1>
        </div>
      </div>

      <Reveal>
        <form onSubmit={handleSubmit} className="w-full max-w-2xl space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Personal info */}
          <div className="card-lux p-6 space-y-5">
            <div>
              <h2 className="h3">{tForm('personalInfo')}</h2>
              <p className="text-sm text-[var(--color-muted)] mt-1">
                Datos de contacto de la persona o empresa.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                id="firstName"
                label={`${tForm('firstName')} *`}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder={tForm('firstNamePlaceholder')}
                required
              />
              <Input
                id="lastName"
                label={`${tForm('lastName')} *`}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder={tForm('lastNamePlaceholder')}
                required
              />
              <Input
                id="email"
                type="email"
                label={tForm('email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={tForm('emailPlaceholder')}
              />
              <Input
                id="phone"
                type="tel"
                label={tForm('phone')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={tForm('phonePlaceholder')}
              />
            </div>
          </div>

          {/* Provider info */}
          <div className="card-lux p-6 space-y-5">
            <div>
              <h2 className="h3">{tForm('providerInfo')}</h2>
              <p className="text-sm text-[var(--color-muted)] mt-1">
                Escribí varios valores separados por comas. Ejemplo: Plomería, Electricidad.
              </p>
            </div>

            <div className="space-y-2">
              <Input
                id="rubros"
                label="Rubros (separá con comas) *"
                value={rubrosRaw}
                onChange={(e) => setRubrosRaw(e.target.value)}
                placeholder={tForm('rubrosPlaceholder')}
                hint="Al menos un rubro. Separá cada uno con una coma."
              />
              {rubros.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {rubros.map((r, i) => (
                    <span
                      key={`${r}-${i}`}
                      className="px-3 py-1.5 rounded-full text-sm bg-brand-50 text-brand-700 border border-brand-200"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Input
                id="coverageZones"
                label="Zonas de cobertura (separá con comas) *"
                value={zonesRaw}
                onChange={(e) => setZonesRaw(e.target.value)}
                placeholder={tForm('coverageZonesPlaceholder')}
                hint="Al menos una zona. Separá cada una con una coma."
              />
              {zones.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {zones.map((z, i) => (
                    <span
                      key={`${z}-${i}`}
                      className="px-3 py-1.5 rounded-full text-sm bg-emerald-50 text-emerald-700 border border-emerald-200"
                    >
                      {z}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="notes" className="text-[0.8rem] font-medium text-[var(--color-text)]">
                {tForm('notes')}
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={tForm('notesPlaceholder')}
                rows={3}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] transition-[border-color,box-shadow] duration-300 focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)] focus:border-brand-500 resize-none"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner className="h-4 w-4 text-white" />
                  {tForm('creating')}
                </>
              ) : (
                tForm('submit')
              )}
            </Button>
            <Link href={`${localePrefix}/providers`}>
              <Button type="button" variant="secondary">
                Cancelar
              </Button>
            </Link>
          </div>
        </form>
      </Reveal>
    </div>
  );
}
