import { Money, allocateLargestRemainder, round2, sumMoney, type MoneyInput } from '../money';
import {
  AnnualRecovery,
  ChargePayer,
  ChargeSplitMode,
  LineBeneficiary,
  LineItemType,
  ServicePaymentPlan,
  ServiceType,
} from '../enums';
import type { LiquidationExtraLine } from '../liquidation-builder';

/**
 * Reparto de una boleta de servicio o impuesto entre los contratos que la
 * comparten (puro, sin acceso a la base).
 *
 * Qué entra: la boleta (importe, período, consumo) y, de cada contrato, la regla
 * de traslado vigente en el período (quién paga, cómo se reparte, plan de pago).
 * Qué sale: las partes a cobrar al inquilino, cada una con el mes de liquidación
 * en que se cobra, y las reglas que no generan cobro (con el motivo).
 *
 * Reglas:
 * - Inquilino: paga directo al ente; no genera cobro. Si su regla es por consumo
 *   igual ocupa su parte del reparto (los demás no pagan lo que consumió).
 * - Porcentaje: `tenantSharePct` % de la boleta, redondeado al centavo (mitad
 *   hacia arriba). El resto lo absorbe quien pagó (inmobiliaria o locador).
 * - Fijo: `fixedAmount`, sin superar el importe de la boleta.
 * - Consumo: el consumo de la unidad sobre el consumo total de la boleta. Sin
 *   consumo total, las unidades se reparten toda la boleta. Si hay consumo
 *   total y las unidades suman menos, la diferencia (áreas comunes, unidades
 *   vacías) queda sin trasladar. El reparto usa el mayor resto: las partes
 *   suman exactamente la boleta.
 * - Plan Anual con recupero Prorrateado: la parte del inquilino se reparte en
 *   12 cuotas mensuales iguales (mayor resto) desde el mes de la boleta; con
 *   Unico se cobra entera en el mes de la boleta. El plan Mensual cobra en el
 *   mes de la boleta.
 * - Descuento por pago anual: si la regla lo pasa al inquilino (por defecto) se
 *   reparte el importe pagado; si no, se reparte `nominalAmount` (el importe sin
 *   descuento) y el descuento queda del lado de quien pagó.
 * - Un contrato que termina antes de la última cuota no recibe las cuotas
 *   posteriores a su último mes (`lastBillableMonth`); se avisa en `warnings`.
 */

export class InvalidChargeRuleError extends Error {
  constructor(
    readonly code: 'FIXED_AMOUNT_REQUIRED' | 'INVALID_SHARE_PCT' | 'INVALID_BILL_AMOUNT',
    message: string,
  ) {
    super(message);
    this.name = 'InvalidChargeRuleError';
  }
}

export interface ChargeBillInput {
  amount: MoneyInput;
  /** Importe sin el descuento por pago anual, si se conoce. */
  nominalAmount?: MoneyInput | null;
  /** Primer día del mes de la boleta, a medianoche UTC. */
  period: Date;
  /** Consumo total de la boleta (kWh, m3...). */
  consumption?: MoneyInput | null;
}

export interface ChargeRuleInput {
  contractId: string;
  ruleId?: string | null;
  payer: ChargePayer | `${ChargePayer}`;
  splitMode: ChargeSplitMode | `${ChargeSplitMode}`;
  tenantSharePct: MoneyInput;
  fixedAmount?: MoneyInput | null;
  paymentPlan: ServicePaymentPlan | `${ServicePaymentPlan}`;
  annualRecovery: AnnualRecovery | `${AnnualRecovery}`;
  /** Si el descuento por pago anual es para el inquilino (por defecto, sí). */
  annualDiscountToTenant?: boolean;
  /** Consumo de la unidad de este contrato en la boleta. */
  consumption?: MoneyInput | null;
  /** Primer día del último mes en que rige el contrato; sin dato, sin tope. */
  lastBillableMonth?: Date | null;
}

export interface ChargeAllocation {
  contractId: string;
  ruleId: string | null;
  payer: ChargePayer;
  /** Importe positivo con dos decimales. */
  amount: string;
  /** Primer día del mes de la liquidación en que se cobra, a medianoche UTC. */
  chargePeriod: Date;
  installmentNo: number;
  installmentsTotal: number;
  basis: string;
}

export type ChargeSkipReason = 'PaidDirectly' | 'MissingConsumption' | 'ZeroShare';

export interface ChargeSplitResult {
  allocations: ChargeAllocation[];
  skipped: { contractId: string; ruleId: string | null; reason: ChargeSkipReason }[];
  warnings: { contractId: string; code: 'AfterContractEnd'; droppedInstallments: number }[];
}

const ANNUAL_INSTALLMENTS = 12;

function addMonthsUTC(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function plain(value: Money): string {
  return value.toDecimalPlaces(3).toString();
}

export function splitBill(bill: ChargeBillInput, rules: ChargeRuleInput[]): ChargeSplitResult {
  const amount = new Money(bill.amount);
  if (!amount.isFinite() || amount.isNegative()) {
    throw new InvalidChargeRuleError('INVALID_BILL_AMOUNT', 'El importe de la boleta no puede ser negativo');
  }
  const period = new Date(Date.UTC(bill.period.getUTCFullYear(), bill.period.getUTCMonth(), 1));

  const baseOf = (rule: ChargeRuleInput): Money => {
    const annual = rule.paymentPlan === ServicePaymentPlan.Anual;
    const discountToTenant = rule.annualDiscountToTenant ?? true;
    if (annual && !discountToTenant && bill.nominalAmount != null) {
      return Money.max(new Money(bill.nominalAmount), amount);
    }
    return amount;
  };

  // Parte del inquilino de cada regla (antes de dividir en cuotas).
  const shares = new Map<number, { amount: Money; basis: string }>();
  const skipped: ChargeSplitResult['skipped'] = [];

  // Consumo: se reparte entre todas las reglas por consumo, incluidas las de pago directo.
  const consumoIdx = rules.map((r, i) => (r.splitMode === ChargeSplitMode.Consumo ? i : -1)).filter((i) => i >= 0);
  if (consumoIdx.length > 0) {
    const consumptions = consumoIdx.map((i) => rules[i].consumption);
    const known = consumptions.every((c) => c != null && new Money(c).gt(0));
    if (!known && consumoIdx.length > 1) {
      for (const i of consumoIdx) {
        if (rules[i].payer !== ChargePayer.Inquilino) {
          skipped.push({ contractId: rules[i].contractId, ruleId: rules[i].ruleId ?? null, reason: 'MissingConsumption' });
        }
      }
    } else if (!known) {
      // Una sola unidad sin consumo declarado: se lleva toda la boleta.
      const i = consumoIdx[0];
      shares.set(i, { amount: round2(baseOf(rules[i])), basis: 'Consumo: única unidad, toda la boleta' });
    } else {
      const weights = consumptions.map((c) => new Money(c as MoneyInput));
      const unitsTotal = sumMoney(weights);
      const billTotal = bill.consumption != null ? new Money(bill.consumption) : unitsTotal;
      const total = Money.max(billTotal, unitsTotal);
      const rest = total.minus(unitsTotal);
      const base = baseOf(rules[consumoIdx[0]]);
      const parts = allocateLargestRemainder(base, rest.gt(0) ? [...weights, rest] : weights);
      consumoIdx.forEach((ruleIndex, k) => {
        shares.set(ruleIndex, {
          amount: parts[k],
          basis: `Consumo: ${plain(weights[k])} de ${plain(total)}`,
        });
      });
    }
  }

  rules.forEach((rule, i) => {
    if (rule.splitMode === ChargeSplitMode.Porcentaje) {
      const pct = new Money(rule.tenantSharePct);
      if (!pct.isFinite() || pct.isNegative() || pct.gt(100)) {
        throw new InvalidChargeRuleError('INVALID_SHARE_PCT', 'El porcentaje del inquilino va de 0 a 100');
      }
      const base = baseOf(rule);
      shares.set(i, { amount: round2(base.times(pct).div(100)), basis: `${plain(pct)} % de ${base.toFixed(2)}` });
    } else if (rule.splitMode === ChargeSplitMode.Fijo) {
      if (rule.fixedAmount == null || new Money(rule.fixedAmount).isNegative()) {
        throw new InvalidChargeRuleError('FIXED_AMOUNT_REQUIRED', 'La regla de importe fijo necesita el importe');
      }
      const base = baseOf(rule);
      const fixed = round2(rule.fixedAmount);
      shares.set(i, { amount: Money.min(fixed, base), basis: `Importe fijo ${fixed.toFixed(2)}` });
    }
  });

  const allocations: ChargeAllocation[] = [];
  const warnings: ChargeSplitResult['warnings'] = [];

  rules.forEach((rule, i) => {
    if (rule.payer === ChargePayer.Inquilino) {
      skipped.push({ contractId: rule.contractId, ruleId: rule.ruleId ?? null, reason: 'PaidDirectly' });
      return;
    }
    const share = shares.get(i);
    if (!share) return; // consumo sin datos, ya informado
    if (share.amount.isZero()) {
      skipped.push({ contractId: rule.contractId, ruleId: rule.ruleId ?? null, reason: 'ZeroShare' });
      return;
    }

    const prorated =
      rule.paymentPlan === ServicePaymentPlan.Anual && rule.annualRecovery === AnnualRecovery.Prorrateado;
    const parts = prorated
      ? allocateLargestRemainder(share.amount, new Array<number>(ANNUAL_INSTALLMENTS).fill(1))
      : [share.amount];

    let dropped = 0;
    parts.forEach((part, k) => {
      const chargePeriod = addMonthsUTC(period, k);
      if (rule.lastBillableMonth && chargePeriod.getTime() > rule.lastBillableMonth.getTime()) {
        dropped += 1;
        return;
      }
      if (part.isZero()) return;
      allocations.push({
        contractId: rule.contractId,
        ruleId: rule.ruleId ?? null,
        payer: rule.payer as ChargePayer,
        amount: part.toFixed(2),
        chargePeriod,
        installmentNo: k + 1,
        installmentsTotal: parts.length,
        basis: prorated ? `${share.basis}; cuota ${k + 1}/${parts.length}` : share.basis,
      });
    });
    if (dropped > 0) warnings.push({ contractId: rule.contractId, code: 'AfterContractEnd', droppedInstallments: dropped });
  });

  return { allocations, skipped, warnings };
}

/** Datos de una parte ya calculada, lo que hace falta para armar su renglón. */
export interface ChargeLineSource {
  allocationId: string;
  payer: ChargePayer | `${ChargePayer}`;
  amount: MoneyInput;
  serviceType: ServiceType | `${ServiceType}`;
  providerName?: string | null;
  installmentLabel: string;
  installmentNo: number;
  installmentsTotal: number;
}

const SERVICE_LABEL: Record<ServiceType, string> = {
  [ServiceType.Electricidad]: 'Electricidad',
  [ServiceType.Gas]: 'Gas',
  [ServiceType.Agua]: 'Agua',
  [ServiceType.Internet]: 'Internet',
  [ServiceType.Expensas]: 'Expensas',
  [ServiceType.Municipal]: 'Tasa municipal',
  [ServiceType.ImpuestoInmobiliario]: 'Impuesto inmobiliario',
  [ServiceType.Otro]: 'Servicio',
};

/**
 * Renglón de la liquidación de una parte de boleta, que se cobra al inquilino:
 * - Inmobiliaria: la inmobiliaria paga al ente; el renglón va al ente.
 * - Propietario: el inquilino lo paga con el alquiler y pasa al locador (por
 *   cuenta y orden); el renglón va al locador.
 * Nunca es comisionable. Impuestos (municipal e inmobiliario) como `Impuesto`;
 * el resto como `Servicio`. El que paga directo no tiene renglón: no llega acá.
 */
export function chargeAllocationLine(source: ChargeLineSource): LiquidationExtraLine {
  if (source.payer === ChargePayer.Inquilino) {
    throw new Error('El inquilino que paga directo no tiene renglón en la liquidación');
  }
  const type = source.serviceType as ServiceType;
  const isTax = type === ServiceType.Municipal || type === ServiceType.ImpuestoInmobiliario;
  const label =
    type === ServiceType.Otro && source.providerName ? source.providerName : SERVICE_LABEL[type];
  const installment =
    source.installmentsTotal > 1 ? `, cuota ${source.installmentNo}/${source.installmentsTotal}` : '';
  const onBehalf = source.payer === ChargePayer.Propietario ? ' (por cuenta y orden del locador)' : '';
  return {
    type: isTax ? LineItemType.Impuesto : LineItemType.Servicio,
    description: `${label} ${source.installmentLabel}${installment}${onBehalf}`,
    amount: source.amount,
    commissionable: false,
    beneficiary: source.payer === ChargePayer.Propietario ? LineBeneficiary.Locador : LineBeneficiary.Ente,
    sourceType: 'ServiceBillAllocation',
    sourceId: source.allocationId,
  };
}
