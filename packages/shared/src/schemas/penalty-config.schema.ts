import { z } from 'zod';
import {
  BNA_RATE_KINDS,
  CAP_BASES,
  MISSING_RATE_BEHAVIORS,
  PARTIAL_PAYMENT_ALLOCATIONS,
  PENALTY_MODES,
  ROUNDING_MODES,
} from '../penalty-engine';

export const PenaltyModeEnum = z.enum(PENALTY_MODES);

/** Decimal como texto, sin signo: dígitos y parte decimal opcional. */
const decimalString = (message: string) => z.string().regex(/^\d+(\.\d+)?$/, { message });

/**
 * Configuración de punitorios de una inmobiliaria. `value` y `maxMultiplier`
 * viajan como decimales en texto para no perder precisión en el JSON.
 */
export const PenaltyConfigSchema = z
  .object({
    mode: PenaltyModeEnum,
    value: decimalString('value must be a non-negative decimal string (e.g. "0.001")'),
    graceDays: z.number().int().min(0),
    maxMultiplier: decimalString('maxMultiplier must be a non-negative decimal string (e.g. "2.0")'),
    /** Solo `max_bna_or_daily`: veces la tasa activa BNA (por defecto 2). */
    bnaMultiplier: decimalString('bnaMultiplier must be a non-negative decimal string (e.g. "2")').optional(),
    /** Solo `max_bna_or_daily`: días del año para convertir la TNA a diaria (por defecto 365). */
    yearDays: z.union([z.literal(365), z.literal(360)]).optional(),
    /** Solo `max_bna_or_daily`: la tasa cargada es nominal (TNA) o efectiva (TEA). */
    bnaRateKind: z.enum(BNA_RATE_KINDS).optional(),
    /** Con un pago parcial que cobra punitorios: cubre primero el alquiler (por defecto) o el punitorio. */
    partialPaymentAllocation: z.enum(PARTIAL_PAYMENT_ALLOCATIONS).optional(),
    /** Redondeo: una vez sobre el total (por defecto) o cada día. */
    roundingMode: z.enum(ROUNDING_MODES).optional(),
    /** Base del tope: el saldo del primer día con punitorio (por defecto) o el total original. */
    capBase: z.enum(CAP_BASES).optional(),
    /** Solo `max_bna_or_daily`: sin tasa cargada rige el piso (por defecto) o no se devenga ese día. */
    missingRateBehavior: z.enum(MISSING_RATE_BEHAVIORS).optional(),
  })
  .strict();

export const PreviewPenaltySchema = z
  .object({
    debt: decimalString('debt must be a non-negative decimal string'),
    daysOverdue: z.number().int().min(0),
    config: PenaltyConfigSchema,
    /** Solo `max_bna_or_daily`: TNA de la tasa activa BNA (en %) para la simulación. Sin ella rige el piso diario. */
    bnaAnnualPct: decimalString('bnaAnnualPct must be a non-negative decimal string (e.g. "45.5")').optional(),
  })
  .strict();

/** Motivo obligatorio de una condonación; queda en el registro de auditoría. */
export const WaivePenaltySchema = z
  .object({ reason: z.string().trim().min(1, { message: 'reason is required' }).max(500) })
  .strict();

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00.000Z`)), { message: 'date must be a valid day' });

/** `GET /liquidaciones/:id/payoff?date=`: el día es opcional (por defecto, hoy en Buenos Aires). */
export const PayoffQuerySchema = z.object({ date: isoDay.optional() }).strict();

/** `POST /contracts/:id/penalties/waive-all?upTo=`: tope opcional de la condonación masiva. */
export const WaiveAllQuerySchema = z.object({ upTo: isoDay.optional() }).strict();

export type PenaltyMode = z.infer<typeof PenaltyModeEnum>;
export type PenaltyConfig = z.infer<typeof PenaltyConfigSchema>;
export type PreviewPenaltyInput = z.infer<typeof PreviewPenaltySchema>;
