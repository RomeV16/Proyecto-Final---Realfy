import { Prisma } from '@prisma/client';
import { DocumentMessagesService } from './document-messages.service';

const RECEIPT_ID = '11111111-1111-4111-8111-111111111111';
const STATEMENT_ID = '22222222-2222-4222-8222-222222222222';
const inquilina = { id: 'p-inq', firstName: 'Iris', lastName: 'Inquilina', email: 'iris@example.com', phone: null };

function build(opts: { receipt?: any; statement?: any } = {}) {
  const client: any = {
    tenant: { findFirst: jest.fn().mockResolvedValue({ name: 'Inmo Demo' }) },
    receipt: { findFirst: jest.fn().mockResolvedValue(opts.receipt ?? null) },
    ownerStatement: { findFirst: jest.fn().mockResolvedValue(opts.statement ?? null) },
    messageOutbox: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'm-1',
        channel: 'Email',
        personId: 'p-inq',
        person: { firstName: 'Iris', lastName: 'Inquilina' },
        to: 'iris@example.com',
        templateKey: 'receipt',
        vars: {},
        status: 'Pending',
        statusReason: 'MESSAGING_OFF',
        error: null,
        attempts: 0,
        nextAttemptAt: null,
        scheduledAt: new Date('2026-11-02T15:00:00Z'),
        sentAt: null,
        deliveredAt: null,
        relatedType: 'Receipt',
        relatedId: RECEIPT_ID,
        createdAt: new Date('2026-11-02T15:00:00Z'),
      }),
    },
  };
  const outbox = { enqueue: jest.fn().mockResolvedValue({ id: 'm-1', status: 'Pending', statusReason: 'MESSAGING_OFF', created: true }) };
  const service = new DocumentMessagesService(
    { client } as any,
    { getTenantId: () => 't-1', getUserId: () => 'u-1' } as any,
    outbox as any,
  );
  return { service, outbox, client };
}

const rentReceipt = {
  id: RECEIPT_ID,
  series: 'RECIBO_COBRO',
  number: 12,
  currency: 'ARS',
  amount: new Prisma.Decimal('350000'),
  payment: {
    account: null,
    liquidacion: {
      period: new Date('2026-10-01T00:00:00Z'),
      contract: { persons: [{ role: 'Propietario', person: { id: 'p-x' } }, { role: 'Inquilino', person: inquilina }] },
    },
  },
  feeInstallment: null,
};

describe('DocumentMessagesService', () => {
  it('un recibo de alquiler va al inquilino, con una clave por documento y canal', async () => {
    const { service, outbox } = build({ receipt: rentReceipt });
    const item = await service.send({ kind: 'Receipt', id: RECEIPT_ID, channel: 'Email' });
    expect(outbox.enqueue.mock.calls[0][1]).toEqual({
      channel: 'Email',
      templateKey: 'receipt',
      vars: {
        name: 'Iris',
        number: '00000012',
        amount: 'ARS 350.000,00',
        concept: 'alquiler de octubre de 2026',
        agency: 'Inmo Demo',
      },
      personId: 'p-inq',
      relatedType: 'Receipt',
      relatedId: RECEIPT_ID,
      idempotencyKey: `Receipt:${RECEIPT_ID}:Email`,
      createdByUserId: 'u-1',
    });
    expect(item).toMatchObject({ id: 'm-1', status: 'Pending', statusReason: 'MESSAGING_OFF' });
  });

  it('un recibo de una cuota de honorarios va a quien paga el honorario', async () => {
    const { service, outbox } = build({
      receipt: {
        ...rentReceipt,
        payment: null,
        feeInstallment: { n: 2, fee: { kind: 'AltaAlquiler', installments: 3, payer: inquilina } },
      },
    });
    await service.send({ kind: 'Receipt', id: RECEIPT_ID, channel: 'WhatsApp' });
    expect(outbox.enqueue.mock.calls[0][1]).toMatchObject({
      channel: 'WhatsApp',
      personId: 'p-inq',
      vars: { concept: 'Honorarios de alta de alquiler, cuota 2/3' },
      idempotencyKey: `Receipt:${RECEIPT_ID}:WhatsApp`,
    });
  });

  it('un recibo sin inquilino ni pagador no tiene destinatario', async () => {
    const { service } = build({
      receipt: { ...rentReceipt, payment: { ...rentReceipt.payment, liquidacion: { ...rentReceipt.payment.liquidacion, contract: { persons: [] } } } },
    });
    await expect(service.send({ kind: 'Receipt', id: RECEIPT_ID, channel: 'Email' })).rejects.toMatchObject({
      response: { error: 'NO_RECIPIENT' },
    });
  });

  it('un recibo inexistente es 404', async () => {
    await expect(build().service.send({ kind: 'Receipt', id: RECEIPT_ID, channel: 'Email' })).rejects.toMatchObject({
      response: { error: 'RECEIPT_NOT_FOUND' },
    });
  });

  it('un estado de cuenta emitido va al locador con el saldo de cierre', async () => {
    const { service, outbox } = build({
      statement: {
        id: STATEMENT_ID,
        status: 'Emitido',
        period: new Date('2026-10-01T00:00:00Z'),
        currency: 'USD',
        closing: new Prisma.Decimal('1200.5'),
        person: { id: 'p-loc', firstName: 'Ana', lastName: 'Locadora', email: 'ana@example.com', phone: null },
      },
    });
    await service.send({ kind: 'OwnerStatement', id: STATEMENT_ID, channel: 'Email' });
    expect(outbox.enqueue.mock.calls[0][1]).toMatchObject({
      templateKey: 'owner_statement',
      personId: 'p-loc',
      relatedType: 'OwnerStatement',
      vars: { name: 'Ana', period: 'octubre de 2026', closing: 'USD 1.200,50', agency: 'Inmo Demo' },
      idempotencyKey: `OwnerStatement:${STATEMENT_ID}:Email`,
    });
  });

  it('un borrador o un anulado no se mandan; uno inexistente es 404', async () => {
    const borrador = build({ statement: { id: STATEMENT_ID, status: 'Borrador', person: inquilina } });
    await expect(borrador.service.send({ kind: 'OwnerStatement', id: STATEMENT_ID, channel: 'Email' })).rejects.toMatchObject({
      response: { error: 'OWNER_STATEMENT_NOT_ISSUED', status: 'Borrador' },
    });
    await expect(build().service.send({ kind: 'OwnerStatement', id: STATEMENT_ID, channel: 'Email' })).rejects.toMatchObject({
      response: { error: 'OWNER_STATEMENT_NOT_FOUND' },
    });
  });

  it('valida el pedido', async () => {
    await expect(build().service.send({ kind: 'Liquidacion', id: RECEIPT_ID, channel: 'Email' })).rejects.toMatchObject({
      response: { error: 'VALIDATION_ERROR' },
    });
  });
});
