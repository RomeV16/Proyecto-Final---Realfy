import Decimal from 'decimal.js';
import { PenaltiesService, PenaltyConfig, ComputePenaltyInput } from './penalties.service';

const ZERO = new Decimal(0);

function makeInput(
  overrides: Partial<{
    totalAmount: Decimal | number;
    dueDate: Date;
    asOf: Date;
    config: Partial<PenaltyConfig>;
    alreadyAppliedPenalty: Decimal | number;
  }> = {},
): ComputePenaltyInput {
  const baseConfig: PenaltyConfig = {
    mode: 'daily_fixed',
    value: new Decimal('10'),
    graceDays: 0,
    maxMultiplier: new Decimal('2'), // max penalty = 100% of debt
  };
  return {
    liquidacion: {
      id: 'liq-1',
      totalAmount: new Decimal(overrides.totalAmount ?? '1000'),
      dueDate: overrides.dueDate ?? new Date('2024-01-01'),
      tenantId: 'tenant-1',
    },
    config: { ...baseConfig, ...overrides.config },
    asOf: overrides.asOf ?? new Date('2024-01-11'), // 10 days overdue
    alreadyAppliedPenalty: new Decimal(overrides.alreadyAppliedPenalty ?? 0),
  };
}

describe('PenaltiesService', () => {
  let svc: PenaltiesService;

  beforeEach(() => {
    svc = new PenaltiesService();
  });

  // ─── daily_fixed ────────────────────────────────────────────────────────────

  describe('daily_fixed', () => {
    it('returns 0 when asOf equals dueDate (0 days overdue)', () => {
      const result = svc.computePenalty(
        makeInput({ asOf: new Date('2024-01-01') }),
      );
      expect(result.amount.toNumber()).toBe(0);
      expect(result.daysOverdue).toBe(0);
      expect(result.capHit).toBe(false);
    });

    it('returns 0 when asOf is before dueDate (negative overdue)', () => {
      const result = svc.computePenalty(
        makeInput({ asOf: new Date('2023-12-31') }),
      );
      expect(result.amount.toNumber()).toBe(0);
      expect(result.daysOverdue).toBe(0);
    });

    it('applies penalty correctly with no grace days (10 days × $10 = $100)', () => {
      const result = svc.computePenalty(makeInput({}));
      expect(result.amount.toNumber()).toBe(100);
      expect(result.daysOverdue).toBe(10);
      expect(result.capHit).toBe(false);
    });

    it('respects graceDays: 10 days overdue with 3 grace days → 7 days billed', () => {
      const result = svc.computePenalty(
        makeInput({ config: { graceDays: 3 } }),
      );
      // 10 - 3 = 7 days * $10 = $70
      expect(result.amount.toNumber()).toBe(70);
    });

    it('returns 0 when overdue days <= graceDays', () => {
      const result = svc.computePenalty(
        makeInput({ asOf: new Date('2024-01-04'), config: { graceDays: 5 } }),
      );
      // 3 days overdue, grace = 5 → effective = 0
      expect(result.amount.toNumber()).toBe(0);
    });

    it('hits cap when accumulated penalty exceeds maxMultiplier limit', () => {
      // debt=1000, maxMultiplier=1.5 → max penalty=500
      // 10 days * $100/day = $1000 → should be capped at 500
      const result = svc.computePenalty(
        makeInput({
          config: {
            value: new Decimal('100'),
            maxMultiplier: new Decimal('1.5'),
          },
        }),
      );
      expect(result.capHit).toBe(true);
      expect(result.amount.toNumber()).toBe(500);
    });
  });

  // ─── daily_percent ──────────────────────────────────────────────────────────

  describe('daily_percent', () => {
    it('applies daily percent correctly (1000 * 0.01 * 10 = 100)', () => {
      const result = svc.computePenalty(
        makeInput({ config: { mode: 'daily_percent', value: new Decimal('0.01') } }),
      );
      expect(result.amount.toNumber()).toBe(100);
      expect(result.daysOverdue).toBe(10);
    });

    it('returns 0 at grace boundary', () => {
      const result = svc.computePenalty(
        makeInput({
          asOf: new Date('2024-01-06'),
          config: { mode: 'daily_percent', value: new Decimal('0.01'), graceDays: 5 },
        }),
      );
      // 5 days overdue = exactly at grace → effective 0
      expect(result.amount.toNumber()).toBe(0);
    });

    it('compoundBase equals debt (not debt+applied) for daily_percent', () => {
      const result = svc.computePenalty(
        makeInput({
          config: { mode: 'daily_percent', value: new Decimal('0.01') },
          alreadyAppliedPenalty: 50,
        }),
      );
      expect(result.compoundBase.toNumber()).toBe(1000);
    });
  });

  // ─── compound_percent ────────────────────────────────────────────────────────

  describe('compound_percent', () => {
    it('returns 0 when effectiveDays is 0 (within grace)', () => {
      const result = svc.computePenalty(
        makeInput({
          asOf: new Date('2024-01-01'),
          config: { mode: 'compound_percent', value: new Decimal('0.01') },
        }),
      );
      expect(result.amount.toNumber()).toBe(0);
    });

    it('returns correct compound amount for 10 days, no prior penalties', () => {
      // debt=1000, rate=0.01/day, 10 days → 1000*(1.01^10) - 1000
      const expected = new Decimal('1000').mul(new Decimal('1.01').pow(10)).sub(1000);
      const result = svc.computePenalty(
        makeInput({
          config: { mode: 'compound_percent', value: new Decimal('0.01') },
          alreadyAppliedPenalty: 0,
        }),
      );
      // Compare to 4 decimal places
      expect(result.amount.toDecimalPlaces(4).toNumber()).toBeCloseTo(
        expected.toDecimalPlaces(4).toNumber(),
        4,
      );
    });

    it('subtracts alreadyAppliedPenalty for incremental daily runs', () => {
      // Simulate: after 5 days we applied X, now at day 10 we should get the delta
      const rate = new Decimal('0.01');
      const debt = new Decimal('1000');
      const penaltyAfter5 = debt.mul(rate.add(1).pow(5)).sub(debt);
      // Now compute at day 10 with alreadyApplied = penaltyAfter5
      const result = svc.computePenalty(
        makeInput({
          config: { mode: 'compound_percent', value: rate },
          alreadyAppliedPenalty: penaltyAfter5,
        }),
      );
      const expectedTotal = debt.mul(rate.add(1).pow(10)).sub(debt);
      const expectedDelta = expectedTotal.sub(penaltyAfter5);
      expect(result.amount.toDecimalPlaces(4).toNumber()).toBeCloseTo(
        expectedDelta.toDecimalPlaces(4).toNumber(),
        4,
      );
      // compoundBase = debt + alreadyApplied
      expect(result.compoundBase.toDecimalPlaces(4).toNumber()).toBeCloseTo(
        debt.add(penaltyAfter5).toDecimalPlaces(4).toNumber(),
        4,
      );
    });

    it('caps compound amount and sets capHit=true', () => {
      // High rate over many days will exceed cap
      const result = svc.computePenalty(
        makeInput({
          config: {
            mode: 'compound_percent',
            value: new Decimal('0.5'), // 50%/day → explodes quickly
            maxMultiplier: new Decimal('1.1'), // cap at 10% of debt
          },
        }),
      );
      expect(result.capHit).toBe(true);
      expect(result.amount.toNumber()).toBeLessThanOrEqual(100); // 10% of 1000
    });

    it('does not go negative when alreadyApplied already exceeds uncapped total', () => {
      // Edge case: alreadyApplied is very high (manual override scenario)
      const result = svc.computePenalty(
        makeInput({
          asOf: new Date('2024-01-02'), // 1 day overdue
          config: { mode: 'compound_percent', value: new Decimal('0.01') },
          alreadyAppliedPenalty: 999999, // absurdly high
        }),
      );
      expect(result.amount.toNumber()).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── Decimal precision ───────────────────────────────────────────────────────

  describe('Decimal precision', () => {
    it('does not use floating point arithmetic (result is a Decimal instance)', () => {
      const result = svc.computePenalty(makeInput({}));
      expect(result.amount).toBeInstanceOf(Decimal);
      expect(result.compoundBase).toBeInstanceOf(Decimal);
    });

    it('preserves precision with fractional values', () => {
      // 1000 * 0.001 * 1 = 1.000 (exact)
      const result = svc.computePenalty(
        makeInput({
          asOf: new Date('2024-01-02'), // 1 day
          config: { mode: 'daily_percent', value: new Decimal('0.001') },
        }),
      );
      expect(result.amount.toString()).toBe('1');
    });
  });
});
