import { InboxEmailService } from './inbox-email.service';

const valid = {
  tenantSlug: 'demo',
  messageId: '<abc123@mail.example>',
  from: 'Iris@Example.com',
  fromName: 'Iris Demo',
  subject: 'Consulta por el departamento',
  text: '  Hola, ¿sigue disponible?  ',
  receivedAt: '2026-11-03T12:00:00Z',
};

function build(opts: { tenant?: { id: string } | null } = {}) {
  const base = {
    tenant: { findFirst: jest.fn().mockResolvedValue(opts.tenant === undefined ? { id: 't-1' } : opts.tenant) },
    inboundMessage: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const ingest = { receiveStored: jest.fn().mockResolvedValue({ conversationId: 'c-1', created: true, reopened: false }) };
  const service = new InboxEmailService({ baseClient: base } as never, ingest as never);
  return { service, base, ingest };
}

describe('InboxEmailService.ingestEmail', () => {
  it('guarda el mail con su Message-ID por inmobiliaria y lo pasa a la bandeja', async () => {
    const { service, base, ingest } = build();
    await expect(service.ingestEmail(valid)).resolves.toEqual({ received: true });
    expect(base.tenant.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'demo', isActive: true } }));
    expect(base.inboundMessage.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenantId: 't-1',
          channel: 'Email',
          from: 'iris@example.com',
          body: 'Hola, ¿sigue disponible?',
          providerMsgId: 'email:t-1:<abc123@mail.example>',
          receivedAt: new Date('2026-11-03T12:00:00Z'),
        },
      ],
      skipDuplicates: true,
    });
    expect(ingest.receiveStored).toHaveBeenCalledWith('t-1', 'email:t-1:<abc123@mail.example>', {
      channel: 'Email',
      address: 'iris@example.com',
      name: 'Iris Demo',
      subject: 'Consulta por el departamento',
      body: 'Hola, ¿sigue disponible?',
      at: new Date('2026-11-03T12:00:00Z'),
    });
  });

  it('sin nombre, asunto ni fecha usa valores neutros y recorta el texto', async () => {
    const { service, ingest } = build();
    await service.ingestEmail({ tenantSlug: 'demo', messageId: 'm', from: 'a@b.com', text: 'x'.repeat(9000) });
    const arg = ingest.receiveStored.mock.calls[0][2];
    expect(arg).toMatchObject({ name: null, subject: null });
    expect(arg.body).toHaveLength(4000);
    expect(arg.at).toBeInstanceOf(Date);
  });

  it('un mail automático no abre una consulta', async () => {
    const { service, base, ingest } = build();
    await expect(service.ingestEmail({ ...valid, automatic: true })).resolves.toEqual({ received: true, ignored: 'automatic' });
    await expect(service.ingestEmail({ ...valid, from: 'no-reply@proveedor.com' })).resolves.toEqual({ received: true, ignored: 'automatic' });
    await expect(service.ingestEmail({ ...valid, from: 'Mailer-Daemon@proveedor.com' })).resolves.toEqual({ received: true, ignored: 'automatic' });
    expect(base.inboundMessage.createMany).not.toHaveBeenCalled();
    expect(ingest.receiveStored).not.toHaveBeenCalled();
  });

  it('un remitente que no es un mail se descarta', async () => {
    const { service, ingest } = build();
    await expect(service.ingestEmail({ ...valid, from: 'sin-arroba' })).resolves.toEqual({ received: true, ignored: 'invalid-sender' });
    expect(ingest.receiveStored).not.toHaveBeenCalled();
  });

  it('una inmobiliaria desconocida da 404 y un cuerpo inválido 400', async () => {
    const a = build({ tenant: null });
    await expect(a.service.ingestEmail(valid)).rejects.toMatchObject({ status: 404 });
    const b = build();
    await expect(b.service.ingestEmail({ ...valid, messageId: '' })).rejects.toMatchObject({ status: 400 });
    await expect(b.service.ingestEmail(null)).rejects.toMatchObject({ status: 400 });
  });
});
