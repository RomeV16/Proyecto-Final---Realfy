import { z } from 'zod';

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
    /** Rezago en meses con que se toma el IPC al ajustar. */
    ipcLagMonths: z.number().int().min(0).max(12).default(2),
    /** Comisión de administración, en porcentaje del alquiler cobrado. */
    commissionPct: pct.default(7),
    /** Honorarios por operación, en porcentaje. */
    fees: z
      .object({
        alta: pct.default(5),
        renovacion: pct.default(5),
        ventaConstruido: pct.default(3),
        ventaLote: pct.default(5),
      })
      .strict()
      .default({}),
    /** Honorario de una tasación, en dólares. */
    valuationUsd: z.number().min(0).default(100),
    /** Pago a cuenta: monto a partir del cual se pide anticipo, en honorarios mensuales. */
    upfrontThresholdFees: z.number().min(0).default(2),
    /** Recordatorios de cobranza: el primero a los N días del vencimiento y luego cada M días. */
    collectionCadence: z
      .object({
        firstReminderDays: days.default(5),
        everyDays: z.number().int().min(1).max(365).default(5),
      })
      .strict()
      .default({}),
    /** Semáforo de vencimiento de contratos: rojo a los N días o menos del fin, amarillo hasta los M días. */
    expiryLight: z
      .object({
        redDays: days.default(0),
        yellowDays: days.default(60),
      })
      .strict()
      .default({})
      .refine((v) => v.yellowDays >= v.redDays, {
        message: 'yellowDays must be greater than or equal to redDays',
        path: ['yellowDays'],
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
