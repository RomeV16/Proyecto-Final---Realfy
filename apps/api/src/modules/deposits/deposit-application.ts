import { Money, MoveOutItemKind, sumMoney } from '@realfy/shared';
import type { MoveOutItem, MoneyInput } from '@realfy/shared';

export interface ApplicableLiquidacion {
  id: string;
  dueDate: Date;
}

export interface ApplicationStep {
  liquidacionId: string;
  amount: Money;
  /** El pago cubre también el punitorio devengado a la fecha de egreso. */
  settlePenalties: boolean;
}

export interface ApplicationPlan {
  steps: ApplicationStep[];
  /** Lo que sale del depósito hacia las liquidaciones. */
  applied: Money;
  /** Lo de las liquidaciones incluidas que el depósito no alcanzó a cubrir: sigue en cobro normal. */
  uncovered: Money;
}

/**
 * Cómo se aplica el depósito a las liquidaciones abiertas incluidas en el egreso: de la más antigua a
 * la más nueva por vencimiento, cada una con su alquiler y, si el depósito alcanza para todo, también
 * su punitorio. Un pago que cobra punitorios tiene que cubrir la liquidación completa; si no alcanza
 * se aplica solo al alquiler. Lo que no se cubre queda a cobrar por la vía normal, sin duplicarse.
 */
export function planDepositApplication(
  items: readonly MoveOutItem[],
  available: MoneyInput,
  liquidaciones: readonly ApplicableLiquidacion[],
): ApplicationPlan {
  const included = items.filter((i) => i.included && i.sourceType === 'Liquidacion' && i.sourceId);
  const sumOf = (liqId: string, kind: MoveOutItemKind) =>
    sumMoney(included.filter((i) => i.sourceId === liqId && i.kind === kind).map((i) => i.amount));
  const ordered = [...liquidaciones].sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id.localeCompare(b.id),
  );
  let remaining = new Money(available);
  let uncovered = new Money(0);
  const steps: ApplicationStep[] = [];
  for (const liq of ordered) {
    const rent = sumOf(liq.id, MoveOutItemKind.AlquilerPendiente);
    const penalty = sumOf(liq.id, MoveOutItemKind.Punitorio);
    if (rent.lte(0)) {
      uncovered = uncovered.plus(Money.max(penalty, new Money(0)));
      continue;
    }
    let amount = Money.min(remaining, rent);
    let settlePenalties = false;
    if (amount.eq(rent) && penalty.gt(0) && remaining.minus(rent).gte(penalty)) {
      amount = rent.plus(penalty);
      settlePenalties = true;
    }
    if (amount.gt(0)) {
      steps.push({ liquidacionId: liq.id, amount, settlePenalties });
      remaining = remaining.minus(amount);
    }
    uncovered = uncovered.plus(rent.plus(Money.max(penalty, new Money(0))).minus(amount));
  }
  const applied = sumMoney(steps.map((s) => s.amount.toFixed(2)));
  return { steps, applied, uncovered };
}
