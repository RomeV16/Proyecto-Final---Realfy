'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { PenaltyConfigSchema, type PenaltyConfig } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { formToRule, ruleToForm, type PenaltyRuleForm } from '@/lib/penalty-rule';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Skeleton } from '@/components/ui/skeleton';
import { PenaltyRuleFields } from '@/components/penalties/penalty-rule-fields';
import { usePenaltyRuleText } from '@/components/penalties/penalty-rule-summary';

/**
 * Regla de punitorios por defecto de la inmobiliaria: rige en todo contrato que
 * no fije la suya. La cambia el administrador; el resto la ve.
 */
export function PenaltyConfigForm() {
  const t = useTranslations('punitorios.settings');
  const canEdit = useCan('penaltyConfig.manage');
  const describe = usePenaltyRuleText();
  const [saved, setSaved] = useState<PenaltyConfig | null>(null);
  const [form, setForm] = useState<PenaltyRuleForm | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof PenaltyRuleForm, string>>>({});
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient<PenaltyConfig>('/tenants/me/penalty-config')
      .then((raw) => {
        if (cancelled) return;
        const parsed = PenaltyConfigSchema.safeParse(raw);
        if (!parsed.success) {
          setLoadError(parsed.error);
          return;
        }
        setSaved(parsed.data);
        setForm(ruleToForm(parsed.data));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const result = formToRule(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await apiClient<PenaltyConfig>('/tenants/me/penalty-config', {
        method: 'PUT',
        body: JSON.stringify(result.value),
      });
      setSaved(updated);
      toast.success(t('saved'));
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-3xl space-y-4 rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="penalty-config-title">
      <div>
        <h2 id="penalty-config-title" className="text-base font-semibold text-slate-900">
          {t('title')}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{t('description')}</p>
      </div>
      {loadError != null && <ErrorNotice error={loadError} fallback={t('loadError')} />}
      {loadError == null && form === null && <Skeleton className="h-32 w-full" />}
      {saved && !canEdit && <p className="text-sm text-slate-700">{describe(saved)}</p>}
      {form && canEdit && (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {saveError != null && <ErrorNotice error={saveError} fallback={t('saveError')} />}
          <PenaltyRuleFields values={form} onChange={setForm} errors={errors} />
          {saved && <p className="text-xs text-slate-500">{t('current', { rule: describe(saved) })}</p>}
          <Button type="submit" disabled={saving}>
            {saving ? t('saving') : t('save')}
          </Button>
        </form>
      )}
    </section>
  );
}
