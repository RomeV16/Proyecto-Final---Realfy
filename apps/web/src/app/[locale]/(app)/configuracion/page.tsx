'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Province } from '@realfy/shared';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

interface TenantData {
  id: string;
  name: string;
  cuit: string;
  province: string;
  brandPrimary?: string;
  brandSecondary?: string;
  logoUrl?: string;
}

const PROVINCES = Object.values(Province);

export default function ConfiguracionPage() {
  const t = useTranslations('configuracion');
  const tPipeline = useTranslations('pipeline');
  const tFiscal = useTranslations('invoices.fiscal');
  const tScoring = useTranslations('scoring');
  const { user } = useAuth();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [province, setProvince] = useState('');
  const [brandPrimary, setBrandPrimary] = useState('#f97316');
  const [brandSecondary, setBrandSecondary] = useState('#0f172a');
  const [logoUrl, setLogoUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiClient<TenantData>('/tenants/me');
        if (cancelled) return;
        setTenant(data);
        setName(data.name ?? '');
        setProvince(data.province ?? '');
        setBrandPrimary(data.brandPrimary ?? '#f97316');
        setBrandSecondary(data.brandSecondary ?? '#0f172a');
        setLogoUrl(data.logoUrl ?? '');
      } catch {
        if (!cancelled) setError(t('loadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (user) load();
    return () => {
      cancelled = true;
    };
  }, [user, t]);

  const canEdit = user?.role === 'Admin' || user?.role === 'Gerente';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tenant) return;
    if (!name.trim()) {
      setError(t('nameRequired'));
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const body: Record<string, string> = {
        name: name.trim(),
        province,
        brandPrimary,
        brandSecondary,
      };
      if (logoUrl.trim()) body.logoUrl = logoUrl.trim();

      const updated = await apiClient<TenantData>(`/tenants/${tenant.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setTenant(updated);
      setSaved(true);
    } catch {
      setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="h1">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('subtitle')}</p>
      </div>

      {canEdit && (
        <div className="flex flex-col gap-3 bg-white rounded-xl border border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <Icon name="pipeline" className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">{tPipeline('title')}</p>
              <p className="text-sm text-slate-500 mt-0.5">{tPipeline('subtitle')}</p>
            </div>
          </div>
          <Link href={`${localePrefix}/configuracion/pipeline`} className="shrink-0">
            <Button variant="secondary" size="sm">
              {t('managePipeline')}
            </Button>
          </Link>
        </div>
      )}

      {canEdit && (
        <div className="flex flex-col gap-3 bg-white rounded-xl border border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <Icon name="invoices" className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">{tFiscal('title')}</p>
              <p className="text-sm text-slate-500 mt-0.5">{tFiscal('subtitle')}</p>
            </div>
          </div>
          <Link href={`${localePrefix}/configuracion/fiscal`} className="shrink-0">
            <Button variant="secondary" size="sm">
              {t('manageFiscal')}
            </Button>
          </Link>
        </div>
      )}

      {canEdit && (
        <div className="flex flex-col gap-3 bg-white rounded-xl border border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <Icon name="percent" className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">{tScoring('title')}</p>
              <p className="text-sm text-slate-500 mt-0.5">{tScoring('description')}</p>
            </div>
          </div>
          <Link href={`${localePrefix}/configuracion/scoring`} className="shrink-0">
            <Button variant="secondary" size="sm">
              {t('manageScoring')}
            </Button>
          </Link>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-slate-200 p-6 space-y-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={t('name')}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            disabled={!canEdit || saving}
          />
          <Input label={t('cuit')} value={tenant?.cuit ?? ''} disabled readOnly />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="province"
            className="text-sm font-medium text-[var(--color-text)]"
          >
            {t('province')}
          </label>
          <select
            id="province"
            value={province}
            onChange={(e) => {
              setProvince(e.target.value);
              setSaved(false);
            }}
            disabled={!canEdit || saving}
            className="h-10 w-full rounded-md border border-[var(--color-border)] px-3 py-2 text-sm bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-2 focus:outline-brand-500 disabled:opacity-50"
          >
            {PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--color-text)]">
              {t('brandPrimary')}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={brandPrimary}
                onChange={(e) => {
                  setBrandPrimary(e.target.value);
                  setSaved(false);
                }}
                disabled={!canEdit || saving}
                className="h-10 w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] cursor-pointer disabled:opacity-50"
              />
              <span className="text-sm text-slate-500 tabular-nums">
                {brandPrimary}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-[var(--color-text)]">
              {t('brandSecondary')}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={brandSecondary}
                onChange={(e) => {
                  setBrandSecondary(e.target.value);
                  setSaved(false);
                }}
                disabled={!canEdit || saving}
                className="h-10 w-16 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] cursor-pointer disabled:opacity-50"
              />
              <span className="text-sm text-slate-500 tabular-nums">
                {brandSecondary}
              </span>
            </div>
          </div>
        </div>

        <Input
          label={t('logoUrl')}
          value={logoUrl}
          onChange={(e) => {
            setLogoUrl(e.target.value);
            setSaved(false);
          }}
          placeholder="https://..."
          disabled={!canEdit || saving}
        />

        {!canEdit && (
          <p className="text-sm text-slate-500">{t('readOnly')}</p>
        )}
        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
        {saved && <p className="text-sm text-emerald-600">{t('saved')}</p>}

        {canEdit && (
          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={saving}>
              {saving ? t('saving') : t('save')}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
