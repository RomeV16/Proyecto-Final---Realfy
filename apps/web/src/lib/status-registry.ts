import {
  ContractStatus,
  LeadStatus,
  LiquidacionStatus,
  RendicionStatus,
  TicketStatus,
  VisitStatus,
} from '@realfy/shared';
import type { BadgeVariant } from '@/components/ui/badge';

/**
 * Registro único de estados: para cada entidad, el tono de la chapa y la clave
 * i18n de su etiqueta. Las pantallas no definen mapas propios; si aparece un
 * estado nuevo en un enum, se agrega acá (y su etiqueta en es.json y en.json).
 *
 * Criterio de tonos (los mismos en el listado, el detalle y la chapa):
 * - neutral: sin acción pendiente o fuera de juego (Borrador, Archivado, Anulada, Cerrado).
 * - info: en revisión o en curso (Revision, Asignado, Aprobada de una rendición).
 * - brand: avanzó un paso y espera al siguiente (Aprobada de una liquidación, proveedor en camino).
 * - warning: hay algo pendiente o a vigilar (Pendiente, Vencido, Enviada de una rendición).
 * - success: terminó bien (Pagada, Activo, Resuelto, Depositada).
 * - danger: terminó mal o requiere atención urgente (Vencida, Rescindido, Cancelado, Perdido).
 *
 * En liquidaciones `Aprobada` es brand (no success: el éxito es `Pagada`) y
 * `Enviada` es info; es el tono que ya mostraba el listado, y la chapa del
 * detalle se alinea con él.
 */
export type StatusDomain = 'liquidacion' | 'rendicion' | 'contrato' | 'ticket' | 'lead' | 'visita';

export interface StatusEntry {
  tone: BadgeVariant;
  /** Clave i18n absoluta de la etiqueta. */
  labelKey: string;
  /** Tachado: el registro quedó sin efecto. */
  strike?: boolean;
}

function entries(
  prefix: string,
  tones: Record<string, BadgeVariant>,
  strike: string[] = [],
): Record<string, StatusEntry> {
  return Object.fromEntries(
    Object.entries(tones).map(([status, tone]) => [
      status,
      { tone, labelKey: `${prefix}.${status}`, ...(strike.includes(status) ? { strike: true } : {}) },
    ]),
  );
}

export const STATUS_REGISTRY: Record<StatusDomain, Record<string, StatusEntry>> = {
  liquidacion: entries(
    'liquidaciones.statuses',
    {
      [LiquidacionStatus.Borrador]: 'neutral',
      [LiquidacionStatus.Revision]: 'info',
      [LiquidacionStatus.Aprobada]: 'brand',
      [LiquidacionStatus.Pendiente]: 'warning',
      [LiquidacionStatus.Enviada]: 'info',
      [LiquidacionStatus.Pagada]: 'success',
      [LiquidacionStatus.Vencida]: 'danger',
      [LiquidacionStatus.Anulada]: 'neutral',
    },
    [LiquidacionStatus.Anulada],
  ),
  rendicion: entries('renditions.statuses', {
    [RendicionStatus.Borrador]: 'neutral',
    [RendicionStatus.Aprobada]: 'info',
    [RendicionStatus.Enviada]: 'warning',
    [RendicionStatus.Depositada]: 'success',
  }),
  contrato: entries('contracts.statuses', {
    [ContractStatus.Borrador]: 'neutral',
    [ContractStatus.Activo]: 'success',
    [ContractStatus.Vencido]: 'warning',
    [ContractStatus.Rescindido]: 'danger',
    [ContractStatus.Renovado]: 'info',
    [ContractStatus.Archivado]: 'neutral',
  }),
  ticket: entries('tickets.statuses', {
    [TicketStatus.Abierto]: 'info',
    [TicketStatus.Asignado]: 'info',
    [TicketStatus.EnProgreso]: 'warning',
    [TicketStatus.ProveedorAsignado]: 'brand',
    [TicketStatus.ProveedorEnCamino]: 'brand',
    [TicketStatus.TrabajoRealizado]: 'info',
    [TicketStatus.Resuelto]: 'success',
    [TicketStatus.Cerrado]: 'neutral',
    [TicketStatus.Cancelado]: 'danger',
    [TicketStatus.Reabierto]: 'warning',
  }),
  lead: entries('leads.statuses', {
    [LeadStatus.Nuevo]: 'info',
    [LeadStatus.Contactado]: 'warning',
    [LeadStatus.Calificado]: 'success',
    [LeadStatus.Convertido]: 'success',
    [LeadStatus.Perdido]: 'danger',
  }),
  visita: entries('interactions.visits.statuses', {
    [VisitStatus.Programada]: 'info',
    [VisitStatus.Completada]: 'success',
    [VisitStatus.Cancelada]: 'danger',
    [VisitStatus.NoShow]: 'warning',
  }),
};

/** Entrada de un estado; `undefined` si el valor no está registrado. */
export function statusEntry(domain: StatusDomain, status: string): StatusEntry | undefined {
  return STATUS_REGISTRY[domain][status];
}

/** Color de la barra lateral de `EntityCard`: neutral no lleva barra. */
export function statusAccent(domain: StatusDomain, status: string): Exclude<BadgeVariant, 'neutral'> | 'none' {
  const tone = statusEntry(domain, status)?.tone ?? 'neutral';
  return tone === 'neutral' ? 'none' : tone;
}
