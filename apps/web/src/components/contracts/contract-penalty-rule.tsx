'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { PenaltyConfigSchema, type PenaltyConfig } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { formToRule, ruleToForm, type PenaltyRuleForm } from '@/lib/penalty-rule';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PenaltyRuleFields } from '@/components/penalties/penalty-rule-fields';
import { usePenaltyRuleText } from '@/components/penalties/penalty-rule-summary';

interface Props {
  contractId: string;
  /** Regla propia de la versión vigente, si la fija. */
  own: unknown;
  onChanged: () => void;
}

/**
 * La regla de punitorios que rige en el contrato: la propia, si la fijó, o la de
 * la inmobiliaria. Quien gestiona puede cambiarla desde una fecha (queda como un
 * acuerdo de cambio de reglas) o volver a la de la inmobiliaria.
 */
export function ContractPenaltyRule({ contractId, own, onChanged }: Props) {
  const t = useTranslations('punitorios.contractRule');
  const canManage = useCan('contractRules.manage');
  const describe = usePenaltyRuleText();
  const [tenantRule, setTenantRule] = useState<PenaltyConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PenaltyRuleForm>(() => ruleToForm(null));
  const [inherit, setInherit] = useState(false);
  const [from, setFrom] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof PenaltyRuleForm, string>>>({});
  const [fromError, setFromError] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  const ownRule = (() => {
    const parsed = PenaltyConfigSchema.safeParse(own);
    return parsed.success ? parsed.data : null;
  })();

  useEffect(() => {
    let cancelled = false;
    apiClient<unknown>('/tenants/me/penalty-config')
      .then((config) => {
        const parsed = PenaltyConfigSchema.safeParse(config);
        if (!cancelled && parsed.success) setTenantRule(parsed.data);
      })
      .catch(() => undefined); // quien no puede leerla ve solo la regla propia
    return () => {
      cancelled = true;
    };
  }, []);

  const inForce = ownRule ?? tenantRule;

  function openDialog() {
    setForm(ruleToForm(ownRule ?? tenantRule));
    setInherit(false);
    setFrom(new Date().toISOString().slice(0, 10));
    setErrors({});
    setFromError(false);
    setSaveError(null);
    setOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    let penaltyConfig: PenaltyConfig | null = null;
    if (!inherit) {
      const result = formToRule(form);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      penaltyConfig = result.value;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      setFromError(true);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await apiClient(`/contracts/${contractId}/agreements`, {
        method: 'POST',
        body: JSON.stringify({
          kind: 'CambioRegla',
          effectiveFrom: `${from}T00:00:00.000Z`,
          termsPatch: { penaltyConfig },
        }),
      });
      setOpen(false);
      toast.success(t('saved'));
      onChanged();
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-slate-100 pt-4">
      <div>
        <p className="mb-0.5 text-xs text-slate-500">{t('label')}</p>
        <p className="text-sm font-semibold text-slate-900">{inForce ? describe(inForce) : t('unknown')}</p>
        {inForce && <p className="text-xs text-slate-400">{ownRule ? t('sourceContract') : t('sourceTenant')}</p>}
      </div>
      {canManage && (
        <Button variant="secondary" size="sm" onClick={openDialog}>
          {t('change')}
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} size="md" busy={saving}>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <h2 className="text-base font-semibold text-[var(--color-text)]">{t('dialogTitle')}</h2>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              {saveError != null && <ErrorNotice error={saveError} fallback={t('saveError')} />}
              <FormField label={t('from')} hint={t('fromHint')} error={fromError ? t('fromInvalid') : undefined} required>
                {(c) => <Input {...c} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
              </FormField>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[var(--color-brand-500)]"
                  checked={inherit}
                  onChange={(e) => setInherit(e.target.checked)}
                />
                <span>{t('inherit')}</span>
              </label>
              {!inherit && <PenaltyRuleFields values={form} onChange={setForm} errors={errors} />}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}
