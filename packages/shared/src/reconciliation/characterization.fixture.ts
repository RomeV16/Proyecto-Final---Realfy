import {
  AdjustmentPeriod,
  AdjustmentType,
  AnnualRecovery,
  ChargePayer,
  ChargeSplitMode,
  ChargeTarget,
  CommissionType,
  LineBeneficiary,
  OwnerLedgerEntryType,
  PaymentReceiver,
  PendingChargeKind,
  ServicePaymentPlan,
  ServiceType,
} from '../enums';
import type { CycleInput } from './cycle';
import type { ReconciliationResult } from './format';

/**
 * Caso de caracterización de la reconciliación (CP-663 a CP-667): un ciclo
 * mensual sintético, julio de 2026, con la forma de la cartera real de una
 * inmobiliaria (recibo al inquilino, comisión y neto por contrato; estado de
 * cuenta consolidado por locador). Ningún dato sale de la cartera real: los
 * nombres, unidades, importes, fechas y porcentajes son inventados.
 *
 * Cómo se derivó cada esperado (a mano, con aritmética decimal exacta y
 * redondeo al centavo mitad hacia arriba; no con los motores de Realfy):
 *
 * Ajustes (alquiler del mes):
 * - C01, IPC trimestral con rezago 2: abril usa enero y febrero (primer ajuste:
 *   la ventana empieza en el inicio del contrato, ADR-0011): 400000 x 1,022 x
 *   1,024 = 418611,20. Julio usa marzo, abril y mayo (los tres meses que
 *   terminan dos antes): 418611,20 x 1,031 x 1,027 x 1,019 = 418611,20 x
 *   1,078954903 = 451662,61; 7,8955 %. El IPC de junio está cargado y no entra.
 * - C02, ICL anual sin rezago: 250000 x 29,0217 / 18,4523 = 393198,95;
 *   57,2796 %. El valor del 2 de julio está cargado y no entra.
 * - C03, fijo 10 % semestral: 300000 x 1,10 = 330000.
 * - C05, escalonado semestral (15 % desde el mes 6 y 25 % desde el mes 12, sobre
 *   el alquiler vigente): 180000 x 1,15 = 207000 en enero; 207000 x 1,25 = 258750.
 * - C04, C06 a C11 no ajustan en julio.
 *
 * Renglones del recibo:
 * - Boletas. C01: tasa municipal 18450,37 que paga el locador (traslado
 *   «Propietario», 100 %), renglón a favor del locador; el agua la paga el
 *   inquilino directo (sin renglón). C04: impuesto inmobiliario anual 61234,57
 *   que paga la inmobiliaria, en 10 cuotas iguales por mayor resto: 6123,457 ->
 *   siete cuotas de 6123,46 y tres de 6123,45; la de julio es la 1, 6123,46. C05
 *   y C04 comparten el agua de 15000 por consumo (50 m3: 18 de C05, 22 de C04 y
 *   10 sin trasladar): 5400 / 6600 / 3000; C05 la paga el locador (5400, a su
 *   favor) y C04 la paga el inquilino directo. C07: tasa municipal 9876,54 que
 *   paga la inmobiliaria (renglón al ente).
 * - Cargos. C03: devolución de 12000 al inquilino (descuento sin comisión) y una
 *   reparación de 80000 que supera el umbral de anticipo (2 comisiones de 23100)
 *   y no entra en la liquidación. C08: reparación de 15500 que adelantó la
 *   inmobiliaria (renglón a su favor, sin comisión). C01: reparación de 48000 a
 *   cargo del locador, con 10 % de honorario por gestión (4800).
 * - C04: bonificación del 5 %: 26000 (resta y baja la base de la comisión).
 * - C10: punitorio de la liquidación de junio (200000, vence el 10/06) pagada el
 *   25/06: 15 días (11 al 25) al mayor entre 2 x TNA BNA / 365 = 2 x 54,75 % /
 *   365 = 0,3 % diario y el piso de 0,2 %: 200000 x 0,003 x 15 = 9000; tope 100 %.
 * - C11: empieza el 15/07: 17 de 31 días de 330000 = 180967,74; vence el 15/07.
 *
 * Comisión y neto (sobre la liquidación completa): comisión = porcentaje x
 * (renglones con comisión: alquiler, bonificación y punitorio), al centavo; neto
 * de los locadores = renglones a su favor - descuentos a su cargo - comisión;
 * su reparto entre locadores, por mayor resto según el porcentaje de cobro.
 * - C01 7 % de 451662,61 = 31616,38; neto 451662,61 + 18450,37 - 31616,38 = 438496,60.
 * - C02 5 % pactado de 393198,95 = 19659,95; neto 373539,00: 60 % 224123,40 y 40 % 149415,60.
 * - C03 7 % de 330000 = 23100; neto 330000 - 12000 - 23100 = 294900.
 * - C04 7 % de (520000 - 26000) = 34580; neto 494000 - 34580 = 459420 (70/30).
 *   Cobro parcial de 300000 repartido en proporción a inmobiliaria 34580, ente
 *   6123,46 y locadores 459420: 20742,88 / 3673,17 / 275583,95; a los locadores
 *   192908,77 y 82675,18 (70/30, mayor resto).
 * - C05 7 % de 258750 = 18112,50; neto 258750 + 5400 - 18112,50 = 246037,50.
 * - C06 USD: 7 % de 650 = 45,50; neto 604,50.
 * - C07 7 % de 610000 = 42700; neto 567300.
 * - C08 comisión fija pactada 20000; neto 350000 - 20000 = 330000.
 * - C09 7 % de 275000 = 19250; neto 255750.
 * - C10 7 % de 209000 = 14630; neto 194370.
 * - C11 7 % de 180967,74 = 12667,74; neto 168300.
 *
 * Estados de cuenta de julio (apertura + créditos - débitos - pagos = cierre):
 * - L1, tres unidades (C01, C03, C05): saldo inicial de -35000 cargado en junio
 *   (estado de junio emitido) abre julio. Créditos: 451662,61 + 18450,37 +
 *   (330000 - 12000) + 258750 + 5400 = 1052262,98. Débitos: comisiones 31616,38
 *   + 23100 + 18112,50; la boleta de C01 que pagó la inmobiliaria 18450,37; la
 *   reparación 48000 y su honorario 4800 = 144079,25. Transferencia de 300000.
 *   Cierre 573183,73.
 * - L2 y L3, locadores de C02 (60/40) y de C04 (70/30, el cobro parcial); sus
 *   porcentajes de cobro no son los de su titularidad (50/50). Cada cobro deja el
 *   alquiler bruto y la comisión en la proporción de su parte: L2 235919,37 -
 *   11795,97 (C02) y 207428,78 - 14520,01 (C04); L3 157279,58 - 7863,98 y
 *   88898,04 - 6222,86.
 * - L4, USD en custodia: 650 - 45,50 y entrega de 300 en efectivo: 304,50.
 * - L5, el inquilino le paga directo: alquiler 610000, comisión 42700 y cobrado en
 *   mano 619876,54 (alquiler y la tasa que debe pagar la inmobiliaria): debe 52576,54.
 * - L6 y L7: el inquilino de C09 le transfirió a L6 (locador de C08). El cobro
 *   figuraba recibido por L7 (275000 en mano y 19250 de comisión que debe); la
 *   compensación pasa esos 275000 a L6 (DEF-71): L6 350000 - 20000 - 275000 =
 *   55000; L7 275000 + 275000 - 19250 - 275000 = 255750.
 * - L8: junio cerró en 200000 - 14000 = 186000 (emitido); julio: alquiler 200000,
 *   punitorio 9000, comisión 14630 y la transferencia de los 186000: 194370.
 * - L9: 180967,74 - 12667,74 = 168300.
 */
export const RECONCILIATION_CYCLE: CycleInput = {
  period: '2026-07',
  agency: { dueDay: 10, commissionPct: '7', upfrontThresholdFees: '2' },
  indexes: {
    IPC: { '2026-01': '2.2', '2026-02': '2.4', '2026-03': '3.1', '2026-04': '2.7', '2026-05': '1.9', '2026-06': '2.1' },
    ICL: { '2025-07-01': '18.4523', '2026-07-01': '29.0217', '2026-07-02': '29.0544' },
    TasaActivaBNA: { '2026-06': '54.75' },
  },
  lessors: [
    { key: 'L1', name: 'Locador Uno' },
    { key: 'L2', name: 'Locador Dos' },
    { key: 'L3', name: 'Locador Tres' },
    { key: 'L4', name: 'Locador Cuatro' },
    { key: 'L5', name: 'Locador Cinco' },
    { key: 'L6', name: 'Locador Seis' },
    { key: 'L7', name: 'Locador Siete' },
    { key: 'L8', name: 'Locador Ocho' },
    { key: 'L9', name: 'Locador Nueve' },
  ],
  contracts: [
    {
      key: 'C01',
      property: 'Unidad 01',
      currency: 'ARS',
      start: '2026-01-01',
      end: '2028-12-31',
      rent: '400000.00',
      adjustment: { type: AdjustmentType.IPC, period: AdjustmentPeriod.Trimestral, lagMonths: 2 },
      adjustments: [
        { date: '2026-04-01', ipcMonths: ['2026-01', '2026-02'] },
        { date: '2026-07-01', ipcMonths: ['2026-03', '2026-04', '2026-05'] },
      ],
      lessors: [{ lessor: 'L1', payoutPct: '100' }],
      commission: { type: CommissionType.FixedPercent, percentage: '7', repairMgmtFeePct: '10' },
    },
    {
      key: 'C02',
      property: 'Unidad 02',
      currency: 'ARS',
      start: '2025-07-01',
      end: '2027-06-30',
      rent: '250000.00',
      adjustment: { type: AdjustmentType.ICL, period: AdjustmentPeriod.Anual, lagMonths: 0 },
      adjustments: [{ date: '2026-07-01', iclDates: ['2025-07-01', '2026-07-01'] }],
      lessors: [
        { lessor: 'L2', payoutPct: '60' },
        { lessor: 'L3', payoutPct: '40' },
      ],
      commission: { type: CommissionType.FixedPercent, percentage: '5' },
    },
    {
      key: 'C03',
      property: 'Unidad 03',
      currency: 'ARS',
      start: '2026-01-01',
      end: '2028-12-31',
      rent: '300000.00',
      adjustment: { type: AdjustmentType.FixedPercent, period: AdjustmentPeriod.Semestral, lagMonths: 2, customPct: '10' },
      adjustments: [{ date: '2026-07-01' }],
      lessors: [{ lessor: 'L1', payoutPct: '100' }],
    },
    {
      key: 'C04',
      property: 'Unidad 04',
      currency: 'ARS',
      start: '2026-05-01',
      end: '2029-04-30',
      rent: '520000.00',
      adjustment: { type: AdjustmentType.IPC, period: AdjustmentPeriod.Cuatrimestral, lagMonths: 2 },
      adjustments: [],
      lessors: [
        { lessor: 'L2', payoutPct: '70' },
        { lessor: 'L3', payoutPct: '30' },
      ],
      discountPct: '5',
    },
    {
      key: 'C05',
      property: 'Unidad 05',
      currency: 'ARS',
      start: '2025-07-01',
      end: '2027-06-30',
      rent: '180000.00',
      adjustment: {
        type: AdjustmentType.Escalonado,
        period: AdjustmentPeriod.Semestral,
        lagMonths: 2,
        steps: [
          { fromMonth: 6, pct: '15' },
          { fromMonth: 12, pct: '25' },
        ],
      },
      adjustments: [
        { date: '2026-01-01', monthsElapsed: 6 },
        { date: '2026-07-01', monthsElapsed: 12 },
      ],
      lessors: [{ lessor: 'L1', payoutPct: '100' }],
    },
    {
      key: 'C06',
      property: 'Unidad 06',
      currency: 'USD',
      start: '2026-02-01',
      end: '2028-01-31',
      rent: '650.00',
      adjustment: { type: AdjustmentType.FixedPercent, period: AdjustmentPeriod.Anual, lagMonths: 2, customPct: '3' },
      adjustments: [],
      lessors: [{ lessor: 'L4', payoutPct: '100' }],
    },
    {
      key: 'C07',
      property: 'Unidad 07',
      currency: 'ARS',
      start: '2026-04-01',
      end: '2029-03-31',
      rent: '610000.00',
      adjustment: { type: AdjustmentType.FixedPercent, period: AdjustmentPeriod.Semestral, lagMonths: 2, customPct: '12' },
      adjustments: [],
      lessors: [{ lessor: 'L5', payoutPct: '100' }],
      paymentFlow: 'TodoLocador',
    },
    {
      key: 'C08',
      property: 'Unidad 08',
      currency: 'ARS',
      start: '2026-01-01',
      end: '2028-12-31',
      rent: '350000.00',
      adjustment: { type: AdjustmentType.FixedPercent, period: AdjustmentPeriod.Anual, lagMonths: 2, customPct: '30' },
      adjustments: [],
      lessors: [{ lessor: 'L6', payoutPct: '100' }],
      commission: { type: CommissionType.FixedAmount, fixedAmount: '20000' },
    },
    {
      key: 'C09',
      property: 'Unidad 09',
      currency: 'ARS',
      start: '2026-02-01',
      end: '2029-01-31',
      rent: '275000.00',
      adjustment: { type: AdjustmentType.FixedPercent, period: AdjustmentPeriod.Semestral, lagMonths: 2, customPct: '8' },
      adjustments: [],
      lessors: [{ lessor: 'L7', payoutPct: '100' }],
    },
    {
      key: 'C10',
      property: 'Unidad 10',
      currency: 'ARS',
      start: '2026-01-01',
      end: '2028-12-31',
      rent: '200000.00',
      adjustment: { type: AdjustmentType.FixedPercent, period: AdjustmentPeriod.Anual, lagMonths: 2, customPct: '20' },
      adjustments: [],
      lessors: [{ lessor: 'L8', payoutPct: '100' }],
      penalty: { mode: 'max_bna_or_daily', value: '0.002', graceDays: 0, maxMultiplier: '2', bnaMultiplier: '2', yearDays: 365 },
      previousPaidAt: '2026-06-25',
    },
    {
      key: 'C11',
      property: 'Unidad 11',
      currency: 'ARS',
      start: '2026-07-15',
      end: '2029-07-14',
      rent: '330000.00',
      adjustment: { type: AdjustmentType.FixedPercent, period: AdjustmentPeriod.Semestral, lagMonths: 2, customPct: '9' },
      adjustments: [],
      lessors: [{ lessor: 'L9', payoutPct: '100' }],
    },
  ],
  bills: [
    {
      key: 'B01',
      serviceType: ServiceType.Municipal,
      property: 'C01',
      period: '2026-07',
      amount: '18450.37',
      rules: [{ contract: 'C01', payer: ChargePayer.Propietario }],
      paidByAgency: '2026-07-08',
    },
    {
      key: 'B02',
      serviceType: ServiceType.Agua,
      property: 'C01',
      period: '2026-07',
      amount: '9000.00',
      rules: [{ contract: 'C01', payer: ChargePayer.Inquilino }],
    },
    {
      key: 'B03',
      serviceType: ServiceType.ImpuestoInmobiliario,
      property: 'C04',
      period: '2026-07',
      amount: '61234.57',
      annual: true,
      rules: [
        {
          contract: 'C04',
          payer: ChargePayer.Inmobiliaria,
          paymentPlan: ServicePaymentPlan.Anual,
          annualRecovery: AnnualRecovery.Prorrateado,
          annualInstallments: 10,
        },
      ],
    },
    {
      key: 'B04',
      serviceType: ServiceType.Agua,
      property: 'C05',
      period: '2026-07',
      amount: '15000.00',
      consumption: '50',
      units: [
        { contract: 'C05', consumption: '18' },
        { contract: 'C04', consumption: '22' },
      ],
      rules: [
        { contract: 'C05', payer: ChargePayer.Propietario, splitMode: ChargeSplitMode.Consumo },
        { contract: 'C04', payer: ChargePayer.Inquilino, splitMode: ChargeSplitMode.Consumo },
      ],
    },
    {
      key: 'B05',
      serviceType: ServiceType.Municipal,
      property: 'C07',
      period: '2026-07',
      amount: '9876.54',
      rules: [{ contract: 'C07', payer: ChargePayer.Inmobiliaria }],
    },
  ],
  charges: [
    {
      key: 'K01',
      contract: 'C01',
      chargedTo: ChargeTarget.Locador,
      kind: PendingChargeKind.Reparacion,
      description: 'Cambio de termotanque',
      amount: '48000.00',
      beneficiary: LineBeneficiary.Inmobiliaria,
      incurredAt: '2026-07-12',
    },
    {
      key: 'K02',
      contract: 'C03',
      chargedTo: ChargeTarget.Inquilino,
      kind: PendingChargeKind.Devolucion,
      description: 'Expensa extraordinaria pagada por el inquilino',
      amount: '12000.00',
      beneficiary: LineBeneficiary.Locador,
      incurredAt: '2026-07-02',
    },
    {
      key: 'K03',
      contract: 'C03',
      chargedTo: ChargeTarget.Inquilino,
      kind: PendingChargeKind.Reparacion,
      description: 'Reparación de la cocina',
      amount: '80000.00',
      beneficiary: LineBeneficiary.Locador,
      incurredAt: '2026-07-02',
    },
    {
      key: 'K04',
      contract: 'C08',
      chargedTo: ChargeTarget.Inquilino,
      kind: PendingChargeKind.Reparacion,
      description: 'Cambio de cerradura',
      amount: '15500.00',
      beneficiary: LineBeneficiary.Inmobiliaria,
      incurredAt: '2026-07-04',
    },
  ],
  payments: [
    { key: 'P01', contract: 'C01', date: '2026-07-06', amount: '470112.98', method: 'Transferencia' },
    { key: 'P02', contract: 'C02', date: '2026-07-09', amount: '393198.95', method: 'Efectivo' },
    { key: 'P03', contract: 'C03', date: '2026-07-07', amount: '318000.00', method: 'Transferencia' },
    { key: 'P04', contract: 'C04', date: '2026-07-10', amount: '300000.00', method: 'Efectivo' },
    { key: 'P05', contract: 'C05', date: '2026-07-09', amount: '264150.00', method: 'Transferencia' },
    { key: 'P06', contract: 'C06', date: '2026-07-05', amount: '650.00', method: 'Efectivo', inCustody: true },
    { key: 'P07', contract: 'C07', date: '2026-07-03', amount: '619876.54', method: 'Transferencia' },
    { key: 'P08', contract: 'C08', date: '2026-07-08', amount: '365500.00', method: 'Transferencia' },
    {
      key: 'P09',
      contract: 'C09',
      date: '2026-07-03',
      amount: '275000.00',
      method: 'Transferencia',
      receivedBy: PaymentReceiver.Locador,
    },
    { key: 'P10', contract: 'C10', date: '2026-07-10', amount: '209000.00', method: 'Efectivo' },
    { key: 'P11', contract: 'C11', date: '2026-07-15', amount: '180967.74', method: 'Transferencia' },
  ],
  compensations: [{ payment: 'P09', from: 'L6', to: 'L7' }],
  payouts: [
    { lessor: 'L1', currency: 'ARS', amount: '300000.00', date: '2026-07-20', kind: OwnerLedgerEntryType.Transferencia },
    { lessor: 'L8', currency: 'ARS', amount: '186000.00', date: '2026-07-15', kind: OwnerLedgerEntryType.Transferencia },
    { lessor: 'L4', currency: 'USD', amount: '300.00', date: '2026-07-20', kind: OwnerLedgerEntryType.EntregaEfectivo },
  ],
  openingBalances: [{ lessor: 'L1', currency: 'ARS', amount: '-35000.00', date: '2026-06-30' }],
};

/** Resultado esperado del ciclo, calculado a mano (ver la derivación arriba). */
export const RECONCILIATION_EXPECTED: ReconciliationResult = {
  period: '2026-07',
  contracts: {
    C01: {
      'alquiler-mensual': '451662.61',
      'ajuste-pct': '7.8955',
      alquiler: '451662.61',
      'impuestos-y-servicios:Locador': '18450.37',
      total: '470112.98',
      comision: '31616.38',
      'neto-locadores': '438496.60',
      cobrado: '470112.98',
      'neto:L1': '438496.60',
    },
    C02: {
      'alquiler-mensual': '393198.95',
      'ajuste-pct': '57.2796',
      alquiler: '393198.95',
      total: '393198.95',
      comision: '19659.95',
      'neto-locadores': '373539.00',
      cobrado: '393198.95',
      'neto:L2': '224123.40',
      'neto:L3': '149415.60',
    },
    C03: {
      'alquiler-mensual': '330000.00',
      'ajuste-pct': '10.0000',
      alquiler: '330000.00',
      descuentos: '12000.00',
      total: '318000.00',
      comision: '23100.00',
      'neto-locadores': '294900.00',
      cobrado: '318000.00',
      'neto:L1': '294900.00',
    },
    C04: {
      'alquiler-mensual': '520000.00',
      alquiler: '520000.00',
      descuentos: '26000.00',
      'impuestos-y-servicios:Ente': '6123.46',
      total: '500123.46',
      comision: '34580.00',
      'neto-locadores': '459420.00',
      cobrado: '300000.00',
      'neto:L2': '192908.77',
      'neto:L3': '82675.18',
    },
    C05: {
      'alquiler-mensual': '258750.00',
      'ajuste-pct': '25.0000',
      alquiler: '258750.00',
      'impuestos-y-servicios:Locador': '5400.00',
      total: '264150.00',
      comision: '18112.50',
      'neto-locadores': '246037.50',
      cobrado: '264150.00',
      'neto:L1': '246037.50',
    },
    C06: {
      'alquiler-mensual': '650.00',
      alquiler: '650.00',
      total: '650.00',
      comision: '45.50',
      'neto-locadores': '604.50',
      cobrado: '650.00',
      'neto:L4': '604.50',
    },
    C07: {
      'alquiler-mensual': '610000.00',
      alquiler: '610000.00',
      'impuestos-y-servicios:Ente': '9876.54',
      total: '619876.54',
      comision: '42700.00',
      'neto-locadores': '567300.00',
      cobrado: '619876.54',
      'neto:L5': '567300.00',
    },
    C08: {
      'alquiler-mensual': '350000.00',
      alquiler: '350000.00',
      'cargos:Inmobiliaria': '15500.00',
      total: '365500.00',
      comision: '20000.00',
      'neto-locadores': '330000.00',
      cobrado: '365500.00',
      'neto:L6': '330000.00',
    },
    C09: {
      'alquiler-mensual': '275000.00',
      alquiler: '275000.00',
      total: '275000.00',
      comision: '19250.00',
      'neto-locadores': '255750.00',
      cobrado: '275000.00',
      'neto:L7': '255750.00',
    },
    C10: {
      'alquiler-mensual': '200000.00',
      alquiler: '200000.00',
      punitorios: '9000.00',
      total: '209000.00',
      comision: '14630.00',
      'neto-locadores': '194370.00',
      cobrado: '209000.00',
      'neto:L8': '194370.00',
    },
    C11: {
      'alquiler-mensual': '330000.00',
      alquiler: '180967.74',
      total: '180967.74',
      comision: '12667.74',
      'neto-locadores': '168300.00',
      cobrado: '180967.74',
      'neto:L9': '168300.00',
    },
  },
  statements: {
    'L1 ARS': { apertura: '-35000.00', creditos: '1052262.98', debitos: '144079.25', pagos: '300000.00', cierre: '573183.73' },
    'L2 ARS': { apertura: '0.00', creditos: '443348.15', debitos: '26315.98', pagos: '0.00', cierre: '417032.17' },
    'L3 ARS': { apertura: '0.00', creditos: '246177.62', debitos: '14086.84', pagos: '0.00', cierre: '232090.78' },
    'L4 USD': { apertura: '0.00', creditos: '650.00', debitos: '45.50', pagos: '300.00', cierre: '304.50' },
    'L5 ARS': { apertura: '0.00', creditos: '610000.00', debitos: '42700.00', pagos: '619876.54', cierre: '-52576.54' },
    'L6 ARS': { apertura: '0.00', creditos: '350000.00', debitos: '295000.00', pagos: '0.00', cierre: '55000.00' },
    'L7 ARS': { apertura: '0.00', creditos: '550000.00', debitos: '19250.00', pagos: '275000.00', cierre: '255750.00' },
    'L8 ARS': { apertura: '186000.00', creditos: '209000.00', debitos: '14630.00', pagos: '186000.00', cierre: '194370.00' },
    'L9 ARS': { apertura: '0.00', creditos: '180967.74', debitos: '12667.74', pagos: '0.00', cierre: '168300.00' },
  },
};
