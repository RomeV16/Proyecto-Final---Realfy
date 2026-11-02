import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { TicketQuotesService } from './ticket-quotes.service';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const QUOTE_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_ID = '33333333-3333-4333-8333-333333333333';
const LESSOR_ID = '44444444-4444-4444-8444-444444444444';
const money = (v: string) => ({ toString: () => v });

const ticket = (over: Record<string, unknown> = {}) => ({
  id: TICKET_ID,
  status: 'Abierto',
  providerId: null,
  estimatedAmount: null,
  costAmount: null,
  costCurrency: null,
  preauthorizedAmount: null,
  preauthorizedByPersonId: null,
  preauthorizedChannel: null,
  ...over,
});

const quote = (over: Record<string, unknown> = {}) => ({
  id: QUOTE_ID,
  ticketId: TICKET_ID,
  status: 'Pendiente',
  providerId: PROVIDER_ID,
  amount: money('80000'),
  currency: 'ARS',
  ...over,
});

function build(opts: { terms?: any; ticket?: any; quote?: any; limit?: number; person?: any; provider?: any; claimed?: number } = {}) {
  const client: any = {
    ticket: {
      findUnique: jest.fn().mockResolvedValue(opts.ticket === undefined ? ticket() : opts.ticket),
      update: jest.fn(async ({ data }: any) => ({ ...(opts.ticket ?? ticket()), ...data })),
    },
    ticketQuote: {
      findMany: jest.fn().mockResolvedValue([quote()]),
      findFirst: jest.fn().mockResolvedValue(opts.quote === undefined ? quote() : opts.quote),
      create: jest.fn(async ({ data }: any) => ({ id: QUOTE_ID, status: 'Pendiente', ...data })),
      update: jest.fn(async ({ data }: any) => ({ ...quote(), ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimed ?? 1 }),
      delete: jest.fn().mockResolvedValue({}),
    },
    contractTermsVersion: { findFirst: jest.fn().mockResolvedValue(opts.terms ?? null) },
    person: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.providerProfile ? (opts.provider === undefined ? { id: PROVIDER_ID } : opts.provider) : opts.person === undefined ? { id: LESSOR_ID } : opts.person,
      ),
    },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const defaults = { get: jest.fn().mockResolvedValue({ repairs: { preauthLimit: opts.limit ?? 100000, managementFeePct: 0 } }) };
  const tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1'), getUserId: jest.fn().mockReturnValue('user-1') };
  const service = new TicketQuotesService(
    { client } as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    audit as any,
    defaults as any,
  );
  return { service, client, audit };
}

describe('TicketQuotesService', () => {
  describe('estimate', () => {
    it('por encima del límite pasa a PendienteAutorizacion y lo informa', async () => {
      const { service, client, audit } = build();
      const res = await service.estimate(TICKET_ID, { amount: '150000' });
      expect(res).toMatchObject({ requiresAuthorization: true, limit: 100000 });
      expect(res.ticket.status).toBe('PendienteAutorizacion');
      expect(client.ticket.update.mock.calls[0][0].data).toMatchObject({
        estimatedAmount: '150000',
        costCurrency: 'ARS',
        status: 'PendienteAutorizacion',
      });
      expect(audit.record).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ metadata: expect.objectContaining({ operation: 'ticket-estimate', requiresAuthorization: true }) }),
      );
    });

    it('por debajo del límite no cambia el estado', async () => {
      const { service, client } = build();
      const res = await service.estimate(TICKET_ID, { amount: '90000' });
      expect(res.requiresAuthorization).toBe(false);
      expect(client.ticket.update.mock.calls[0][0].data.status).toBeUndefined();
    });

    it('el límite pactado en el contrato pisa al de la inmobiliaria', async () => {
      const terms = { repairPreauthLimitAmount: money('500000'), repairPreauthLimitCurrency: 'ARS' };
      const { service, client } = build({ ticket: ticket({ contractId: 'c-1' }), terms });
      const res = await service.estimate(TICKET_ID, { amount: '300000' });
      expect(res).toMatchObject({ requiresAuthorization: false, limit: 500000, limitCurrency: 'ARS', limitSource: 'Contrato' });
      expect(client.contractTermsVersion.findFirst.mock.calls[0][0].where).toMatchObject({ contractId: 'c-1', tenantId: 'tenant-1' });
      expect((await build({ ticket: ticket({ contractId: 'c-1' }), terms }).service.estimate(TICKET_ID, { amount: '500000.01' })).requiresAuthorization).toBe(true);
    });

    it('un límite pactado en dólares solo compara estimados en dólares', async () => {
      const terms = { repairPreauthLimitAmount: money('400'), repairPreauthLimitCurrency: 'USD' };
      expect((await build({ ticket: ticket({ contractId: 'c-1' }), terms }).service.estimate(TICKET_ID, { amount: '300', currency: 'USD' })).requiresAuthorization).toBe(false);
      expect((await build({ ticket: ticket({ contractId: 'c-1' }), terms }).service.estimate(TICKET_ID, { amount: '300' })).requiresAuthorization).toBe(true);
    });

    it('un contrato sin límite propio usa el de la inmobiliaria', async () => {
      const res = await build({ ticket: ticket({ contractId: 'c-1' }), terms: { repairPreauthLimitAmount: null } }).service.estimate(TICKET_ID, { amount: '150000' });
      expect(res).toMatchObject({ requiresAuthorization: true, limit: 100000, limitSource: 'Inmobiliaria' });
    });

    it('el tope que el locador ya autorizó pisa al límite', async () => {
      const { service } = build({ ticket: ticket({ status: 'Presupuestado', preauthorizedAmount: money('300000') }) });
      expect((await service.estimate(TICKET_ID, { amount: '250000' })).requiresAuthorization).toBe(false);
    });

    it('con el caso ya presupuestado solo actualiza el estimado', async () => {
      const { service, client } = build({ ticket: ticket({ status: 'Presupuestado' }) });
      const res = await service.estimate(TICKET_ID, { amount: '500000' });
      expect(res.requiresAuthorization).toBe(true);
      expect(client.ticket.update.mock.calls[0][0].data.status).toBeUndefined();
    });

    it('rechaza estimar un caso que ya empezó, uno que no existe y un importe inválido', async () => {
      await expect(build({ ticket: ticket({ status: 'EnProgreso' }) }).service.estimate(TICKET_ID, { amount: '1' })).rejects.toBeInstanceOf(ConflictException);
      await expect(build({ ticket: null }).service.estimate(TICKET_ID, { amount: '1' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(build().service.estimate(TICKET_ID, { amount: '0' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('preauthorize', () => {
    const body = { amount: '200000', approvedByPersonId: LESSOR_ID, channel: 'WhatsApp' };

    it('registra tope, quién, cuándo y canal y pasa a Presupuestado', async () => {
      const { service, client, audit } = build({ ticket: ticket({ status: 'PendienteAutorizacion' }) });
      const res = await service.preauthorize(TICKET_ID, body);
      expect(res.status).toBe('Presupuestado');
      const data = client.ticket.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ preauthorizedAmount: '200000', preauthorizedByPersonId: LESSOR_ID, preauthorizedChannel: 'WhatsApp' });
      expect(data.preauthorizedAt).toBeInstanceOf(Date);
      expect(audit.record).toHaveBeenCalledTimes(1);
    });

    it('solo desde PendienteAutorizacion y con una persona que exista', async () => {
      await expect(build().service.preauthorize(TICKET_ID, body)).rejects.toMatchObject({
        response: { error: 'TICKET_NOT_AWAITING_AUTHORIZATION' },
      });
      await expect(
        build({ ticket: ticket({ status: 'PendienteAutorizacion' }), person: null }).service.preauthorize(TICKET_ID, body),
      ).rejects.toMatchObject({ response: { error: 'PERSON_NOT_FOUND' } });
    });
  });

  describe('presupuestos', () => {
    const body = { providerId: PROVIDER_ID, amount: '80000' };

    it('lista los del ticket y exige que el ticket exista', async () => {
      const { service, client } = build();
      expect(await service.listQuotes(TICKET_ID)).toHaveLength(1);
      expect(client.ticketQuote.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
      await expect(build({ ticket: null }).service.listQuotes(TICKET_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('el primero pasa el caso a Presupuestado', async () => {
      const { service, client, audit } = build();
      const res = await service.createQuote(TICKET_ID, body);
      expect(res).toMatchObject({ providerId: PROVIDER_ID, amount: '80000', currency: 'ARS', createdById: 'user-1' });
      expect(client.ticket.update).toHaveBeenCalledWith({ where: { id: TICKET_ID }, data: { status: 'Presupuestado' } });
      expect(audit.record).toHaveBeenCalledWith(client, expect.objectContaining({ entity: 'TicketQuote', action: 'CREATE' }));
    });

    it('con el caso ya presupuestado no vuelve a cambiar el estado', async () => {
      const { service, client } = build({ ticket: ticket({ status: 'Presupuestado' }) });
      await service.createQuote(TICKET_ID, body);
      expect(client.ticket.update).not.toHaveBeenCalled();
    });

    it('no se presupuesta sin la autorización del locador ni con el trabajo en marcha', async () => {
      await expect(build({ ticket: ticket({ status: 'PendienteAutorizacion' }) }).service.createQuote(TICKET_ID, body)).rejects.toMatchObject({
        response: { error: 'TICKET_NEEDS_AUTHORIZATION' },
      });
      await expect(build({ ticket: ticket({ status: 'EnProgreso' }) }).service.createQuote(TICKET_ID, body)).rejects.toMatchObject({
        response: { error: 'TICKET_NOT_QUOTABLE' },
      });
    });

    it('el proveedor tiene que existir', async () => {
      await expect(build({ provider: null }).service.createQuote(TICKET_ID, body)).rejects.toMatchObject({
        response: { error: 'PROVIDER_NOT_FOUND' },
      });
    });

    it('corrige, descarta y quita un presupuesto pendiente', async () => {
      const { service, client, audit } = build({ ticket: ticket({ status: 'Presupuestado' }) });
      await service.updateQuote(TICKET_ID, QUOTE_ID, { amount: '75000' });
      expect(client.ticketQuote.update.mock.calls[0][0].data).toEqual({ amount: '75000' });
      expect(await service.rejectQuote(TICKET_ID, QUOTE_ID)).toMatchObject({ status: 'Rechazado' });
      expect(await service.removeQuote(TICKET_ID, QUOTE_ID)).toEqual({ deleted: true });
      expect(client.ticketQuote.delete).toHaveBeenCalledWith({ where: { id: QUOTE_ID } });
      expect(audit.record).toHaveBeenCalledTimes(3);
    });

    it('no toca un presupuesto ya resuelto, ajeno al ticket o fuera de la etapa', async () => {
      const presupuestado = ticket({ status: 'Presupuestado' });
      await expect(build({ ticket: presupuestado, quote: quote({ status: 'Aprobado' }) }).service.removeQuote(TICKET_ID, QUOTE_ID)).rejects.toMatchObject({
        response: { error: 'QUOTE_NOT_PENDING' },
      });
      await expect(build({ ticket: presupuestado, quote: null }).service.removeQuote(TICKET_ID, QUOTE_ID)).rejects.toMatchObject({
        response: { error: 'QUOTE_NOT_FOUND' },
      });
      await expect(build().service.removeQuote(TICKET_ID, QUOTE_ID)).rejects.toMatchObject({ response: { error: 'TICKET_NOT_QUOTING' } });
    });
  });

  describe('approveQuote', () => {
    const body = { approvedByPersonId: LESSOR_ID, channel: 'Telefono' };

    it('anota quién, cuándo y canal, descarta los demás y pasa proveedor e importe al ticket', async () => {
      const { service, client, audit } = build({ ticket: ticket({ status: 'Presupuestado' }) });
      const res = await service.approveQuote(TICKET_ID, QUOTE_ID, body);
      const claim = client.ticketQuote.updateMany.mock.calls[0][0];
      expect(claim.where).toEqual({ id: QUOTE_ID, status: 'Pendiente' });
      expect(claim.data).toMatchObject({ status: 'Aprobado', approvedByPersonId: LESSOR_ID, approvedByUserId: 'user-1', channel: 'Telefono' });
      expect(claim.data.approvedAt).toBeInstanceOf(Date);
      expect(client.ticketQuote.updateMany.mock.calls[1][0]).toEqual({
        where: { ticketId: TICKET_ID, id: { not: QUOTE_ID }, status: 'Pendiente' },
        data: { status: 'Rechazado' },
      });
      expect(client.ticket.update).toHaveBeenCalledWith({
        where: { id: TICKET_ID },
        data: { status: 'PresupuestoAprobado', providerId: PROVIDER_ID, costAmount: expect.anything(), costCurrency: 'ARS' },
      });
      expect(res.ticket.validTransitions).toEqual(['ProveedorAsignado', 'EnProgreso', 'Cancelado']);
      expect(audit.record).toHaveBeenCalledTimes(2);
    });

    it('si otro lo aprobó antes falla sin tocar el ticket', async () => {
      const { service, client } = build({ ticket: ticket({ status: 'Presupuestado' }), claimed: 0 });
      await expect(service.approveQuote(TICKET_ID, QUOTE_ID, body)).rejects.toMatchObject({ response: { error: 'QUOTE_NOT_PENDING' } });
      expect(client.ticket.update).not.toHaveBeenCalled();
    });

    it('pide una persona que exista y los datos de la aprobación', async () => {
      await expect(
        build({ ticket: ticket({ status: 'Presupuestado' }), person: null }).service.approveQuote(TICKET_ID, QUOTE_ID, body),
      ).rejects.toMatchObject({ response: { error: 'PERSON_NOT_FOUND' } });
      await expect(
        build({ ticket: ticket({ status: 'Presupuestado' }) }).service.approveQuote(TICKET_ID, QUOTE_ID, { channel: 'Telefono' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
