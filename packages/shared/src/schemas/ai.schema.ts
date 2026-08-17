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
