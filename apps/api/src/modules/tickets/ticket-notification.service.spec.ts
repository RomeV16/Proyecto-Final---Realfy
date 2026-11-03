import { MessageChannel } from '@realfy/shared';
import { TicketNotificationService } from './ticket-notification.service';

function build(opts: { person?: any; channel?: MessageChannel | null; staff?: any[] } = {}) {
  const client: any = {
    person: { findFirst: jest.fn().mockResolvedValue(opts.person === undefined ? { id: 'p-1', firstName: 'Iris', email: 'iris@example.com', phone: null } : opts.person) },
    tenant: { findFirst: jest.fn().mockResolvedValue({ name: 'Inmo Demo' }) },
  };
  const baseClient: any = { user: { findMany: jest.fn().mockResolvedValue(opts.staff ?? [{ id: 'u-sop' }]) } };
  const outbox = {
    pickChannel: jest.fn().mockResolvedValue(opts.channel === undefined ? MessageChannel.Email : opts.channel),
    enqueue: jest.fn().mockResolvedValue({ id: 'm-1' }),
  };
  const notifications = { createNotification: jest.fn().mockResolvedValue({ id: 'n-1' }) };
  const service = new TicketNotificationService({ client, baseClient } as any, outbox as any, notifications as any);
  return { service, outbox, notifications, baseClient };
}

const TICKET = { id: 't-9', tenantId: 'ten-1', title: 'Pérdida en el baño', propertyId: 'prop-1', createdByPersonId: 'p-1' };

describe('TicketNotificationService (ADR-0013)', () => {
  it('un ticket nuevo del portal avisa en la bandeja a quienes atienden reclamos', async () => {
    const { service, notifications, baseClient } = build({ staff: [{ id: 'u-1' }, { id: 'u-2' }] });
    await service.notifyStaffOnNewTicket({ ...TICKET, property: { title: 'Depto Centro' } });
    expect(baseClient.user.findMany.mock.calls[0][0].where.role.in).toEqual(expect.arrayContaining(['Admin', 'Gerente', 'Soporte']));
    expect(notifications.createNotification).toHaveBeenCalledTimes(2);
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'ten-1', userId: 'u-1', type: 'TicketCreated', message: 'Pérdida en el baño en Depto Centro', entityId: 't-9' }),
    );
  });

  it('un cambio de estado le llega al inquilino por la bandeja de salida, por el canal que corresponde', async () => {
    const { service, outbox } = build({ channel: MessageChannel.WhatsApp });
    await service.notifyInquilinoOnStatusChange(TICKET, 'Abierto', 'EnProgreso');
    const [, input] = outbox.enqueue.mock.calls[0];
    expect(input).toMatchObject({
      channel: 'WhatsApp',
      templateKey: 'ticket_status',
      vars: { name: 'Iris', ticket: 'Pérdida en el baño', status: 'en curso', agency: 'Inmo Demo' },
      personId: 'p-1',
      relatedType: 'Ticket',
      relatedId: 't-9',
    });
    expect(input.idempotencyKey).toMatch(/^Ticket:t-9:Abierto->EnProgreso:/);
  });

  it('sin persona del portal, sin persona o sin canal no encola nada', async () => {
    const sinCreador = build();
    await sinCreador.service.notifyInquilinoOnStatusChange({ ...TICKET, createdByPersonId: null }, 'Abierto', 'Cerrado');
    const sinPersona = build({ person: null });
    await sinPersona.service.notifyInquilinoOnStatusChange(TICKET, 'Abierto', 'Cerrado');
    const sinCanal = build({ channel: null });
    await sinCanal.service.notifyInquilinoOnStatusChange(TICKET, 'Abierto', 'Cerrado');
    for (const b of [sinCreador, sinPersona, sinCanal]) expect(b.outbox.enqueue).not.toHaveBeenCalled();
  });

  it('un comentario del personal le llega al inquilino con un extracto, una vez por comentario', async () => {
    const { service, outbox, notifications } = build();
    const long = `Mañana   pasa el plomero\nentre 9 y 12. ${'x'.repeat(200)}`;
    await service.notifyOnComment(TICKET, { id: 'c-1', content: long }, false);
    const [, input] = outbox.enqueue.mock.calls[0];
    expect(input).toMatchObject({ templateKey: 'ticket_comment', relatedType: 'TicketComment', relatedId: 'c-1', idempotencyKey: 'TicketComment:c-1' });
    expect(input.vars.comment.startsWith('Mañana pasa el plomero entre 9 y 12.')).toBe(true);
    expect(input.vars.comment).toHaveLength(140);
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('un comentario del inquilino avisa al responsable, o a soporte si no hay', async () => {
    const asignado = build();
    await asignado.service.notifyOnComment({ ...TICKET, assignedToUserId: 'u-resp' }, { id: 'c-2', content: 'Gracias' }, true);
    expect(asignado.notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-resp', type: 'TicketCommentAdded', message: 'Pérdida en el baño: Gracias' }),
    );
    expect(asignado.outbox.enqueue).not.toHaveBeenCalled();

    const libre = build({ staff: [{ id: 'u-sop' }] });
    await libre.service.notifyOnComment(TICKET, { id: 'c-3', content: 'Hola' }, true);
    expect(libre.notifications.createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-sop' }));
  });
});
