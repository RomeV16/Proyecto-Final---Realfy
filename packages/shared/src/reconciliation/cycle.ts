import { Money, round2 } from '../money';
import {
  AdjustmentPeriod,
  AdjustmentType,
  AnnualRecovery,
  ChargePayer,
  ChargeSplitMode,
  ChargeTarget,
  CommissionType,
  ContractStatus,
  FirstDueMode,
  FixedDiscountProration,
  LineBeneficiary,
  LineItemType,
  MidMonthAdjustmentMode,
  OwnerLedgerEntryType,
  PaymentReceiver,
  PendingChargeKind,
  ProrationMode,
  ServicePaymentPlan,
  ServiceType,
} from '../enums';
import { calculateAdjustment, type AdjustmentParams } from '../adjustment-engine';
import { calculateCommission, type CommissionConfig } from '../commission-engine';
import { buildLiquidation, type BuiltLiquidation, type LiquidationExtraLine } from '../liquidation-builder';
import { chargeAllocationLines, splitBill, type ChargeRuleInput } from '../charge-split';
import { pendingChargeLine, requiresUpfront, signedChargeAmount } from '../pending-charge';
import { accruePenalty, type PenaltyRule } from '../penalty-engine';
import { compensationDefault, settlePayment, settlementBuckets, type SettlementResult } from '../settlement-engine';
import { computeStatement, paymentPostings, repairManagementFee, splitByShare } from '../owner-ledger';
import { contractConcepts, statementConcepts, statementKey, type ReconciliationResult } from './format';

/**
 * Ciclo mensual de una cartera, de punta a punta con los motores puros: el
 * mismo camino que recorre la API (ajustes, boletas, cargos, punitorios,
 * liquidación, reparto de cada cobro, cuenta corriente y estado de cuenta),
 * sin base de datos. Recibe los datos de entrada del ciclo con la forma de una
 * cartera real y devuelve el resultado en el formato de reconciliación.
 *
 * Lo que la entrada fija y el motor no decide: qué meses de índice entran en
 * cada ajuste (es la regla pactada que la API tiene que reproducir), a quién
 * se le asigna cada importe y en qué fecha ocurre cada movimiento.
 *
 * Convenciones de la inmobiliaria del ciclo: las de fábrica (prorrateo por días
 * reales, ajuste a mitad de mes desde el período siguiente, primer mes con
 * vencimiento al inicio, descuento fijo proporcional), reparto proporcional de
 * un cobro parcial, el locador que cobra debe todo lo ajeno, estado mensual sin
 * día de cierre y cargos al locador asentados al generar el estado.
 */

export type CycleCurrency = 'ARS' | 'USD';

export interface CycleAgency {
  dueDay: number;
  /** Comisión de la inmobiliaria cuando el contrato no pacta otra. */
  commissionPct: string;
  /** Umbral de anticipo de un cargo al inquilino, en comisiones mensuales. */
  upfrontThresholdFees: string;
}

export interface CycleLessor {
  key: string;
  name: string;
}

export interface CycleAdjustment {
  /** Fecha del ajuste, `YYYY-MM-DD` (rige desde ese día). */
  date: string;
  /** IPC: meses (`YYYY-MM`) cuya variación entra en el ajuste. */
  ipcMonths?: string[];
  /** ICL: fechas (`YYYY-MM-DD`) del valor inicial y final. */
  iclDates?: [string, string];
  /** Escalonado: meses transcurridos desde el inicio del tramo. */
  monthsElapsed?: number;
}

export interface CycleCommission {
  type: CommissionType;
  percentage?: string;
  fixedAmount?: string;
  /** Honorario por gestión de una reparación a cargo del locador, en %. */
  repairMgmtFeePct?: string;
}

export interface CycleContract {
  key: string;
  /** Nombre de la unidad (agrupa el estado consolidado). */
  property: string;
  currency: CycleCurrency;
  /** `YYYY-MM-DD`. */
  start: string;
  end: string;
  /** Alquiler inicial del contrato. */
  rent: string;
  adjustment: {
    type: AdjustmentType;
    period: AdjustmentPeriod;
    lagMonths: number;
    customPct?: string;
    steps?: { fromMonth: number; pct: string }[];
  };
  /** Ajustes que la regla pactada da hasta el mes del ciclo, en orden. */
  adjustments: CycleAdjustment[];
  lessors: { lessor: string; payoutPct: string }[];
  /** Comisión pactada; sin ella, el porcentaje de la inmobiliaria. */
  commission?: CycleCommission | null;
  /** `TodoLocador`: el inquilino le paga al locador. */
  paymentFlow?: 'Partido' | 'TodoLocador';
  /** Bonificación sobre el alquiler, en %. */
  discountPct?: string;
  /** Regla de punitorios del contrato. */
  penalty?: PenaltyRule;
  /** La liquidación del mes anterior se pagó entera, tarde, en esta fecha (`YYYY-MM-DD`). */
  previousPaidAt?: string;
}

export interface CycleBillRule {
  contract: string;
  payer: ChargePayer;
  splitMode?: ChargeSplitMode;
  tenantSharePct?: string;
  paymentPlan?: ServicePaymentPlan;
  annualRecovery?: AnnualRecovery;
  annualInstallments?: number;
}

export interface CycleBill {
  key: string;
  serviceType: ServiceType;
  /** Contrato en cuya unidad está el servicio. */
  property: string;
  /** Mes de la boleta, `YYYY-MM`. */
  period: string;
  amount: string;
  /** Consumo total de la boleta y el de cada unidad (reparto por consumo). */
  consumption?: string;
  units?: { contract: string; consumption: string }[];
  /** La boleta es anual (se paga una vez y se recupera en cuotas). */
  annual?: boolean;
  rules: CycleBillRule[];
  /** La pagó la inmobiliaria en esta fecha (`YYYY-MM-DD`). */
  paidByAgency?: string;
}

export interface CycleCharge {
  key: string;
  contract: string;
  chargedTo: ChargeTarget.Inquilino | ChargeTarget.Locador;
  kind: PendingChargeKind;
  description: string;
  /** Positivo; una devolución se guarda negativa. */
  amount: string;
  beneficiary: LineBeneficiary;
  /** `YYYY-MM-DD`. */
  incurredAt: string;
}

export interface CyclePayment {
  key: string;
  contract: string;
  /** `YYYY-MM-DD`. */
  date: string;
  amount: string;
  method: 'Efectivo' | 'Transferencia';
  /** Sin indicar, según el flujo de cobro del contrato. */
  receivedBy?: PaymentReceiver;
  inCustody?: boolean;
}

export interface CycleCompensation {
  payment: string;
  from: string;
  to: string;
  /** Sin importe, lo que `to` figuraba cobrando en mano. */
  amount?: string;
}

export interface CyclePayout {
  lessor: string;
  currency: CycleCurrency;
  amount: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** Transferencia desde una cuenta o entrega del efectivo en custodia. */
  kind: OwnerLedgerEntryType.Transferencia | OwnerLedgerEntryType.EntregaEfectivo;
}

export interface CycleOpeningBalance {
  lessor: string;
  currency: CycleCurrency;
  amount: string;
  date: string;
}

export interface CycleInput {
  /** Mes del ciclo, `YYYY-MM`. */
  period: string;
  agency: CycleAgency;
  /** IPC: variación mensual en % por `YYYY-MM`; ICL: nivel por `YYYY-MM-DD`; TasaActivaBNA: TNA en % desde `YYYY-MM`. */
  indexes: { IPC?: Record<string, string>; ICL?: Record<string, string>; TasaActivaBNA?: Record<string, string> };
  lessors: CycleLessor[];
  contracts: CycleContract[];
  bills: CycleBill[];
  charges: CycleCharge[];
  payments: CyclePayment[];
  compensations: CycleCompensation[];
  payouts: CyclePayout[];
  openingBalances: CycleOpeningBalance[];
}

interface LedgerEntry {
  lessor: string;
  currency: string;
  type: OwnerLedgerEntryType;
  amount: Money;
  date: Date;
  property: string;
}

const day = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
const monthStart = (period: string) => day(`${period}-01`);
const addMonths = (date: Date, months: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const CONVENTIONS = {
  prorationMode: ProrationMode.DiasReales,
  midMonthAdjustmentMode: MidMonthAdjustmentMode.DesdePeriodoSiguiente,
  firstDueMode: FirstDueMode.DiaDeInicio,
  fixedDiscountProration: FixedDiscountProration.Proporcional,
};

function indexValue(table: Record<string, string> | undefined, key: string, name: string): Money {
  const value = table?.[key];
  if (value === undefined) throw new Error(`Falta el valor de ${name} de ${key}`);
  return new Money(value);
}

/** Alquiler de cada tramo: el inicial y el que deja cada ajuste, con su fecha y porcentaje. */
function rentHistory(input: CycleInput, contract: CycleContract) {
  const steps: { from: Date; rent: Money; pct: Money | null }[] = [
    { from: day(contract.start), rent: new Money(contract.rent), pct: null },
  ];
  for (const adjustment of contract.adjustments) {
    const baseRent = steps[steps.length - 1].rent;
    const params = adjustmentParams(input, contract, adjustment, baseRent);
    const result = calculateAdjustment(params);
    steps.push({ from: day(adjustment.date), rent: new Money(result.newRent), pct: new Money(result.percentage) });
  }
  return steps;
}

function adjustmentParams(
  input: CycleInput,
  contract: CycleContract,
  adjustment: CycleAdjustment,
  baseRent: Money,
): AdjustmentParams {
  const rule = contract.adjustment;
  switch (rule.type) {
    case AdjustmentType.IPC:
      return {
        type: AdjustmentType.IPC,
        monthlyValues: (adjustment.ipcMonths ?? []).map((m) => indexValue(input.indexes.IPC, m, 'IPC')),
        baseRent,
      };
    case AdjustmentType.ICL: {
      const [from, to] = adjustment.iclDates ?? ['', ''];
      return {
        type: AdjustmentType.ICL,
        startValue: indexValue(input.indexes.ICL, from, 'ICL'),
        endValue: indexValue(input.indexes.ICL, to, 'ICL'),
        baseRent,
      };
    }
    case AdjustmentType.FixedPercent:
      return { type: AdjustmentType.FixedPercent, percentage: new Money(rule.customPct ?? '0'), baseRent };
    case AdjustmentType.Escalonado:
      return {
        type: AdjustmentType.Escalonado,
        steps: (rule.steps ?? []).map((s) => ({ fromMonth: s.fromMonth, pct: new Money(s.pct) })),
        monthsElapsed: adjustment.monthsElapsed ?? 0,
        baseRent,
      };
    default:
      throw new Error(`Modalidad de ajuste no prevista en el ciclo: ${rule.type}`);
  }
}

function rentAt(history: ReturnType<typeof rentHistory>, date: Date) {
  let current = history[0];
  for (const step of history) if (step.from.getTime() <= date.getTime()) current = step;
  return current;
}

function commissionConfig(input: CycleInput, contract: CycleContract): CommissionConfig {
  const agreed = contract.commission;
  if (!agreed) return { type: CommissionType.FixedPercent, percentage: input.agency.commissionPct };
  return { type: agreed.type, percentage: agreed.percentage ?? null, fixedAmount: agreed.fixedAmount ?? null };
}

/** Partes de una boleta (todas sus cuotas) que le tocan a un contrato. */
function allocationsOf(bill: CycleBill, contractKey: string) {
  const rules: ChargeRuleInput[] = bill.rules.map((r) => ({
    contractId: r.contract,
    ruleId: `${bill.key}:${r.contract}`,
    payer: r.payer,
    splitMode: r.splitMode ?? ChargeSplitMode.Porcentaje,
    tenantSharePct: r.tenantSharePct ?? '100',
    paymentPlan: r.paymentPlan ?? ServicePaymentPlan.Mensual,
    annualRecovery: r.annualRecovery ?? AnnualRecovery.Prorrateado,
    annualInstallments: r.annualInstallments,
    consumption: bill.units?.find((u) => u.contract === r.contract)?.consumption ?? null,
  }));
  const { allocations } = splitBill(
    { amount: bill.amount, period: monthStart(bill.period), consumption: bill.consumption ?? null },
    rules,
  );
  return allocations.filter((a) => a.contractId === contractKey);
}

/** Renglones de las boletas que se cobran al inquilino del contrato hasta el mes. */
function billLines(input: CycleInput, contract: CycleContract, period: Date): LiquidationExtraLine[] {
  const lines: LiquidationExtraLine[] = [];
  for (const bill of input.bills) {
    for (const allocation of allocationsOf(bill, contract.key)) {
      if (allocation.chargePeriod.getTime() > period.getTime()) continue;
      lines.push(
        ...chargeAllocationLines({
          allocationId: `${bill.key}:${allocation.installmentNo}`,
          payer: allocation.payer,
          amount: allocation.amount,
          serviceType: bill.serviceType,
          installmentLabel: `${bill.period.slice(5, 7)}/${bill.period.slice(0, 4)}`,
          installmentNo: allocation.installmentNo,
          installmentsTotal: allocation.installmentsTotal,
          surplus: allocation.surplus,
          surplusBeneficiary: allocation.surplusBeneficiary,
        }),
      );
    }
  }
  return lines;
}

/** Renglones de los cargos al inquilino del contrato que no piden anticipo. */
function chargeLines(input: CycleInput, contract: CycleContract, monthlyRent: Money): LiquidationExtraLine[] {
  const monthlyCommission = calculateCommission(monthlyRent, commissionConfig(input, contract)).commissionAmount;
  const lines: LiquidationExtraLine[] = [];
  for (const charge of input.charges) {
    if (charge.contract !== contract.key || charge.chargedTo !== ChargeTarget.Inquilino) continue;
    const amount = signedChargeAmount(charge.kind, charge.amount);
    if (requiresUpfront({ amount, monthlyCommission, thresholdFees: input.agency.upfrontThresholdFees })) continue;
    const line = pendingChargeLine({
      id: charge.key,
      kind: charge.kind,
      chargedTo: charge.chargedTo,
      amount,
      description: charge.description,
      beneficiary: charge.beneficiary,
    });
    if (line) lines.push(line);
  }
  return lines;
}

function build(
  input: CycleInput,
  contract: CycleContract,
  period: Date,
  monthlyRent: Money,
  extras: { serviceAllocations?: LiquidationExtraLine[]; pendingCharges?: LiquidationExtraLine[]; penalties?: LiquidationExtraLine[] },
): BuiltLiquidation {
  const built = buildLiquidation({
    period,
    currency: contract.currency,
    contract: { startDate: day(contract.start), endDate: day(contract.end), status: ContractStatus.Activo },
    rent: { monthlyAmount: monthlyRent },
    conventions: CONVENTIONS,
    terms: { dueDay: input.agency.dueDay, discountPct: contract.discountPct ?? null },
    ...extras,
  });
  if (built.skipped) throw new Error(`El contrato ${contract.key} no liquida ${monthKey(period)}: ${built.skipped}`);
  return built;
}

/** Punitorio del mes anterior pagado tarde: renglón Multa del mes del ciclo. */
function penaltyLines(
  input: CycleInput,
  contract: CycleContract,
  previous: BuiltLiquidation | null,
): LiquidationExtraLine[] {
  if (!previous || !contract.previousPaidAt || !contract.penalty) return [];
  const rates = Object.entries(input.indexes.TasaActivaBNA ?? {})
    .map(([from, annualPct]) => ({ from: monthStart(from), annualPct }))
    .sort((a, b) => a.from.getTime() - b.from.getTime());
  const accrued = accruePenalty({
    dueDate: previous.dueDate,
    asOf: day(contract.previousPaidAt),
    total: previous.total,
    payments: [],
    rule: contract.penalty,
    bnaRates: rates,
  });
  if (!accrued.amount.gt(0)) return [];
  return [
    {
      type: LineItemType.Multa,
      description: `Punitorios por mora (${accrued.daysOverdue} días)`,
      amount: accrued.amount.toFixed(2),
      commissionable: true,
      beneficiary: LineBeneficiary.Locador,
    },
  ];
}

function settle(
  input: CycleInput,
  contract: CycleContract,
  built: BuiltLiquidation,
  payment: { amount: string; receivedBy?: PaymentReceiver; inCustody?: boolean },
  paidBefore: Money,
): SettlementResult {
  const receivedBy =
    payment.receivedBy ??
    (contract.paymentFlow === 'TodoLocador' && !payment.inCustody ? PaymentReceiver.Locador : PaymentReceiver.Inmobiliaria);
  return settlePayment({
    currency: contract.currency,
    lines: built.lines,
    commission: commissionConfig(input, contract),
    lessors: contract.lessors.map((l) => ({ personId: l.lessor, payoutPct: l.payoutPct })),
    paidBefore,
    amount: payment.amount,
    receivedBy,
    inCustody: !!payment.inCustody,
  });
}

function postings(contract: CycleContract, built: BuiltLiquidation, settlement: SettlementResult, date: Date): LedgerEntry[] {
  return paymentPostings({ flow: settlement.flow, lines: built.lines, buckets: settlement.buckets, positions: settlement.positions }).map(
    (p) => ({ lessor: p.personId, currency: contract.currency, type: p.type, amount: p.amount, date, property: contract.property }),
  );
}

function bearers(contract: CycleContract) {
  return contract.lessors.map((l) => ({ personId: l.lessor, pct: l.payoutPct }));
}

/** Corre el ciclo y devuelve su resultado en el formato de reconciliación. */
export function runCycle(input: CycleInput): ReconciliationResult {
  const period = monthStart(input.period);
  const previousPeriod = addMonths(period, -1);
  const byKey = new Map(input.contracts.map((c) => [c.key, c]));
  const contractOf = (key: string) => {
    const found = byKey.get(key);
    if (!found) throw new Error(`Contrato desconocido: ${key}`);
    return found;
  };

  const ledger: LedgerEntry[] = [];
  const settlements = new Map<string, SettlementResult>();
  const contracts: ReconciliationResult['contracts'] = {};

  for (const contract of input.contracts) {
    const history = rentHistory(input, contract);
    const current = rentAt(history, period);

    // Mes anterior: solo hace falta si se pagó tarde (origen del punitorio y asientos de ese mes).
    let previous: BuiltLiquidation | null = null;
    if (contract.previousPaidAt) {
      previous = build(input, contract, previousPeriod, rentAt(history, previousPeriod).rent, {});
      const settlement = settle(input, contract, previous, { amount: previous.total }, new Money(0));
      ledger.push(...postings(contract, previous, settlement, day(contract.previousPaidAt)));
    }

    const built = build(input, contract, period, current.rent, {
      serviceAllocations: billLines(input, contract, period),
      pendingCharges: chargeLines(input, contract, current.rent),
      penalties: penaltyLines(input, contract, previous),
    });

    const shares: { amount: string; shares: { lessor: string; share: Money }[] }[] = [];
    let paid = new Money(0);
    const payments = input.payments
      .filter((p) => p.contract === contract.key)
      .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
    for (const payment of payments) {
      const settlement = settle(input, contract, built, payment, paid);
      settlements.set(payment.key, settlement);
      ledger.push(...postings(contract, built, settlement, day(payment.date)));
      shares.push({ amount: payment.amount, shares: settlement.positions.map((p) => ({ lessor: p.personId, share: p.share })) });
      paid = paid.plus(round2(payment.amount));
    }

    const buckets = settlementBuckets(built.lines, commissionConfig(input, contract), contract.currency);
    const adjustedThisMonth = current.pct !== null && monthKey(current.from) === input.period;
    contracts[contract.key] = contractConcepts({
      lines: built.lines,
      total: built.total,
      rent: { monthly: current.rent, adjustmentPct: adjustedThisMonth ? current.pct : null },
      buckets,
      payments: shares,
    });
  }

  // Compensaciones: quien cobró responde por lo que el compensado figuraba teniendo en mano.
  for (const compensation of input.compensations) {
    const payment = input.payments.find((p) => p.key === compensation.payment);
    const settlement = settlements.get(compensation.payment);
    if (!payment || !settlement) throw new Error(`Cobro desconocido: ${compensation.payment}`);
    const position = settlement.positions.find((p) => p.personId === compensation.to);
    if (!position) throw new Error(`${compensation.to} no tiene parte en el cobro ${compensation.payment}`);
    const amount = compensation.amount ? round2(compensation.amount) : compensationDefault(position);
    const contract = contractOf(payment.contract);
    const date = day(payment.date);
    const common = { currency: contract.currency, type: OwnerLedgerEntryType.Compensacion, date, property: contract.property };
    ledger.push({ ...common, lessor: compensation.from, amount: amount.negated() }, { ...common, lessor: compensation.to, amount });
  }

  // Boletas que pagó la inmobiliaria con traslado «Propietario»: el locador le debe la parte del contrato.
  for (const bill of input.bills.filter((b) => b.paidByAgency)) {
    for (const rule of bill.rules.filter((r) => r.payer === ChargePayer.Propietario)) {
      const contract = contractOf(rule.contract);
      const owed = allocationsOf(bill, contract.key)
        .filter((a) => a.payer === ChargePayer.Propietario)
        .reduce((acc, a) => acc.plus(a.amount), new Money(0));
      for (const part of splitByShare(owed.negated(), bearers(contract))) {
        ledger.push({
          lessor: part.personId,
          currency: contract.currency,
          type: OwnerLedgerEntryType.PagoEnte,
          amount: part.amount,
          date: day(bill.paidByAgency as string),
          property: contract.property,
        });
      }
    }
  }

  // Cargos al locador: el cargo y, si es una reparación con honorario pactado, el honorario.
  for (const charge of input.charges.filter((c) => c.chargedTo === ChargeTarget.Locador)) {
    const contract = contractOf(charge.contract);
    const common = { currency: contract.currency, date: day(charge.incurredAt), property: contract.property };
    const amount = new Money(signedChargeAmount(charge.kind, charge.amount));
    for (const part of splitByShare(amount.negated(), bearers(contract))) {
      ledger.push({ ...common, lessor: part.personId, type: OwnerLedgerEntryType.Cargo, amount: part.amount });
    }
    const pct = contract.commission?.repairMgmtFeePct;
    if (charge.kind === PendingChargeKind.Reparacion && amount.gt(0) && pct != null) {
      for (const part of splitByShare(repairManagementFee(amount, pct).negated(), bearers(contract))) {
        ledger.push({ ...common, lessor: part.personId, type: OwnerLedgerEntryType.Honorario, amount: part.amount });
      }
    }
  }

  for (const payout of input.payouts) {
    ledger.push({
      lessor: payout.lessor,
      currency: payout.currency,
      type: payout.kind,
      amount: round2(payout.amount).negated(),
      date: day(payout.date),
      property: '',
    });
  }
  for (const opening of input.openingBalances) {
    ledger.push({
      lessor: opening.lessor,
      currency: opening.currency,
      type: OwnerLedgerEntryType.SaldoInicial,
      amount: round2(opening.amount),
      date: day(opening.date),
      property: '',
    });
  }

  return { period: input.period, contracts, statements: statements(ledger, period) };
}

/**
 * Estado de cuenta del mes de cada locador y moneda: el del mes anterior (si
 * tuvo movimientos) se cierra y su saldo abre el del ciclo.
 */
function statements(ledger: LedgerEntry[], period: Date): ReconciliationResult['statements'] {
  const next = addMonths(period, 1).getTime();
  const out: ReconciliationResult['statements'] = {};
  const keys = [...new Set(ledger.map((e) => statementKey(e.lessor, e.currency)))].sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const mine = ledger.filter((e) => statementKey(e.lessor, e.currency) === key && e.date.getTime() < next);
    const toEntry = (e: LedgerEntry) => ({ type: e.type, amount: e.amount, date: e.date, propertyId: e.property || null, groupLabel: e.property || null });
    const before = mine.filter((e) => e.date.getTime() < period.getTime()).map(toEntry);
    const previousClosing = before.length > 0 ? computeStatement({ entries: before }).closing : new Money(0);
    const current = computeStatement({
      previousClosing,
      entries: mine.filter((e) => e.date.getTime() >= period.getTime()).map(toEntry),
    });
    out[key] = statementConcepts(current);
  }
  return out;
}

