import { z } from 'zod';

// ─── Priorización diaria ────────────────────────────────

/** Qué tan urgente es atender un item hoy. */
export const AiPriorityUrgencySchema = z.enum(['alta', 'media', 'baja']);

/**
 * Un item priorizado tal como lo devuelve el modelo de lenguaje.
 *
 * `ref` es el identificador opaco con el que viajó el item (`C1`, `R2`, `V3`…):
 * el modelo nunca ve ni devuelve datos de la persona detrás del item, y los
 * nombres se reponen del lado del servidor.
 */
export const AiPriorityItemSchema = z.object({
  ref: z.string().regex(/^[A-Z]\d{1,3}$/, 'Debe ser una referencia opaca tipo C1'),
  urgency: AiPriorityUrgencySchema,
  reason: z.string().trim().min(1).max(240),
  action: z.string().trim().min(1).max(160),
});

/** Respuesta completa esperada del modelo. */
export const AiPrioritiesResponseSchema = z.object({
  priorities: z.array(AiPriorityItemSchema).min(1).max(24),
});

// ─── Resumen de gestión al cierre de contrato ───────────

/** Quién redactó el resumen: el modelo de lenguaje o las plantillas propias. */
export const ClosureSummarySourceSchema = z.enum(['model', 'rules']);

/**
 * Métricas de gestión de un contrato cerrado.
 *
 * Todas se calculan en el servidor a partir de los registros reales del
 * contrato — liquidaciones, pagos, punitorios, reclamos, ajustes y rendiciones —
 * y son la única fuente de cifras del resumen. El esquema se usa en las dos
 * direcciones: para armar el bloque que se guarda y para releer el JSON
 * persistido sin confiar en su forma.
 */
export const ContractClosureMetricsSchema = z.object({
  // ── Vigencia ──
  contractType: z.string(),
  closureStatus: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  /** Fecha en que el contrato dejó de estar vigente de hecho. */
  closedOn: z.string(),
  durationDays: z.number().int().min(0),
  durationMonths: z.number().int().min(0),
  /** El cierre se dio antes de la fecha de fin pactada. */
  endedEarly: z.boolean(),
  currency: z.string(),

  // ── Comportamiento de pago ──
  billedCount: z.number().int().min(0),
  paidCount: z.number().int().min(0),
  onTimeCount: z.number().int().min(0),
  lateCount: z.number().int().min(0),
  unpaidCount: z.number().int().min(0),
  /** Porcentaje de liquidaciones cobradas que se pagaron en término. */
  onTimeRate: z.number().min(0).max(100),
  averageDelayDays: z.number().min(0),
  maxDelayDays: z.number().int().min(0),
  billedAmount: z.number().min(0),
  collectedAmount: z.number().min(0),
  outstandingAmount: z.number().min(0),

  // ── Punitorios ──
  penaltyCount: z.number().int().min(0),
  penaltyAmount: z.number().min(0),
  penaltyWaivedCount: z.number().int().min(0),

  // ── Reclamos ──
  ticketCount: z.number().int().min(0),
  ticketsResolved: z.number().int().min(0),
  ticketsCancelled: z.number().int().min(0),
  ticketsOpen: z.number().int().min(0),
  /** Promedio de días hasta la resolución, o `null` si no se resolvió ninguno. */
  averageResolutionDays: z.number().min(0).nullable(),
  ticketCostAmount: z.number().min(0),

  // ── Ajustes de alquiler ──
  adjustmentCount: z.number().int().min(0),
  firstRent: z.number().min(0),
  lastRent: z.number().min(0),
  rentIncreasePct: z.number(),

  // ── Rendiciones al propietario ──
  rendicionCount: z.number().int().min(0),
  rendicionNetAmount: z.number().min(0),
});

/**
 * Respuesta esperada del modelo al pedirle el resumen de cierre.
 *
 * Deliberadamente no tiene ningún campo numérico: el modelo recibe las métricas
 * ya calculadas y su único trabajo es redactarlas. Todo lo que devuelve es
 * prosa, así que no hay lugar donde pueda colar una cifra propia.
 */
export const AiClosureSummaryResponseSchema = z.object({
  summary: z.string().trim().min(80).max(1800),
  highlights: z.array(z.string().trim().min(4).max(200)).min(2).max(5),
});
