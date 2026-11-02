import { Money, allocateLargestRemainder, round2, type MoneyInput } from '../money';
import { ChargeTarget, LineBeneficiary, LineItemType, PendingChargeKind } from '../enums';
import type { LiquidationExtraLine } from '../liquidation-builder';

/**
 * Cargos pendientes del centro de carga (puro, sin acceso a la base).
 *
 * Un cargo es un gasto o crédito puntual del mes (reparación, expensa
 * extraordinaria, devolución, honorario por gestión). Se imputa una sola vez:
 *
 * - Inquilino: renglón de su próxima liquidación (`pendingChargeLine`).
 * - Locador: descuento del estado del locador; no es un renglón de la
 *   liquidación del inquilino. Queda Pendiente hasta que el estado de cuenta
 *   del locador lo tome (`imputedStatementId`).
 * - Inmobiliaria: la absorbe la inmobiliaria; solo queda registrado.
 *
 * Reglas del renglón al inquilino:
 * - Importe positivo: `Cargo` (reparación, expensa extra, otro), `Honorario`
 *   (honorario por gestión, siempre a favor de la inmobiliaria) o
 *   `AjusteRetroactivo`. Nunca lleva comisión (FB-07), salvo el ajuste
 *   retroactivo, que es una diferencia de alquiler y se comisiona como él.
 * - Importe negativo (devolución o crédito): los renglones no pueden ser
 *   negativos, así que va como `Descuento` "a favor del inquilino", sin comisión
 *   (salvo el ajuste retroactivo, igual que la corrección de un ajuste).
 * - A quién llega el dinero (`beneficiary`) lo dice quien lo carga: el locador si
 *   pagó al proveedor y se lo cobra al inquilino; la inmobiliaria si lo adelantó ella.
 * - Cuotas: el importe se parte en partes iguales al centavo (mayor resto, el
 *   centavo sobrante va a las primeras cuotas), una por mes.
 * - Anticipo: un importe a cobrar al inquilino que supera `upfrontThresholdFees`
 *   comisiones mensuales del contrato no entra solo en la liquidación.
 */

/** Dónde se imputa un cargo según quién lo soporta. */
export type ChargeImputationTarget = 'Liquidacion' | 'EstadoLocador' | 'Ninguno';

export function imputationTarget(chargedTo: ChargeTarget | `${ChargeTarget}`): ChargeImputationTarget {
  if (chargedTo === ChargeTarget.Inquilino) return 'Liquidacion';
  if (chargedTo === ChargeTarget.Locador) return 'EstadoLocador';
  return 'Ninguno';
}

const KIND_LABEL: Record<PendingChargeKind, string> = {
  [PendingChargeKind.Reparacion]: 'Reparación',
  [PendingChargeKind.ExpensaExtra]: 'Expensa extraordinaria',
  [PendingChargeKind.Devolucion]: 'Devolución',
  [PendingChargeKind.HonorarioGestion]: 'Honorario por gestión',
  [PendingChargeKind.AjusteRetroactivo]: 'Ajuste retroactivo',
  [PendingChargeKind.Otro]: '',
};

export interface PendingChargeLineSource {
  id: string;
  kind: PendingChargeKind | `${PendingChargeKind}`;
  chargedTo: ChargeTarget | `${ChargeTarget}`;
  /** Con signo: un negativo es un crédito a favor del inquilino. */
  amount: MoneyInput;
  description: string;
  beneficiary: LineBeneficiary | `${LineBeneficiary}`;
  installmentNo?: number;
  installmentOf?: number;
}

/** Renglón de la liquidación del inquilino, o null si el cargo no va ahí. */
export function pendingChargeLine(source: PendingChargeLineSource): LiquidationExtraLine | null {
  if (source.chargedTo !== ChargeTarget.Inquilino) return null;
  const amount = round2(source.amount);
  if (amount.isZero()) return null;

  const kind = source.kind as PendingChargeKind;
  const label = KIND_LABEL[kind];
  const installment =
    (source.installmentOf ?? 1) > 1 ? `, cuota ${source.installmentNo ?? 1}/${source.installmentOf}` : '';
  const text = `${label ? `${label}: ` : ''}${source.description}${installment}`;
  const isAdjustment = kind === PendingChargeKind.AjusteRetroactivo;

  if (amount.isNegative()) {
    return {
      type: LineItemType.Descuento,
      description: `${text}, a favor del inquilino`,
      amount: amount.abs().toFixed(2),
      commissionable: isAdjustment,
      beneficiary: source.beneficiary as LineBeneficiary,
      sourceType: 'PendingCharge',
      sourceId: source.id,
    };
  }

  const isFee = kind === PendingChargeKind.HonorarioGestion;
  return {
    type: isFee ? LineItemType.Honorario : isAdjustment ? LineItemType.AjusteRetroactivo : LineItemType.Cargo,
    description: text,
    amount: amount.toFixed(2),
    commissionable: isAdjustment,
    beneficiary: isFee ? LineBeneficiary.Inmobiliaria : (source.beneficiary as LineBeneficiary),
    sourceType: 'PendingCharge',
    sourceId: source.id,
  };
}

/** Una devolución siempre es un crédito: se guarda con signo negativo aunque se cargue positiva. */
export function signedChargeAmount(kind: PendingChargeKind | `${PendingChargeKind}`, amount: MoneyInput): string {
  const value = round2(amount);
  return (kind === PendingChargeKind.Devolucion ? value.abs().negated() : value).toFixed(2);
}

/**
 * Parte un importe en `count` cuotas mensuales por el mayor resto: la suma
 * es exactamente el total y el centavo sobrante va a las primeras cuotas.
 * Un importe negativo se parte igual y conserva el signo.
 */
export function splitInstallments(total: MoneyInput, count: number): string[] {
  if (!Number.isInteger(count) || count < 1) throw new Error('La cantidad de cuotas debe ser un entero de 1 o más');
  const value = round2(total);
  const parts = allocateLargestRemainder(value.abs(), Array.from({ length: count }, () => 1));
  return parts.map((p) => (value.isNegative() ? p.negated() : p).toFixed(2));
}

export interface UpfrontCheck {
  amount: MoneyInput;
  /** Comisión mensual del contrato. */
  monthlyCommission: MoneyInput;
  /** Umbral en comisiones mensuales (`operationalDefaults.upfrontThresholdFees`). */
  thresholdFees: MoneyInput;
}

/**
 * Si un cargo a cobrar al inquilino supera el umbral de anticipo. Solo cuenta
 * un importe positivo; sin comisión mensual no hay con qué comparar y no se pide.
 * Con umbral 0 todo importe positivo supera el umbral.
 */
export function requiresUpfront(check: UpfrontCheck): boolean {
  const amount = new Money(check.amount);
  const commission = new Money(check.monthlyCommission);
  if (!amount.gt(0) || !commission.gt(0)) return false;
  return amount.gt(commission.times(new Money(check.thresholdFees)));
}
