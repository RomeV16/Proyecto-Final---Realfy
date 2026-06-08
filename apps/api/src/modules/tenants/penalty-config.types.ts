export interface PenaltyConfig {
  mode: 'daily_fixed' | 'daily_percent' | 'compound_percent';
  /** Decimal as string for JSON portability (e.g. "0.001" = 0.1%) */
  value: string;
  graceDays: number;
  /** Decimal as string, e.g. "2.0" caps at 2x the base debt */
  maxMultiplier: string;
}

export const DEFAULT_PENALTY_CONFIG: PenaltyConfig = {
  mode: 'daily_percent',
  value: '0.001',
  graceDays: 5,
  maxMultiplier: '2.0',
};
