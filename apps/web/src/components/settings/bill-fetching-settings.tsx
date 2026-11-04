'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { DEFAULT_OPERATIONAL_DEFAULTS, SPECIFIC_BILL_PROVIDER_KEYS, type BillFetchingSettings, type OperationalDefaults } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormShell } from '@/components/ui/form-shell';

type ProviderKey = (typeof SPECIFIC_BILL_PROVIDER_KEYS)[number];

const checkboxClass = 'mt-1 h-4 w-4 accent-[var(--color-brand-500)]';

/**
 * Obtención automática de boletas: el interruptor de la consulta diaria y los proveedores del catálogo que se
 * consultan. Guarda con los valores por defecto completos (el pedido los reemplaza enteros) cambiando sólo
 * `billFetching`.
 */
export function BillFetchingSettingsForm({
  saved,
  onSaved,
}: {
  saved: OperationalDefaults;
  onSaved: (values: OperationalDefaults) => void;
}) {
  const t = useTranslations('billDocuments.settings');
  const tProviders = useTranslations('billDocuments.providers');
  const current = saved.billFetching ?? DEFAULT_OPERATIONAL_DEFAULTS.billFetching;
  const [enabled, setEnabled] = useState(current.enabled);
  const [providers, setProviders] = useState<ProviderKey[]>(current.providers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const toggle = (key: ProviderKey, on: boolean) =>
    setProviders((prev) => SPECIFIC_BILL_PROVIDER_KEYS.filter((k) => (k === key ? on : prev.includes(k))));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const billFetching: BillFetchingSettings = { enabled, providers };
      const result = await apiClient<OperationalDefaults>('/tenants/me/operational-defaults', {
        method: 'PUT',
        body: JSON.stringify({ ...saved, billFetching }),
      });
      onSaved(result);
      toast.success(t('saved'));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormShell onSubmit={(e) => void submit(e)} submitLabel={saving ? t('saving') : t('save')} submitBusy={saving} className="max-w-3xl">
      <FormShell.Section title={t('title')} description={t('description')}>
        <div className="space-y-4">
          {error != null && <ErrorNotice error={error} fallback={t('saveError')} />}
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className={checkboxClass} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>
              <span className="block font-medium">{t('enabled')}</span>
              <span className="block text-[var(--color-muted)]">{t('enabledHint')}</span>
            </span>
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[var(--color-text)]">{t('providers')}</legend>
            <p className="text-sm text-[var(--color-muted)]">{t('providersHint')}</p>
            {SPECIFIC_BILL_PROVIDER_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-brand-500)]"
                  checked={providers.includes(key)}
                  onChange={(e) => toggle(key, e.target.checked)}
                />
                {tProviders(key)}
              </label>
            ))}
          </fieldset>
        </div>
      </FormShell.Section>
    </FormShell>
  );
}
