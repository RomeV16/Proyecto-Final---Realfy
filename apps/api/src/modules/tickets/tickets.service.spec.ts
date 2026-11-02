import { ConflictException } from '@nestjs/common';
import { TicketsService } from './tickets.service';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';

function build(opts: { status?: string; payments?: number } = {}) {
  const client: any = {
    ticket: {
      findUnique: jest.fn().mockResolvedValue({
        id: TICKET_ID,
        status: opts.status ?? 'EnProgreso',
        tenantId: 't1',
        title: 'Pérdida',
        propertyId: 'p1',
        createdByPersonId: null,
      }),
      update: jest.fn(async ({ data }: any) => ({ id: TICKET_ID, ...data })),
    },
    cashMovement: { count: jest.fn().mockResolvedValue(opts.payments ?? 0) },
  };
  const notifications = { notifyInquilinoOnStatusChange: jest.fn().mockResolvedValue(undefined) };
  const service = new TicketsService({ client } as any, {} as any, {} as any, notifications as any);
  return { service, client };
}

describe('TicketsService.transition: cancelar', () => {
  it('un caso con pagos al proveedor no se cancela', async () => {
    const { service, client } = build({ payments: 2 });
    await expect(service.transition(TICKET_ID, { status: 'Cancelado' })).rejects.toMatchObject({
      response: { error: 'TICKET_HAS_PAYMENTS' },
    });
    await expect(service.transition(TICKET_ID, { status: 'Cancelado' })).rejects.toBeInstanceOf(ConflictException);
    expect(client.cashMovement.count).toHaveBeenCalledWith({ where: { sourceType: 'Ticket', sourceId: TICKET_ID } });
    expect(client.ticket.update).not.toHaveBeenCalled();
  });

  it('sin pagos se cancela', async () => {
    const { service, client } = build();
    const res = await service.transition(TICKET_ID, { status: 'Cancelado' });
    expect(res.status).toBe('Cancelado');
    expect(client.ticket.update).toHaveBeenCalled();
  });

  it('otras transiciones no consultan los pagos', async () => {
    const { service, client } = build();
    await service.transition(TICKET_ID, { status: 'Resuelto' });
    expect(client.cashMovement.count).not.toHaveBeenCalled();
  });
});
