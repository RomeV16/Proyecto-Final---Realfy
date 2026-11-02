'use client';

import { useTranslations } from 'next-intl';
import type { PenaltyConfig } from '@realfy/shared';
import { formatNumber, formatPercent } from '@/lib/format';
import { isPercentMode } from '@/lib/penalty-rule';

/** La regla en una frase: cálculo, días de gracia y tope. */
export function usePenaltyRuleText() {
  const t = useTranslations('penaltyRule');
  return (rule: PenaltyConfig): string => {
    const value = isPercentMode(rule.mode)
      ? formatPercent(Number(rule.value) * 100, { decimals: 2 })
      : formatNumber(Number(rule.value), { decimals: 2 });
    const calc = t(`describe.${rule.mode}`, { value, multiplier: rule.bnaMultiplier ?? '2' });
    const grace = t('grace', { count: rule.graceDays });
    const cap = t('cap', { value: rule.maxMultiplier });
    return `${calc} · ${grace} · ${cap}`;
  };
}
