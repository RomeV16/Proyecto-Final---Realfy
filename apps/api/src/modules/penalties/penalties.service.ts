import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

export type PenaltyMode = 'daily_fixed' | 'daily_percent' | 'compound_percent';

export interface PenaltyConfig {
  mode: PenaltyMode;
  /** Rate or fixed amount per day (percent expressed as fraction, e.g. 0.001 = 0.1%/day) */
  value: Decimal;
  /** Number of days after due date before penalties begin */
  graceDays: number;
  /** Max total penalty as a multiplier of debt (e.g. 1.5 means penalty can be at most 50% of debt) */
  maxMultiplier: Decimal;
}

export interface ComputePenaltyInput {
  liquidacion: {
    id: string;
    totalAmount: Decimal;
    dueDate: Date;
    tenantId: string;
  };
  config: PenaltyConfig;
  asOf: Date;
  /** Sum of Penalty.amount rows already applied for this liquidacion (to compound safely) */
  alreadyAppliedPenalty: Decimal;
}

export interface ComputePenaltyResult {
  /** Delta to add as a new Penalty row */
  amount: Decimal;
  daysOverdue: number;
  /** Base used for this calc (debt + alreadyApplied in compound mode, debt in others) */
  compoundBase: Decimal;
  capHit: boolean;
}

/**
 * Returns the number of whole days between two dates using date-only arithmetic
 * (ignores time-of-day). Result is clamped at 0.
 */
function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  const fromDay = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toDay = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(0, Math.floor((toDay - fromDay) / MS_PER_DAY));
}

@Injectable()
export class PenaltiesService {
  computePenalty(input: ComputePenaltyInput): ComputePenaltyResult {
    const { liquidacion, config, asOf, alreadyAppliedPenalty } = input;
    const debt = new Decimal(liquidacion.totalAmount);
    const applied = new Decimal(alreadyAppliedPenalty);
    const value = new Decimal(config.value);
    const maxMultiplier = new Decimal(config.maxMultiplier);

    const rawDaysOverdue = daysBetween(liquidacion.dueDate, asOf);
    const effectiveDays = Math.max(0, rawDaysOverdue - config.graceDays);

    let amount: Decimal;
    let compoundBase: Decimal;

    switch (config.mode) {
      case 'daily_fixed': {
        compoundBase = debt;
        amount = value.mul(effectiveDays);
        break;
      }

      case 'daily_percent': {
        compoundBase = debt;
        amount = debt.mul(value).mul(effectiveDays);
        break;
      }

      case 'compound_percent': {
        // Base is debt + already applied (so each run only adds the delta)
        compoundBase = debt.add(applied);
        if (effectiveDays === 0) {
          amount = new Decimal(0);
        } else {
          // Total accrued = debt * (1 + r)^days - debt
          const totalAccrued = debt.mul(
            value.add(1).pow(effectiveDays),
          ).sub(debt);
          // Delta = totalAccrued - already applied
          amount = totalAccrued.sub(applied);
          if (amount.lessThan(0)) {
            amount = new Decimal(0);
          }
        }
        break;
      }

      default: {
        const _exhaustive: never = config.mode;
        throw new Error(`Unknown penalty mode: ${String(_exhaustive)}`);
      }
    }

    // Apply cap: total applied penalty must not exceed debt * (maxMultiplier - 1)
    const cap = debt.mul(maxMultiplier.sub(1));
    let capHit = false;

    if (cap.greaterThanOrEqualTo(0)) {
      const totalAfter = applied.add(amount);
      if (totalAfter.greaterThan(cap)) {
        const capped = cap.sub(applied);
        amount = capped.lessThan(0) ? new Decimal(0) : capped;
        capHit = true;
      }
    }

    return {
      amount,
      daysOverdue: rawDaysOverdue,
      compoundBase,
      capHit,
    };
  }
}
