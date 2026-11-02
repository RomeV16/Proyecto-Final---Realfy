'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { LessorDirectOwes } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

const OPTIONS = Object.values(LessorDirectOwes);

interface Props {
  contractId: string;
  /** Lo que fija la versión vigente del contrato; null = el valor de la inmobiliaria. */
  own: string | null | undefined;
  onChanged: () => void;
}

/**
 * Qué le debe a la inmobiliaria el locador que cobra directamente: lo pactado
 * en el contrato o, sin pacto, lo de la inmobiliaria. Quien gestiona lo cambia
 * desde una fecha (queda como un acuerdo de cambio de reglas).
 */
export function ContractLessorDirectOwes({ contractId, own, onChanged }: Props) {
  const t = useTranslations('contractRules.lessorDirectOwes');
  const tOptions = useTranslations('operationalDefaults.fields.cashLessorDirectOwes.options');
  const canManage = useCan('contractRules.manage');
  const [agencyValue, setAgencyValue] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [from, setFrom] = useState('');
  const [fromError, setFromError] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient<{ cash?: { lessorDirectOwes?: string } }>('/tenants/me/operational-defaults')
      .then((defaults) => {
        if (!cancelled) setAgencyValue(defaults?.cash?.lessorDirectOwes ?? null);
      })
      .catch(() => undefined); // quien no puede leerlos ve solo lo pactado
    return () => {
      cancelled = true;
    };
  }, []);

  const inForce = own ?? agencyValue;

  function openDialog() {
    setValue(own ?? '');
    setFrom(new Date().toISOString().slice(0, 10));
    setFromError(false);
    setSaveError(null);
    setOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
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
          termsPatch: { lessorDirectOwes: value || null },
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
        <p className="text-sm font-semibold text-slate-900">{inForce ? tOptions(inForce) : t('unknown')}</p>
        {inForce && <p className="text-xs text-slate-400">{own ? t('sourceContract') : t('sourceTenant')}</p>}
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
              <FormField label={t('label')} hint={t('hint')}>
                {(c) => (
                  <Select {...c} value={value} onChange={(e) => setValue(e.target.value)}>
                    <option value="">{t('inherit')}</option>
                    {OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {tOptions(option)}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
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
