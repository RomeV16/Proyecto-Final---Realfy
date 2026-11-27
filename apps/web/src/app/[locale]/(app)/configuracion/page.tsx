'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { Province } from '@realfy/shared';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { useCan } from '@/lib/permissions';

interface TenantData {
  id: string;
  name: string;
  cuit: string;
  province: string;
  brandPrimary?: string;
  brandSecondary?: string;
  logoUrl?: string;
  licenseNumber?: string | null;
  address?: string | null;
}

const PROVINCES = Object.values(Province);

interface SettingsEntry {
  href: string;
  icon: IconName;
  title: string;
  subtitle: string;
  /** Texto del acceso; también es el nombre accesible del enlace. */
  action: string;
  visible: boolean;
}

/** Acceso a una subpágina: toda la tarjeta es el enlace. */
function SettingsCard({ entry }: { entry: SettingsEntry }) {
  return (
    <Link
      href={entry.href}
      aria-label={entry.action}
      className="group flex items-start gap-3 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm transition-colors hover:border-[var(--color-brand-300)]"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--color-brand-600)]"
        style={{ backgroundColor: 'color-mix(in oklab, var(--color-brand-500) 12%, var(--color-surface))' }}
      >
        <Icon name={entry.icon} className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--color-text)]">{entry.title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-muted)]">{entry.subtitle}</span>
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)]">
          {entry.action}
          <Icon
            name="arrowRight"
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            strokeWidth={2}
          />
        </span>
      </span>
    </Link>
  );
}

export default function ConfiguracionPage() {
  const t = useTranslations('configuracion');
  const tPipeline = useTranslations('pipeline');
  const tFiscal = useTranslations('invoices.fiscal');
  const tScoring = useTranslations('scoring');
  const tIndices = useTranslations('indexData');
  const tUsers = useTranslations('users');
  const tPermissions = useTranslations('permissions');
  const tDefaults = useTranslations('operationalDefaults');
  const tImports = useTranslations('importBatches');
  const tMessaging = useTranslations('messaging.settings');
  const tInbox = useTranslations('inbox.settings');
  const tTemplates = useTranslations('contractTemplates');
  const { user } = useAuth();

  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [province, setProvince] = useState('');
  const [brandPrimary, setBrandPrimary] = useState('#f97316');
  const [brandSecondary, setBrandSecondary] = useState('#0f172a');
  const [logoUrl, setLogoUrl] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [address, setAddress] = useState('');
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
        setLicenseNumber(data.licenseNumber ?? '');
        setAddress(data.address ?? '');
      } catch {
        if (!cancelled) setError(t('loadError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (user) void load();
    return () => {
      cancelled = true;
    };
  }, [user, t]);

  const canEdit = useCan('settings.manage');
  const canViewUsers = useCan('users.view');
  const canManagePermissions = useCan('permissions.manage');
  const canManageDefaults = useCan('operationalDefaults.manage');
  const canViewImports = useCan('imports.manage');
  const canManageMessaging = useCan('messaging.manage');
  const canConfigureInbox = useCan('inbox.configure');

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
        licenseNumber: licenseNumber.trim(),
        address: address.trim(),
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

  const groups: { key: string; title: string; entries: SettingsEntry[] }[] = [
    {
      key: 'team',
      title: t('groups.team'),
      entries: [
        {
          href: '/configuracion/usuarios',
          icon: 'team',
          title: tUsers('title'),
          subtitle: tUsers('cardSubtitle'),
          action: t('manageUsers'),
          visible: canViewUsers,
        },
        {
          href: '/configuracion/permisos',
          icon: 'settings',
          title: tPermissions('title'),
          subtitle: tPermissions('cardSubtitle'),
          action: t('managePermissions'),
          visible: canManagePermissions,
        },
      ],
    },
    {
      key: 'contracts',
      title: t('groups.contracts'),
      entries: [
        {
          href: '/configuracion/valores-por-defecto',
          icon: 'percent',
          title: tDefaults('title'),
          subtitle: tDefaults('cardSubtitle'),
          action: t('manageDefaults'),
          visible: canManageDefaults,
        },
        {
          href: '/configuracion/indices',
          icon: 'trendingUp',
          title: tIndices('title'),
          subtitle: tIndices('cardSubtitle'),
          action: t('manageIndices'),
          visible: canEdit,
        },
        {
          href: '/configuracion/plantillas',
          icon: 'text',
          title: tTemplates('title'),
          subtitle: tTemplates('subtitle'),
          action: t('manageTemplates'),
          visible: canEdit,
        },
        {
          href: '/configuracion/fiscal',
          icon: 'invoices',
          title: tFiscal('title'),
          subtitle: tFiscal('subtitle'),
          action: t('manageFiscal'),
          visible: canEdit,
        },
      ],
    },
    {
      key: 'sales',
      title: t('groups.sales'),
      entries: [
        {
          href: '/configuracion/pipeline',
          icon: 'pipeline',
          title: tPipeline('title'),
          subtitle: tPipeline('subtitle'),
          action: t('managePipeline'),
          visible: canEdit,
        },
        {
          href: '/configuracion/scoring',
          icon: 'percent',
          title: tScoring('title'),
          subtitle: tScoring('cardSubtitle'),
          action: t('manageScoring'),
          visible: canEdit,
        },
      ],
    },
    {
      key: 'communication',
      title: t('groups.communication'),
      entries: [
        {
          href: '/configuracion/mensajeria',
          icon: 'mail',
          title: tMessaging('title'),
          subtitle: tMessaging('cardSubtitle'),
          action: t('manageMessaging'),
          visible: canManageMessaging,
        },
        {
          href: '/configuracion/bandeja',
          icon: 'inbox',
          title: tInbox('title'),
          subtitle: tInbox('cardSubtitle'),
          action: t('manageInbox'),
          visible: canConfigureInbox,
        },
      ],
    },
    {
      key: 'data',
      title: t('groups.data'),
      entries: [
        {
          href: '/configuracion/importaciones',
          icon: 'import',
          title: tImports('title'),
          subtitle: tImports('cardSubtitle'),
          action: t('manageImports'),
          visible: canViewImports,
        },
      ],
    },
  ];
  const visibleGroups = groups
    .map((group) => ({ ...group, entries: group.entries.filter((entry) => entry.visible) }))
    .filter((group) => group.entries.length > 0);

  const markDirty = () => setSaved(false);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">{t('title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <form onSubmit={handleSubmit} className="card-lux space-y-5 p-5 sm:p-6">
          <div>
            <h2 className="h3">{t('organization.title')}</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{t('organization.subtitle')}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('name')}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                markDirty();
              }}
              disabled={!canEdit || saving}
            />
            <Input label={t('cuit')} value={tenant?.cuit ?? ''} hint={t('cuitHint')} disabled readOnly />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('licenseNumber')}
              value={licenseNumber}
              maxLength={60}
              onChange={(e) => {
                setLicenseNumber(e.target.value);
                markDirty();
              }}
              disabled={!canEdit || saving}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="province" className="text-sm font-medium text-[var(--color-text)]">
                {t('province')}
              </label>
              <Select
                id="province"
                value={province}
                onChange={(e) => {
                  setProvince(e.target.value);
                  markDirty();
                }}
                disabled={!canEdit || saving}
              >
                {PROVINCES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <Input
            label={t('address')}
            value={address}
            maxLength={300}
            onChange={(e) => {
              setAddress(e.target.value);
              markDirty();
            }}
            disabled={!canEdit || saving}
          />

          <div className="space-y-4 border-t border-[var(--color-border)] pt-5">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('brand.title')}</h3>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">{t('brand.subtitle')}</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="brand-primary" className="text-sm font-medium text-[var(--color-text)]">
                  {t('brandPrimary')}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="brand-primary"
                    type="color"
                    value={brandPrimary}
                    onChange={(e) => {
                      setBrandPrimary(e.target.value);
                      markDirty();
                    }}
                    disabled={!canEdit || saving}
                    className="h-10 w-16 cursor-pointer rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] disabled:opacity-50"
                  />
                  <span className="text-sm tabular-nums text-[var(--color-muted)]">{brandPrimary}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="brand-secondary" className="text-sm font-medium text-[var(--color-text)]">
                  {t('brandSecondary')}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="brand-secondary"
                    type="color"
                    value={brandSecondary}
                    onChange={(e) => {
                      setBrandSecondary(e.target.value);
                      markDirty();
                    }}
                    disabled={!canEdit || saving}
                    className="h-10 w-16 cursor-pointer rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] disabled:opacity-50"
                  />
                  <span className="text-sm tabular-nums text-[var(--color-muted)]">{brandSecondary}</span>
                </div>
              </div>
            </div>
            <Input
              label={t('logoUrl')}
              value={logoUrl}
              onChange={(e) => {
                setLogoUrl(e.target.value);
                markDirty();
              }}
              placeholder="https://..."
              hint={t('logoHint')}
              disabled={!canEdit || saving}
            />
          </div>

          {!canEdit && <p className="text-sm text-[var(--color-muted)]">{t('readOnly')}</p>}
          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
          {saved && <p className="text-sm text-[var(--color-success)]">{t('saved')}</p>}

          {canEdit && (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? t('saving') : t('save')}
              </Button>
            </div>
          )}
        </form>

        {visibleGroups.length > 0 && (
          <div className="order-first space-y-5 xl:order-none">
            {visibleGroups.map((group) => (
              <section key={group.key} aria-label={group.title}>
                <h2 className="micro mb-2">{group.title}</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {group.entries.map((entry) => (
                    <SettingsCard key={entry.href} entry={entry} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
