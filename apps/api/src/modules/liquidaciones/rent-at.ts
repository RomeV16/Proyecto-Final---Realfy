/**
 * Alquiler vigente a una fecha, para liquidar períodos pasados con el importe
 * que regía entonces y no con el de hoy (`contracts.rentAmount` es el vigente).
 *
 * Los hitos son los ajustes aplicados (rigen desde su `adjustmentDate`) y las
 * versiones de reglas que fijan un alquiler (`rentOverride`, desde su
 * `validFrom`). Rige el último hito a la fecha; si hay un ajuste provisional y
 * uno definitivo el mismo día, rige el definitivo. Sin hitos a la fecha, rige
 * el alquiler anterior al primer ajuste y, si el contrato nunca se ajustó, el
 * alquiler del contrato.
 */

export interface RentAdjustmentLike {
  adjustmentDate: Date;
  previousAmount: unknown;
  newAmount: unknown;
  isProvisional: boolean;
}

export interface RentTermsLike {
  validFrom: Date;
  rentOverride?: unknown;
}

export interface RentAtDate {
  amount: string;
  isProvisional: boolean;
}

export function rentAtDate(input: {
  contractRent: unknown;
  adjustments: RentAdjustmentLike[];
  termsVersions: RentTermsLike[];
  date: Date;
}): RentAtDate {
  const { date } = input;
  const milestones: { at: Date; amount: string; isProvisional: boolean }[] = [];

  for (const a of input.adjustments) {
    if (a.adjustmentDate.getTime() <= date.getTime()) {
      milestones.push({ at: a.adjustmentDate, amount: String(a.newAmount), isProvisional: a.isProvisional });
    }
  }
  for (const v of input.termsVersions) {
    if (v.rentOverride != null && v.validFrom.getTime() <= date.getTime()) {
      milestones.push({ at: v.validFrom, amount: String(v.rentOverride), isProvisional: false });
    }
  }

  if (milestones.length > 0) {
    milestones.sort(
      (a, b) => a.at.getTime() - b.at.getTime() || Number(b.isProvisional) - Number(a.isProvisional),
    );
    const last = milestones[milestones.length - 1];
    return { amount: last.amount, isProvisional: last.isProvisional };
  }

  const later = input.adjustments
    .filter((a) => a.adjustmentDate.getTime() > date.getTime())
    .sort((a, b) => a.adjustmentDate.getTime() - b.adjustmentDate.getTime())[0];
  if (later) return { amount: String(later.previousAmount), isProvisional: false };

  return { amount: String(input.contractRent), isProvisional: false };
}
