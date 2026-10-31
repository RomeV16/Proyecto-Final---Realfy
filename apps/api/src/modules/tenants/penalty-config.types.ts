import type { PenaltyConfig } from '@realfy/shared';

export type { PenaltyConfig };

export const DEFAULT_PENALTY_CONFIG: PenaltyConfig = {
  mode: 'daily_percent',
  value: '0.001',
  graceDays: 5,
  maxMultiplier: '2.0',
};
