import { Money, allocateLargestRemainder, round2, sumMoney, type MoneyInput } from '../money';
import {
  AnnualDiscountBeneficiary,
  AnnualRecovery,
  ChargePayer,
  ChargeSplitMode,
  LineBeneficiary,
  LineItemType,
  RemainingInstallmentsOnEnd,
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
 *   suman exactamente la boleta. Una unidad con consumo 0 declarado no paga; si
 *   todo el consumo es 0 no hay con qué repartir y se informa `MissingConsumption`.
 * - Plan Anual con recupero Prorrateado: la parte del inquilino se reparte en
 *   `annualInstallments` cuotas mensuales iguales (de 1 a 12, por defecto 12;
 *   mayor resto) desde el mes de la boleta; con Unico se cobra entera en el mes
 *   de la boleta. El plan Mensual cobra en el mes de la boleta.
 * - Descuento por pago anual (`annualDiscountBeneficiary`): con Inquilino (por
 *   defecto) se reparte el importe pagado. Con Locador o Inmobiliaria se reparte
 *   `nominalAmount` (el importe sin descuento): el inquilino paga lo mismo que
 *   sin descuento y la diferencia con lo que habría pagado de más (`surplus`) es
 *   de ese beneficiario, en un renglón aparte.
 * - Un contrato que termina antes de la última cuota (`lastBillableMonth`):
 *   con `CobrarEnLiquidacionFinal` (por defecto) las cuotas que quedan se suman
 *   a la cuota del último mes del contrato; con `Descartar` no se cobran. En los
 *   dos casos se avisa en `warnings`.
 */

export class InvalidChargeRuleError extends Error {
  constructor(
    readonly code: 'FIXED_AMOUNT_REQUIRED' | 'INVALID_SHARE_PCT' | 'INVALID_BILL_AMOUNT' | 'INVALID_INSTALLMENTS',
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
  /** Cantidad de cuotas del recupero prorrateado de una boleta anual (1 a 12; por defecto 12). */
  annualInstallments?: number;
  /** A quién va el descuento por pago anual (por defecto, el inquilino). */
  annualDiscountBeneficiary?: AnnualDiscountBeneficiary | `${AnnualDiscountBeneficiary}`;
  /** Qué se hace con las cuotas que quedan al terminar el contrato (por defecto, cobrarlas en la liquidación final). */
  remainingInstallmentsOnEnd?: RemainingInstallmentsOnEnd | `${RemainingInstallmentsOnEnd}`;
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
  /** Parte de `amount` que es la diferencia por el descuento anual (va al beneficiario, no al ente). */
  surplus: string;
  surplusBeneficiary: 'Locador' | 'Inmobiliaria' | null;
}

export type ChargeSkipReason = 'PaidDirectly' | 'MissingConsumption' | 'ZeroShare';

export interface ChargeSplitResult {
  allocations: ChargeAllocation[];
  skipped: { contractId: string; ruleId: string | null; reason: ChargeSkipReason }[];
  warnings: (
    | { contractId: string; code: 'AfterContractEnd'; droppedInstallments: number }
    | { contractId: string; code: 'CollectedInFinalLiquidation'; collectedInstallments: number }
  )[];
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

  for (const rule of rules) {
    const n = rule.annualInstallments ?? ANNUAL_INSTALLMENTS;
    if (!Number.isInteger(n) || n < 1 || n > ANNUAL_INSTALLMENTS) {
      throw new InvalidChargeRuleError('INVALID_INSTALLMENTS', 'Las cuotas anuales van de 1 a 12');
    }
  }

  const nominal = bill.nominalAmount != null ? Money.max(new Money(bill.nominalAmount), amount) : amount;
  const beneficiaryOf = (rule: ChargeRuleInput) =>
    rule.annualDiscountBeneficiary ?? AnnualDiscountBeneficiary.Inquilino;
  /** La regla cobra el importe sin descuento y deja la diferencia a otro beneficiario. */
  const chargesNominal = (rule: ChargeRuleInput) =>
    rule.paymentPlan === ServicePaymentPlan.Anual &&
    beneficiaryOf(rule) !== AnnualDiscountBeneficiary.Inquilino &&
    nominal.gt(amount);

  const skipped: ChargeSplitResult['skipped'] = [];

  /** Parte del inquilino de cada regla (antes de dividir en cuotas) sobre el importe pagado o el nominal. */
  function computeShares(useNominal: boolean, report: boolean) {
    const baseOf = (rule: ChargeRuleInput): Money => (useNominal && chargesNominal(rule) ? nominal : amount);
    const shares = new Map<number, { amount: Money; basis: string }>();

    // Consumo: se reparte entre todas las reglas por consumo, incluidas las de pago directo.
    const consumoIdx = rules.map((r, i) => (r.splitMode === ChargeSplitMode.Consumo ? i : -1)).filter((i) => i >= 0);
    if (consumoIdx.length > 0) {
      const consumptions = consumoIdx.map((i) => rules[i].consumption);
      // Un 0 declarado es un dato (unidad vacía, paga 0); lo que falta es el dato.
      const known = consumptions.every((c) => c != null && new Money(c).gte(0));
      const weightsOf = () => consumptions.map((c) => new Money(c as MoneyInput));
      const noConsumption =
        known && sumMoney(weightsOf()).isZero() && !(bill.consumption != null && new Money(bill.consumption).gt(0));
      if ((!known && consumoIdx.length > 1) || noConsumption) {
        if (report) {
          for (const i of consumoIdx) {
            if (rules[i].payer !== ChargePayer.Inquilino) {
              skipped.push({ contractId: rules[i].contractId, ruleId: rules[i].ruleId ?? null, reason: 'MissingConsumption' });
            }
          }
        }
      } else if (!known) {
        // Una sola unidad sin consumo declarado: se lleva toda la boleta.
        const i = consumoIdx[0];
        shares.set(i, { amount: round2(baseOf(rules[i])), basis: 'Consumo: única unidad, toda la boleta' });
      } else {
        const weights = weightsOf();
        const unitsTotal = sumMoney(weights);
        const billTotal = bill.consumption != null ? new Money(bill.consumption) : unitsTotal;
        const total = Money.max(billTotal, unitsTotal);
        const rest = total.minus(unitsTotal);
        const parts = allocateLargestRemainder(baseOf(rules[consumoIdx[0]]), rest.gt(0) ? [...weights, rest] : weights);
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
        const fixed = round2(rule.fixedAmount);
        shares.set(i, { amount: Money.min(fixed, baseOf(rule)), basis: `Importe fijo ${fixed.toFixed(2)}` });
      }
    });
    return shares;
  }

  const paidShares = computeShares(false, true);
  const nominalShares = computeShares(true, false);

  const allocations: ChargeAllocation[] = [];
  const warnings: ChargeSplitResult['warnings'] = [];

  rules.forEach((rule, i) => {
    if (rule.payer === ChargePayer.Inquilino) {
      skipped.push({ contractId: rule.contractId, ruleId: rule.ruleId ?? null, reason: 'PaidDirectly' });
      return;
    }
    const paid = paidShares.get(i);
    if (!paid) return; // consumo sin datos, ya informado
    // Con descuento para otro beneficiario se cobra el nominal; la diferencia con lo pagado es suya.
    const charged = chargesNominal(rule) ? (nominalShares.get(i) ?? paid) : paid;
    if (charged.amount.isZero()) {
      skipped.push({ contractId: rule.contractId, ruleId: rule.ruleId ?? null, reason: 'ZeroShare' });
      return;
    }
    const surplusTotal = charged.amount.minus(paid.amount);
    const surplusBeneficiary = surplusTotal.gt(0)
      ? (beneficiaryOf(rule) as 'Locador' | 'Inmobiliaria')
      : null;

    const prorated =
      rule.paymentPlan === ServicePaymentPlan.Anual && rule.annualRecovery === AnnualRecovery.Prorrateado;
    const count = prorated ? (rule.annualInstallments ?? ANNUAL_INSTALLMENTS) : 1;
    const equal = new Array<number>(count).fill(1);
    const chargedParts = prorated ? allocateLargestRemainder(charged.amount, equal) : [charged.amount];
    const paidParts = prorated ? allocateLargestRemainder(paid.amount, equal) : [paid.amount];
    const surplusParts = chargedParts.map((c, k) => c.minus(paidParts[k]));

    // Cuotas posteriores al último mes del contrato: se suman a la última cuota que rige o se descartan.
    const last = rule.lastBillableMonth;
    const kept = chargedParts.map((_, k) => !last || addMonthsUTC(period, k).getTime() <= last.getTime());
    const lastKept = kept.lastIndexOf(true);
    const lateCount = kept.filter((k) => !k).length;
    const collect =
      lateCount > 0 &&
      lastKept >= 0 &&
      (rule.remainingInstallmentsOnEnd ?? RemainingInstallmentsOnEnd.CobrarEnLiquidacionFinal) ===
        RemainingInstallmentsOnEnd.CobrarEnLiquidacionFinal;
    const amounts = [...chargedParts];
    const surpluses = [...surplusParts];
    if (collect) {
      kept.forEach((isKept, k) => {
        if (isKept) return;
        amounts[lastKept] = amounts[lastKept].plus(chargedParts[k]);
        surpluses[lastKept] = surpluses[lastKept].plus(surplusParts[k]);
      });
    }

    amounts.forEach((part, k) => {
      if (!kept[k] || part.isZero()) return;
      const closing = collect && k === lastKept;
      const note = prorated ? `; cuota ${k + 1}/${count}` : '';
      allocations.push({
        contractId: rule.contractId,
        ruleId: rule.ruleId ?? null,
        payer: rule.payer as ChargePayer,
        amount: part.toFixed(2),
        chargePeriod: addMonthsUTC(period, k),
        installmentNo: k + 1,
        installmentsTotal: count,
        basis: `${charged.basis}${note}${closing ? `; incluye ${lateCount} cuota${lateCount === 1 ? '' : 's'} restante${lateCount === 1 ? '' : 's'} al terminar el contrato` : ''}`,
        surplus: surpluses[k].toFixed(2),
        surplusBeneficiary,
      });
    });
    if (lateCount > 0) {
      warnings.push(
        collect
          ? { contractId: rule.contractId, code: 'CollectedInFinalLiquidation', collectedInstallments: lateCount }
          : { contractId: rule.contractId, code: 'AfterContractEnd', droppedInstallments: lateCount },
      );
    }
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
  /** Parte de `amount` que es la diferencia por el descuento anual (cero si no hay). */
  surplus?: MoneyInput;
  surplusBeneficiary?: 'Locador' | 'Inmobiliaria' | null;
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

/**
 * Renglones de una parte: el del servicio o impuesto (por lo pagado al ente o al
 * locador) y, si el descuento por pago anual es de otro beneficiario, un renglón
 * `Cargo` con la diferencia a nombre del locador o de la inmobiliaria, sin comisión.
 */
export function chargeAllocationLines(source: ChargeLineSource): LiquidationExtraLine[] {
  const surplus = new Money(source.surplus ?? 0);
  const base = chargeAllocationLine({ ...source, amount: new Money(source.amount).minus(surplus) });
  if (!surplus.gt(0) || !source.surplusBeneficiary) return [{ ...base, amount: source.amount }];
  const type = source.serviceType as ServiceType;
  const label =
    type === ServiceType.Otro && source.providerName ? source.providerName : SERVICE_LABEL[type];
  const installment =
    source.installmentsTotal > 1 ? `, cuota ${source.installmentNo}/${source.installmentsTotal}` : '';
  const difference: LiquidationExtraLine = {
    type: LineItemType.Cargo,
    description: `Diferencia por pago anual de ${label} ${source.installmentLabel}${installment}`,
    amount: surplus.toFixed(2),
    commissionable: false,
    beneficiary:
      source.surplusBeneficiary === 'Locador' ? LineBeneficiary.Locador : LineBeneficiary.Inmobiliaria,
    sourceType: 'ServiceBillAllocationSurplus',
    sourceId: source.allocationId,
  };
  return new Money(source.amount).minus(surplus).gt(0) ? [base, difference] : [difference];
}
