import { PipelineType } from './enums';
import { TicketPriority } from './enums';

export const DEFAULT_TIMEZONE = 'America/Buenos_Aires';
export const DEFAULT_CURRENCY = 'ARS';

// ─── Default Pipeline Stage Definitions ─────────────────

export interface DefaultStageDefinition {
  name: string;
  sortOrder: number;
  staleDays: number | null;
  isDefault: boolean;
}

export const DEFAULT_ALQUILER_STAGES: readonly DefaultStageDefinition[] = [
  { name: 'Consulta nueva', sortOrder: 0, staleDays: 2, isDefault: true },
  { name: 'Contactado', sortOrder: 1, staleDays: 3, isDefault: true },
  { name: 'Visita agendada', sortOrder: 2, staleDays: 5, isDefault: true },
  { name: 'Visita realizada', sortOrder: 3, staleDays: 3, isDefault: true },
  { name: 'Interesado', sortOrder: 4, staleDays: 5, isDefault: true },
  { name: 'Documentación', sortOrder: 5, staleDays: 7, isDefault: true },
  { name: 'Garantía en revisión', sortOrder: 6, staleDays: 10, isDefault: true },
  { name: 'Garantía aprobada', sortOrder: 7, staleDays: 5, isDefault: true },
  { name: 'Contrato en preparación', sortOrder: 8, staleDays: 7, isDefault: true },
  { name: 'Contrato firmado', sortOrder: 9, staleDays: null, isDefault: true },
  { name: 'Alquilado', sortOrder: 10, staleDays: null, isDefault: true },
] as const;

export const DEFAULT_VENTA_STAGES: readonly DefaultStageDefinition[] = [
  { name: 'Consulta nueva', sortOrder: 0, staleDays: 2, isDefault: true },
  { name: 'Contactado', sortOrder: 1, staleDays: 3, isDefault: true },
  { name: 'Visita agendada', sortOrder: 2, staleDays: 5, isDefault: true },
  { name: 'Visita realizada', sortOrder: 3, staleDays: 3, isDefault: true },
  { name: 'Interesado', sortOrder: 4, staleDays: 5, isDefault: true },
  { name: 'Oferta realizada', sortOrder: 5, staleDays: 7, isDefault: true },
  { name: 'Negociación', sortOrder: 6, staleDays: 10, isDefault: true },
  { name: 'Reserva', sortOrder: 7, staleDays: 7, isDefault: true },
  { name: 'Boleto firmado', sortOrder: 8, staleDays: 14, isDefault: true },
  { name: 'Escritura en trámite', sortOrder: 9, staleDays: 30, isDefault: true },
  { name: 'Vendido', sortOrder: 10, staleDays: null, isDefault: true },
] as const;

export const DEFAULT_PIPELINE_STAGES: Record<PipelineType, readonly DefaultStageDefinition[]> = {
  [PipelineType.Alquiler]: DEFAULT_ALQUILER_STAGES,
  [PipelineType.Venta]: DEFAULT_VENTA_STAGES,
} as const;

// ─── Ticket SLA Constants ───────────────────────────────

/**
 * Maps each ticket priority to its SLA deadline in hours.
 * Baja has no SLA deadline (null).
 */
export const TICKET_SLA_HOURS: Record<TicketPriority, number | null> = {
  [TicketPriority.Urgente]: 4,
  [TicketPriority.Alta]: 24,
  [TicketPriority.Media]: 72,
  [TicketPriority.Baja]: null,
} as const;
