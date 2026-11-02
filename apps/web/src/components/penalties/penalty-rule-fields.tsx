'use client';

import { useTranslations } from 'next-intl';
import type { PenaltyMode } from '@realfy/shared';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  BNA_OPTION_FIELDS,
  PENALTY_RULE_MODES,
  PENALTY_RULE_OPTIONS,
  isPercentMode,
  type PenaltyOptionField,
  type PenaltyRuleForm,
} from '@/lib/penalty-rule';

interface Props {
  values: PenaltyRuleForm;
  onChange: (values: PenaltyRuleForm) => void;
  errors?: Partial<Record<keyof PenaltyRuleForm, string>>;
  disabled?: boolean;
}

/** Campos de una regla de punitorios: el cálculo y sus parámetros. */
export function PenaltyRuleFields({ values, onChange, errors = {}, disabled }: Props) {
  const t = useTranslations('penaltyRule');
  const set = <K extends keyof PenaltyRuleForm>(key: K, value: PenaltyRuleForm[K]) =>
    onChange({ ...values, [key]: value });
  const percent = isPercentMode(values.mode);
  const error = (field: keyof PenaltyRuleForm) => (errors[field] ? t('errors.invalid') : undefined);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField label={t('mode')} className="sm:col-span-2">
        {(c) => (
          <Select
            {...c}
            value={values.mode}
            disabled={disabled}
            onChange={(e) => set('mode', e.target.value as PenaltyMode)}
          >
            {PENALTY_RULE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`modes.${mode}`)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label={values.mode === 'daily_fixed' ? t('valueFixed') : values.mode === 'max_bna_or_daily' ? t('valueFloor') : t('valuePercent')} error={error('value')} required>
        {(c) => (
          <Input
            {...c}
            inputMode="decimal"
            value={values.value}
            disabled={disabled}
            onChange={(e) => set('value', e.target.value)}
          />
        )}
      </FormField>
      <FormField label={t('graceDays')} error={error('graceDays')} required>
        {(c) => (
          <Input
            {...c}
            inputMode="numeric"
            value={values.graceDays}
            disabled={disabled}
            onChange={(e) => set('graceDays', e.target.value)}
          />
        )}
      </FormField>
      <FormField label={t('maxMultiplier')} hint={t('maxMultiplierHint')} error={error('maxMultiplier')} required>
        {(c) => (
          <Input
            {...c}
            inputMode="decimal"
            value={values.maxMultiplier}
            disabled={disabled}
            onChange={(e) => set('maxMultiplier', e.target.value)}
          />
        )}
      </FormField>
      {values.mode === 'max_bna_or_daily' && (
        <>
          <FormField label={t('bnaMultiplier')} error={error('bnaMultiplier')} required>
            {(c) => (
              <Input
                {...c}
                inputMode="decimal"
                value={values.bnaMultiplier}
                disabled={disabled}
                onChange={(e) => set('bnaMultiplier', e.target.value)}
              />
            )}
          </FormField>
          <FormField label={t('yearDays')} hint={t('bnaHint')} error={error('yearDays')} required>
            {(c) => (
              <Select {...c} value={values.yearDays} disabled={disabled} onChange={(e) => set('yearDays', e.target.value)}>
                <option value="365">365</option>
                <option value="360">360</option>
              </Select>
            )}
          </FormField>
        </>
      )}
      {(Object.keys(PENALTY_RULE_OPTIONS) as PenaltyOptionField[])
        .filter((field) => values.mode === 'max_bna_or_daily' || !BNA_OPTION_FIELDS.includes(field))
        .map((field) => (
          <FormField key={field} label={t(`options.${field}.label`)} hint={t(`options.${field}.hint`)} error={error(field)}>
            {(c) => (
              <Select {...c} value={values[field]} disabled={disabled} onChange={(e) => set(field, e.target.value)}>
                {PENALTY_RULE_OPTIONS[field].map((option) => (
                  <option key={option} value={option}>
                    {t(`options.${field}.values.${option}`)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        ))}
      {!percent && <p className="text-xs text-[var(--color-muted)] sm:col-span-2">{t('fixedHint')}</p>}
    </div>
  );
}
