import type { RentStep } from '@realfy/shared';

interface AdjustmentRow {
  periodNumber: number;
  adjustmentDate: Date;
  previousAmount: unknown;
  newAmount: unknown;
  appliedAt: Date | null;
  isProvisional: boolean;
}

/**
 * Escalones del alquiler de un contrato: el inicial (el alquiler antes del primer
 * ajuste, o el actual si nunca se ajustó) y cada ajuste aplicado. De dos ajustes del
 * mismo período (uno provisorio y su corrección) vale el definitivo.
 */
export function rentStepsOf(
  contract: { startDate: Date; rentAmount: unknown },
  adjustments: readonly AdjustmentRow[],
): RentStep[] {
  const applied = adjustments.filter((a) => a.appliedAt !== null);
  const byPeriod = new Map<number, AdjustmentRow>();
  for (const a of applied) {
    const current = byPeriod.get(a.periodNumber);
    if (!current || (current.isProvisional && !a.isProvisional)) byPeriod.set(a.periodNumber, a);
  }
  const rows = [...byPeriod.values()].sort(
    (a, b) => a.adjustmentDate.getTime() - b.adjustmentDate.getTime() || a.periodNumber - b.periodNumber,
  );
  const initial = rows.length > 0 ? String(rows[0].previousAmount) : String(contract.rentAmount);
  return [
    { date: contract.startDate, amount: initial },
    ...rows.map((r) => ({ date: r.adjustmentDate, amount: String(r.newAmount) })),
  ];
}
