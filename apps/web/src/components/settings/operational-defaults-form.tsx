'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  DEFAULT_OPERATIONAL_DEFAULTS,
  operationalDefaultsFormSchema,
  operationalDefaultsFromForm,
  operationalDefaultsToForm,
  type OperationalDefaults,
  type OperationalDefaultsFormInput,
} from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { FormShell } from '@/components/ui/form-shell';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

type FieldName = keyof OperationalDefaultsFormInput;

/** Campos de cada sección, en el orden en que se muestran. */
const SECTIONS: { key: string; fields: FieldName[] }[] = [
  { key: 'rent', fields: ['dueDay', 'leadDays', 'ipcLagMonths'] },
  { key: 'fees', fields: ['commissionPct', 'feeAlta', 'feeRenovacion', 'feeVentaConstruido', 'feeVentaLote'] },
  { key: 'valuation', fields: ['valuationUsd', 'upfrontThresholdFees'] },
  { key: 'collection', fields: ['firstReminderDays', 'everyDays'] },
  { key: 'expiry', fields: ['redDays', 'yellowDays'] },
];

const DEFAULT_FORM = operationalDefaultsToForm(DEFAULT_OPERATIONAL_DEFAULTS);

function DefaultsForm({
  saved,
  onSaved,
}: {
  saved: OperationalDefaults;
  onSaved: (values: OperationalDefaults) => void;
}) {
  const t = useTranslations('operationalDefaults');
  const { values, set, setValues, errors, formError, submitting, submit } = useZodForm({
    schema: operationalDefaultsFormSchema,
    initialValues: operationalDefaultsToForm(saved),
    translate: useSchemaMessages(),
  });

  const handleSubmit = submit(async (data) => {
    const result = await apiClient<OperationalDefaults>('/tenants/me/operational-defaults', {
      method: 'PUT',
      body: JSON.stringify(operationalDefaultsFromForm(data)),
    });
    onSaved(result);
    toast.success(t('saved'));
  });

  return (
    <FormShell
      onSubmit={handleSubmit}
      submitLabel={submitting ? t('saving') : t('save')}
      submitBusy={submitting}
      secondaryAction={{ label: t('restore'), onClick: () => setValues(DEFAULT_FORM) }}
      className="max-w-3xl"
    >
      {formError != null && <ErrorNotice error={formError} fallback={t('saveError')} />}
      {SECTIONS.map((section) => (
        <FormShell.Section
          key={section.key}
          title={t(`sections.${section.key}.title`)}
          description={t(`sections.${section.key}.description`)}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {section.fields.map((field) => (
              <FormField
                key={field}
                label={t(`fields.${field}.label`)}
                hint={t(`fields.${field}.hint`, { value: DEFAULT_FORM[field] })}
                error={errors[field]}
                required
              >
                {(c) => (
                  <Input
                    {...c}
                    inputMode="decimal"
                    value={values[field]}
                    onChange={(e) => set(field, e.target.value)}
                  />
                )}
              </FormField>
            ))}
          </div>
        </FormShell.Section>
      ))}
    </FormShell>
  );
}

/** Configuración → Valores por defecto: de acá parten las reglas de cada contrato nuevo. */
export function OperationalDefaultsManager() {
  const t = useTranslations('operationalDefaults');
  const canManage = useCan('operationalDefaults.manage');
  const [saved, setSaved] = useState<OperationalDefaults | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setSaved(await apiClient<OperationalDefaults>('/tenants/me/operational-defaults'));
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }, []);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  if (!canManage) {
    return <p className="text-sm text-[var(--color-muted)]">{t('readOnly')}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">{t('subtitle')}</p>
      </div>
      {loadError != null && <ErrorNotice error={loadError} fallback={t('loadError')} />}
      {loadError == null && saved === null && <Skeleton className="h-64 w-full max-w-3xl" />}
      {saved !== null && <DefaultsForm saved={saved} onSaved={setSaved} />}
    </div>
  );
}
