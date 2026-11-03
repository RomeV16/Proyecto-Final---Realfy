import { z } from 'zod';
import { DepositHolder, SalesDepositHolder, FirstDueMode, FixedDiscountProration, MidMonthAdjustmentMode, ProrationMode, UpfrontBasis } from '../enums';
import { CompensationScope, LessorDirectOwes, PartialAllocation } from '../settlement-engine';
import { ReceiptSeriesMode } from '../cash';
import { LessorChargeTiming } from '../owner-ledger';
import { FeeVatMode } from '../enums';
import { InvoicingSettingsSchema } from '../lessor-invoicing';
import type { CollectionPolicy } from '../collection-engine';
import { ContractTotalMode, FeePayerChoice, StaffCommissionBase } from '../fee-engine';
import { PublicationSettingsSchema } from '../publication/settings';

const pct = z.number().min(0).max(100);
const days = z.number().int().min(0).max(365);

/**
 * Valores por defecto de la operación de una inmobiliaria (Tenant.operationalDefaults).
 * Cada campo tiene su valor de arranque: un JSON parcial o vacío es válido y se
 * completa con los de acá. Un contrato o un acuerdo pueden pisarlos
 * (defecto -> contrato -> acuerdo).
 */
export const OperationalDefaultsSchema = z
  .object({
    /** Día del mes en que vence el alquiler. */
    dueDay: z.number().int().min(1).max(28).default(10),
    /** Días antes del vencimiento en que se genera la liquidación (día 20 con vencimiento el 10 del mes siguiente). */
    leadDays: z.number().int().min(0).max(60).default(10),
    /** Prorrateo de un mes parcial. */
    prorationMode: z.nativeEnum(ProrationMode).default(ProrationMode.DiasReales),
    /** Ajuste de alquiler que cae a mitad de mes. */
    midMonthAdjustmentMode: z
      .nativeEnum(MidMonthAdjustmentMode)
      .default(MidMonthAdjustmentMode.DesdePeriodoSiguiente),
    /** Primer mes de un contrato que empieza pasado el vencimiento (o al firmar). */
    firstDueMode: z.nativeEnum(FirstDueMode).default(FirstDueMode.DiaDeInicio),
    /** Descuento de monto fijo en un mes parcial. */
    fixedDiscountProration: z
      .nativeEnum(FixedDiscountProration)
      .default(FixedDiscountProration.Proporcional),
    /** Rezago en meses con que se toma el IPC al ajustar. */
    ipcLagMonths: z.number().int().min(0).max(12).default(2),
    /**
     * Pago a cuenta (FB-13): si el INDEC todavía no publicó el índice del ajuste,
     * se aplica uno provisorio con el estimado y se corrige al publicarse el oficial.
     * Apagado, un ajuste sin índice oficial queda pendiente.
     */
    allowProvisional: z.boolean().default(true),
    /** Comisión de administración, en porcentaje del alquiler cobrado. */
    commissionPct: pct.default(7),
    /** Honorarios por operación, en porcentaje. */
    fees: z
      .object({
        alta: pct.default(5),
        renovacion: pct.default(5),
        ventaConstruido: pct.default(3),
        ventaLote: pct.default(5),
        /** Cuotas en que se cobra un honorario, salvo que se pacte otra cosa. */
        installments: z.number().int().min(1).max(60).default(1),
        /** Las cuotas que vencen después de un ajuste del alquiler se ajustan igual. */
        adjustInstallments: z.boolean().default(true),
        /** Quién paga el honorario de un alquiler. */
        payer: z.nativeEnum(FeePayerChoice).default(FeePayerChoice.Inquilino),
        /** Parte del locador cuando pagan los dos, en porcentaje. */
        lessorSharePct: pct.default(50),
        /** Qué se suma como total del contrato. */
        contractTotalMode: z.nativeEnum(ContractTotalMode).default(ContractTotalMode.ConAjustesConocidos),
        /** IVA del honorario. */
        vatMode: z.nativeEnum(FeeVatMode).default(FeeVatMode.NoAplica),
        vatPct: pct.default(21),
        /** Comisión del personal por defecto, en porcentaje. */
        staffCommissionPct: pct.default(0),
        /** Sobre qué se calcula la comisión del personal. */
        staffCommissionBase: z.nativeEnum(StaffCommissionBase).default(StaffCommissionBase.Neto),
      })
      .strict()
      .default({}),
    /** Honorario de una tasación, en dólares. */
    valuationUsd: z.number().min(0).default(100),
    /** Pago a cuenta: monto a partir del cual se pide anticipo, en honorarios mensuales. */
    upfrontThresholdFees: z.number().min(0).default(2),
    /** Sobre qué comisión mensual se mide ese umbral; cada contrato puede pactar la suya. */
    upfrontBasis: z.nativeEnum(UpfrontBasis).default(UpfrontBasis.ComisionPactada),
    /** Recordatorios de cobranza: el primero a los N días del vencimiento y luego cada M días. */
    collectionCadence: z
      .object({
        firstReminderDays: days.default(5),
        everyDays: z.number().int().min(1).max(365).default(5),
      })
      .strict()
      .default({}),
    /**
     * Cobranza escalonada (ADR-0013). El ritmo de los recordatorios es `collectionCadence`; acá
     * se prende el proceso, cuántos niveles de tono se usan (1 a 3) y el plazo de la carta
     * documento. Apagado, el proceso diario no abre casos ni manda avisos.
     */
    collections: z
      .object({
        enabled: z.boolean().default(false),
        maxLevel: z.number().int().min(1).max(3).default(3),
        letterTermDays: z.number().int().min(1).max(60).default(10),
      })
      .strict()
      .default({}),
    /**
     * Caja y cobros (ADR-0012). Convenciones de dinero que no fijó la inmobiliaria:
     * cada una tiene un valor de fábrica y se puede cambiar.
     */
    cash: z
      .object({
        /** Qué le debe el locador a la inmobiliaria cuando el inquilino le paga directamente. */
        lessorDirectOwes: z.nativeEnum(LessorDirectOwes).default(LessorDirectOwes.TodoLoAjeno),
        /** Reparto de un pago parcial entre inmobiliaria, entes y locadores. */
        partialAllocation: z.nativeEnum(PartialAllocation).default(PartialAllocation.Proporcional),
        /** Si el efectivo en custodia de los locadores suma en el total de la inmobiliaria. */
        custodyInAgencyBalance: z.boolean().default(false),
        /** Serie de numeración de los recibos de cobro. */
        receiptSeries: z.nativeEnum(ReceiptSeriesMode).default(ReceiptSeriesMode.Unica),
        /** Emitir recibo también cuando el inquilino le paga al locador. */
        receiptWhenLessorReceives: z.boolean().default(false),
        /** Entre quiénes se admite una compensación. */
        compensationScope: z.nativeEnum(CompensationScope).default(CompensationScope.CualquierLocador),
      })
      .strict()
      .default({}),
    /**
     * Cuenta corriente y estado de cuenta del locador (ADR-0009). Convenciones que
     * la inmobiliaria no fijó, con su valor de fábrica.
     */
    ownerAccounts: z
      .object({
        /** Día en que cierra el estado mensual; null = fin de mes (calendario). */
        statementCloseDay: z.number().int().min(1).max(28).nullable().default(null),
        /** Cuándo se descuentan del estado los cargos al locador del centro de carga. */
        lessorChargeTiming: z.nativeEnum(LessorChargeTiming).default(LessorChargeTiming.AlGenerarEstado),
      })
      .strict()
      .default({}),
    /**
     * Facturación por cuenta del locador: qué se factura, cuándo y con qué IVA. Cada locador
     * puede pisarlo. Conservador: solo el alquiler, sin IVA discriminado y a pedido.
     */
    invoicing: InvoicingSettingsSchema.default({}),
    /**
     * Incidencias y reparaciones. `preauthLimit`: hasta qué importe, en pesos, la
     * inmobiliaria actúa sin consultar al locador (0 = siempre se consulta).
     * `managementFeePct`: porcentaje del honorario por gestión de una reparación que se
     * propone al imputar (0 = no se propone; el honorario es siempre opcional).
     */
    repairs: z
      .object({
        preauthLimit: z.number().min(0).default(0),
        managementFeePct: pct.default(0),
      })
      .strict()
      .default({}),
    /**
     * Depósitos y liquidación de egreso (D9): convenciones que la inmobiliaria no fijó.
     * Cada contrato puede pactar las suyas al cargar el depósito.
     */
    deposits: z
      .object({
        /** Quién guarda el depósito cuando no se indica. */
        defaultHeldBy: z.nativeEnum(DepositHolder).default(DepositHolder.Locador),
        /** Días corridos desde el egreso para devolver el depósito. */
        refundDueDays: days.default(30),
        /** Si los descuentos y reparaciones de la liquidación de egreso necesitan la conformidad del locador. */
        deductionsNeedLessorApproval: z.boolean().default(false),
      })
      .strict()
      .default({}),
    /** Publicación: portales, privacidad del aviso y del micrositio, aviso de vencimiento. */
    publication: PublicationSettingsSchema.default({}),

    /**
     * Ventas (D14): convenciones que la inmobiliaria no fijó. Solo se registran; el sistema
     * nunca devuelve ni retiene una seña por su cuenta (las reglas de pérdida y devolución
     * las define la inmobiliaria con su abogado).
     */
    sales: z
      .object({
        /** Días de vigencia de una reserva cuando no se indica vencimiento. */
        reservationDays: z.number().int().min(1).max(90).default(7),
        /** Quién guarda el dinero de una reserva o seña cuando no se indica. */
        defaultDepositHolder: z.nativeEnum(SalesDepositHolder).default(SalesDepositHolder.Inmobiliaria),
        /** Si pasar a boleto exige tener tildada la documentación obligatoria del inmueble. */
        requireDocsForBoleto: z.boolean().default(true),
      })
      .strict()
      .default({}),
    /** Semáforo de vencimiento de contratos: rojo a los N días o menos del fin, amarillo hasta los M días. */
    expiryLight: z
      .object({
        redDays: days.default(30),
        yellowDays: days.default(60),
      })
      .strict()
      .default({})
      .refine((v) => v.yellowDays >= v.redDays, {
        message: 'yellowDays must be greater than or equal to redDays',
        path: ['yellowDays'],
      }),
    /**
     * Mensajería (ADR-0013): horario de Buenos Aires en que se mandan los
     * mensajes a la cartera (desde `fromHour` inclusive hasta `untilHour`
     * exclusive). Fuera de ese horario quedan pendientes hasta que abra.
     */
    messaging: z
      .object({
        fromHour: z.number().int().min(0).max(23).default(9),
        untilHour: z.number().int().min(1).max(24).default(20),
      })
      .strict()
      .default({})
      .refine((v) => v.untilHour > v.fromHour, {
        message: 'untilHour must be greater than fromHour',
        path: ['untilHour'],
      }),
  })
  .strict();

export type OperationalDefaults = z.infer<typeof OperationalDefaultsSchema>;
export type OperationalDefaultsInput = z.input<typeof OperationalDefaultsSchema>;

/** Valores de arranque: lo que rige cuando la inmobiliaria no guardó nada. */
export const DEFAULT_OPERATIONAL_DEFAULTS: OperationalDefaults = OperationalDefaultsSchema.parse({});

/**
 * Valores vigentes de lo guardado (null/indefinido = los del código). Un valor
 * guardado inválido lanza.
 */
export function resolveOperationalDefaults(stored: unknown): OperationalDefaults {
  if (stored === null || stored === undefined) return DEFAULT_OPERATIONAL_DEFAULTS;
  return OperationalDefaultsSchema.parse(stored);
}

/** Política de cobranza vigente: el ritmo (`collectionCadence`) más lo propio de `collections`. */
export function collectionPolicyOf(defaults: OperationalDefaults): CollectionPolicy {
  return {
    enabled: defaults.collections.enabled,
    firstReminderDays: defaults.collectionCadence.firstReminderDays,
    everyDays: defaults.collectionCadence.everyDays,
    maxLevel: defaults.collections.maxLevel,
    letterTermDays: defaults.collections.letterTermDays,
  };
}
