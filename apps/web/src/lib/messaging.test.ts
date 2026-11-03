import { describe, expect, it } from 'vitest';
import type { OutboxItem } from '@realfy/shared';
import {
  canCancelMessage,
  canRetryMessage,
  documentOutboxHref,
  documentOutboxPath,
  EMPTY_OUTBOX_FILTERS,
  MESSAGE_CHANNELS,
  MESSAGE_STATUSES,
  outboxFiltersFromSearch,
  recipientName,
  relatedHref,
} from './messaging';

describe('mensajería: ayudas de la web', () => {
  it('reintenta y cancela solo desde los estados que acepta la API', () => {
    expect(MESSAGE_STATUSES.filter(canRetryMessage)).toEqual(['Failed', 'Blocked', 'Cancelled']);
    expect(MESSAGE_STATUSES.filter(canCancelMessage)).toEqual(['Pending', 'Blocked']);
    expect(MESSAGE_CHANNELS).toEqual(['Email', 'WhatsApp']);
  });

  it('lleva a la pantalla del documento cuando tiene una', () => {
    expect(relatedHref('OwnerStatement', 'st-1')).toBe('/estados-de-cuenta/st-1');
    expect(relatedHref('Liquidacion', 'l-1')).toBe('/liquidaciones/l-1');
    expect(relatedHref('Ticket', 't-1')).toBe('/tickets/t-1');
    expect(relatedHref('Receipt', 'r-1')).toBeNull();
    expect(relatedHref(null, 'x')).toBeNull();
    expect(relatedHref('Ticket', null)).toBeNull();
  });

  it('lee los filtros de la dirección; sin dirección quedan vacíos', () => {
    expect(outboxFiltersFromSearch(new URLSearchParams('personId=pe-1&status=Failed'))).toEqual({
      ...EMPTY_OUTBOX_FILTERS,
      personId: 'pe-1',
      status: 'Failed',
    });
    expect(outboxFiltersFromSearch(null)).toEqual(EMPTY_OUTBOX_FILTERS);
  });

  it('arma la consulta y el enlace de los mensajes de un documento', () => {
    expect(documentOutboxPath('Receipt', 'r-1')).toBe('/outbox?relatedType=Receipt&relatedId=r-1&page=1&limit=20');
    expect(documentOutboxHref('OwnerStatement', 'st-1')).toBe('/mensajeria?relatedType=OwnerStatement&relatedId=st-1');
  });

  it('toma el nombre del primer mensaje que lo tenga', () => {
    const items = [{ personName: null }, { personName: 'Ana Prueba' }] as OutboxItem[];
    expect(recipientName(items)).toBe('Ana Prueba');
    expect(recipientName([])).toBeNull();
  });
});
