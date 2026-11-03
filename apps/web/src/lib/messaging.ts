import { MessageChannel, MessageStatus, type OutboxItem } from '@realfy/shared';

/**
 * Ayudas de la mensajería saliente para la web: qué estados se pueden
 * reintentar o cancelar (los mismos que acepta la API), a dónde lleva el
 * documento de un mensaje y cómo se arma la consulta de la bandeja de salida.
 */

export const MESSAGE_STATUSES = Object.values(MessageStatus);
export const MESSAGE_CHANNELS = Object.values(MessageChannel);

/** Estados desde los que la API deja reintentar (`MESSAGE_NOT_RETRYABLE` en el resto). */
const RETRYABLE: readonly string[] = [MessageStatus.Failed, MessageStatus.Blocked, MessageStatus.Cancelled];
/** Estados desde los que la API deja cancelar (`MESSAGE_NOT_CANCELLABLE` en el resto). */
const CANCELLABLE: readonly string[] = [MessageStatus.Pending, MessageStatus.Blocked];

export const canRetryMessage = (status: string) => RETRYABLE.includes(status);
export const canCancelMessage = (status: string) => CANCELLABLE.includes(status);

/** Pantalla del documento de un mensaje; null si no tiene una propia (un recibo, una invitación). */
export function relatedHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  switch (type) {
    case 'OwnerStatement':
      return `/estados-de-cuenta/${id}`;
    case 'Liquidacion':
      return `/liquidaciones/${id}`;
    case 'Ticket':
      return `/tickets/${id}`;
    case 'CollectionCase':
      return `/cobranza/${id}`;
    default:
      return null;
  }
}

/** Filtros de la bandeja de salida; un `type` para que sirva con `usePaginatedList`. */
export type OutboxFilterValues = {
  status: string;
  channel: string;
  personId: string;
  relatedType: string;
  relatedId: string;
};

export const EMPTY_OUTBOX_FILTERS: OutboxFilterValues = {
  status: '',
  channel: '',
  personId: '',
  relatedType: '',
  relatedId: '',
};

/** Filtros iniciales a partir de la dirección (`?personId=` o `?relatedType=&relatedId=`). */
export function outboxFiltersFromSearch(search: { get: (name: string) => string | null } | null): OutboxFilterValues {
  const read = (name: keyof OutboxFilterValues) => search?.get(name) ?? '';
  return {
    status: read('status'),
    channel: read('channel'),
    personId: read('personId'),
    relatedType: read('relatedType'),
    relatedId: read('relatedId'),
  };
}

/** `GET /outbox` de los mensajes de un documento, los más nuevos primero. */
export function documentOutboxPath(relatedType: string, relatedId: string, limit = 20): string {
  const params = new URLSearchParams({ relatedType, relatedId, page: '1', limit: String(limit) });
  return `/outbox?${params.toString()}`;
}

/** Enlace a la bandeja de salida filtrada por un documento. */
export function documentOutboxHref(relatedType: string, relatedId: string): string {
  return `/mensajeria?${new URLSearchParams({ relatedType, relatedId }).toString()}`;
}

/** Nombre del destinatario para el aviso de "filtrando por persona": el del primer mensaje que lo tenga. */
export function recipientName(items: readonly OutboxItem[]): string | null {
  return items.find((i) => i.personName)?.personName ?? null;
}
