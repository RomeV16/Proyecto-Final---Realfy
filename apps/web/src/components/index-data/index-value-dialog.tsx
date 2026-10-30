'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { IndexType } from '@realfy/shared';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  INDEX_TYPES,
  MANUAL_SOURCE,
  granularityOf,
  isPercent,
  toDecimalString,
  toPeriodIso,
} from '@/lib/index-values';

export interface IndexValueDraft {
  indexType: IndexType;
  /** `YYYY-MM` para índices mensuales, `YYYY-MM-DD` para diarios. */
  period: string;
  value: string;
  /** Editar fija el índice y el período: lo que cambia es el valor. */
  editing: boolean;
}

interface IndexValueDialogProps {
  draft: IndexValueDraft | null;
  onClose: () => void;
  onSaved: (indexType: IndexType) => void;
}

/** Alta o corrección de un valor puntual (POST /index-data, que hace upsert). */
export function IndexValueDialog({ draft, onClose, onSaved }: IndexValueDialogProps) {
  const t = useTranslations('indexData');
  const tCommon = useTranslations('common');

  const [indexType, setIndexType] = useState<IndexType>(INDEX_TYPES[0]);
  const [period, setPeriod] = useState('');
  const [value, setValue] = useState('');
  const [errors, setErrors] = useState<{ period?: string; value?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!draft) return;
    setIndexType(draft.indexType);
    setPeriod(draft.period);
    setValue(draft.value);
    setErrors({});
  }, [draft]);

  const granularity = granularityOf(indexType);
  const percent = isPercent(indexType);

  function changeType(next: IndexType) {
    // Un mes no sirve como fecha diaria ni al revés: se limpia al cambiar de tipo.
    if (granularityOf(next) !== granularity) setPeriod('');
    setIndexType(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const periodIso = toPeriodIso(period, granularity);
    const decimal = toDecimalString(value);
    const nextErrors = {
      period: periodIso ? undefined : t('form.invalidPeriod'),
      value: decimal !== null ? undefined : t('form.invalidValue'),
    };
    setErrors(nextErrors);
    if (!periodIso || decimal === null) return;

    setSaving(true);
    try {
      await apiClient('/index-data', {
        method: 'POST',
        body: JSON.stringify({ indexType, period: periodIso, value: decimal, source: MANUAL_SOURCE }),
      });
      toast.success(t('form.saved'));
      onSaved(indexType);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('form.saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={draft !== null} onClose={onClose} busy={saving}>
      <form onSubmit={handleSubmit} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            {draft?.editing ? t('editValue') : t('addValue')}
          </h2>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="index-value-type" className="text-[0.8rem] font-medium text-[var(--color-text)]">
              {t('form.type')}
            </label>
            <select
              id="index-value-type"
              value={indexType}
              onChange={(e) => changeType(e.target.value as IndexType)}
              disabled={draft?.editing || saving}
              className="h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-sm text-[var(--color-text)] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)] disabled:opacity-50"
            >
              {INDEX_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type} · {t(`unit.${type}`)}
                </option>
              ))}
            </select>
          </div>

          <Input
            id="index-value-period"
            type={granularity === 'month' ? 'month' : 'date'}
            label={granularity === 'month' ? t('form.periodMonth') : t('form.periodDay')}
            placeholder={granularity === 'month' ? t('form.placeholderMonth') : t('form.placeholderDay')}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            disabled={draft?.editing || saving}
            error={errors.period}
          />

          <Input
            id="index-value-value"
            inputMode="decimal"
            autoComplete="off"
            label={percent ? t('form.valuePercent') : t('form.valueLevel')}
            hint={percent ? t('form.valuePercentHint') : t('form.valueLevelHint')}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={saving}
            error={errors.value}
            autoFocus={draft?.editing}
          />

          <p className="text-xs text-[var(--color-muted)]">{t('form.overrideHint')}</p>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving && <Spinner className="h-4 w-4 text-white" />}
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
