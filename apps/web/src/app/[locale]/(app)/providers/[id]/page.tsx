'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useParams } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { Reveal } from '@/components/ui/reveal';

/* ──────────── Types ──────────── */

interface ProviderProfile {
  id: string;
  rubros: string[];
  coverageZones: string[];
  isActive: boolean;
  notes?: string | null;
}

interface ProviderDetail {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  isActive: boolean;
  providerProfile: ProviderProfile | null;
  createdAt: string;
  updatedAt: string;
}

/* ──────────── Helpers ──────────── */

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/* ──────────── Page ──────────── */

export default function ProviderDetailPage() {
  const t = useTranslations('providers');
  const tDetail = useTranslations('providers.detail');
  const pathname = usePathname();
  const params = useParams();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
  const providerId = params.id as string;

  const [provider, setProvider] = useState<ProviderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const loadProvider = useCallback(async () => {
    try {
      const data = await apiClient<ProviderDetail>(`/providers/${providerId}`);
      setProvider(data);
    } catch (err) {
      if (err instanceof ApiRequestError && err.statusCode === 404) {
        setNotFound(true);
      }
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    loadProvider();
  }, [loadProvider]);

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  // Not found
  if (notFound || !provider) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[var(--color-surface-sunken)] flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
        </div>
        <h2 className="h3">{t('empty.detail')}</h2>
        <Link
          href={`${localePrefix}/providers`}
          className="mt-4 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-sunken)] transition-colors"
        >
          {t('backToList')}
        </Link>
      </div>
    );
  }

  const profile = provider.providerProfile;
  const isActive = profile ? profile.isActive : provider.isActive;
  const notes = profile?.notes || provider.notes;
  const fullName = `${provider.firstName} ${provider.lastName}`;
  const initials = `${provider.firstName.charAt(0)}${provider.lastName.charAt(0)}`;

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
          <h1 className="h1">{t('detailTitle')}</h1>
        </div>
      </div>

      <Reveal className="w-full max-w-2xl space-y-6">
        {/* Summary card */}
        <div className="card-lux p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-lg font-bold shrink-0 uppercase">
              {initials}
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="h2">{fullName}</h2>
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-[var(--color-surface-sunken)] text-[var(--color-muted)] border-[var(--color-border)]'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-[var(--color-muted)]'}`} />
                  {isActive ? tDetail('active') : tDetail('inactive')}
                </span>
              </div>

              <div className="flex flex-col gap-1 text-sm">
                {provider.email ? (
                  <a href={`mailto:${provider.email}`} className="text-[var(--color-text)] hover:text-brand-600 transition-colors">
                    {provider.email}
                  </a>
                ) : (
                  <span className="text-[var(--color-muted)]">{t('card.noEmail')}</span>
                )}
                {provider.phone ? (
                  <a href={`tel:${provider.phone}`} className="text-[var(--color-text)] hover:text-brand-600 transition-colors">
                    {provider.phone}
                  </a>
                ) : (
                  <span className="text-[var(--color-muted)]">{t('card.noPhone')}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Rubros */}
        <div className="card-lux p-6">
          <p className="eyebrow mb-3">{tDetail('rubros')}</p>
          {profile && profile.rubros.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {profile.rubros.map((rubro) => (
                <span
                  key={rubro}
                  className="px-3 py-1.5 rounded-full text-sm bg-brand-50 text-brand-700 border border-brand-200"
                >
                  {rubro}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">Sin rubros cargados.</p>
          )}
        </div>

        {/* Coverage zones */}
        <div className="card-lux p-6">
          <p className="eyebrow mb-3">{tDetail('coverageZones')}</p>
          {profile && profile.coverageZones.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {profile.coverageZones.map((zone) => (
                <span
                  key={zone}
                  className="px-3 py-1.5 rounded-full text-sm bg-emerald-50 text-emerald-700 border border-emerald-200"
                >
                  {zone}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted)]">Sin zonas de cobertura cargadas.</p>
          )}
        </div>

        {/* Notes */}
        {notes && (
          <div className="card-lux p-6">
            <p className="eyebrow mb-3">{tDetail('notes')}</p>
            <p className="text-sm text-[var(--color-text)] leading-relaxed whitespace-pre-wrap">{notes}</p>
          </div>
        )}

        {/* Metadata */}
        <div className="card-lux p-6 grid grid-cols-2 gap-4">
          <div>
            <p className="micro">{tDetail('createdAt')}</p>
            <p className="text-sm font-medium text-[var(--color-text)] mt-1 first-letter:uppercase">
              {formatDate(provider.createdAt)}
            </p>
          </div>
          <div>
            <p className="micro">{tDetail('updatedAt')}</p>
            <p className="text-sm font-medium text-[var(--color-text)] mt-1 first-letter:uppercase">
              {formatDate(provider.updatedAt)}
            </p>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
