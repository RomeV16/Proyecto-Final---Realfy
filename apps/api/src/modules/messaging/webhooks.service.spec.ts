import { WebhooksService } from './webhooks.service';
import { ConsentsService } from './consents.service';

function build(opts: { outbox?: any[]; persons?: any[]; staff?: any[]; tenants?: any[]; slug?: string } = {}) {
  const outbox = opts.outbox ?? [];
  const inbound: any[] = [];
  const consents: any[] = [];
  const base: any = {
    messageOutbox: {
      findUnique: jest.fn(async ({ where }: any) => outbox.find((m) => m.providerMsgId === where.providerMsgId) ?? null),
      findFirst: jest.fn(async ({ where }: any) =>
        outbox
          .filter((m) => m.channel === where.channel && m.to === where.to && m.status !== 'Pending')
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => Object.assign(outbox.find((m) => m.id === where.id), data)),
    },
    inboundMessage: {
      createMany: jest.fn(async ({ data }: any) => {
        let count = 0;
        for (const d of data) {
          if (inbound.some((i) => i.providerMsgId === d.providerMsgId)) continue;
          inbound.push(d);
          count++;
        }
        return { count };
      }),
    },
    contactConsent: { createMany: jest.fn(async ({ data }: any) => consents.push(...data)) },
    user: { findMany: jest.fn().mockResolvedValue(opts.staff ?? [{ id: 'u-admin' }]) },
    tenant: { findMany: jest.fn().mockResolvedValue(opts.tenants ?? []) },
    $queryRaw: jest.fn().mockResolvedValue(opts.persons ?? []),
  };
  const prisma: any = { baseClient: base };
  const notifications = { createNotification: jest.fn().mockResolvedValue({ id: 'n' }) };
  const consentsService = new ConsentsService(prisma, {} as any);
  const inboxIngest = { receiveStored: jest.fn().mockResolvedValue({ conversationId: 'c-1', created: true, reopened: false }) };
  const config = { inbox: { whatsappTenantSlug: opts.slug } };
  const service = new WebhooksService(prisma, consentsService, notifications as any, inboxIngest as any, config as any);
  return { service, outbox, inbound, consents, base, notifications, inboxIngest };
}

const sent = (over: Record<string, unknown> = {}) => ({
  id: 'm-1',
  tenantId: 't-1',
  channel: 'WhatsApp',
  to: '5493515550101',
  personId: 'p-1',
  status: 'Sent',
  providerMsgId: 'wamid.1',
  createdAt: new Date('2026-11-01T12:00:00Z'),
  ...over,
});

const waPayload = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1000000001' }, ...value } }] }],
});

describe('WebhooksService: WhatsApp', () => {
  it('actualiza el estado de entrega por el id del proveedor, sin retroceder', async () => {
    const { service, outbox } = build({ outbox: [sent()] });
    await service.handleWhatsApp(waPayload({ statuses: [{ id: 'wamid.1', status: 'read', timestamp: '1762100000' }] }), '1000000001');
    expect(outbox[0]).toMatchObject({ status: 'Read', deliveredAt: new Date(1762100000 * 1000) });
    // Un "delivered" que llega tarde no lo vuelve atrás.
    await service.handleWhatsApp(waPayload({ statuses: [{ id: 'wamid.1', status: 'delivered', timestamp: '1762099000' }] }), '1000000001');
    expect(outbox[0].status).toBe('Read');
  });

  it('un fallo informado por Meta deja el mensaje fallido con el código', async () => {
    const { service, outbox } = build({ outbox: [sent()] });
    await service.handleWhatsApp(
      waPayload({ statuses: [{ id: 'wamid.1', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] }] }),
      '1000000001',
    );
    expect(outbox[0]).toMatchObject({ status: 'Failed', error: 'WHATSAPP_131026: Message undeliverable' });
  });

  it('ignora el número de otro ambiente, otros campos y ids desconocidos', async () => {
    const { service, base } = build({ outbox: [sent()] });
    await service.handleWhatsApp(waPayload({ statuses: [{ id: 'wamid.1', status: 'read' }] }), '9999');
    await service.handleWhatsApp({ entry: [{ changes: [{ field: 'account_update', value: {} }] }] }, '1000000001');
    await service.handleWhatsApp(waPayload({ statuses: [{ id: 'wamid.otro', status: 'read' }] }), '1000000001');
    await service.handleWhatsApp(null, undefined);
    expect(base.messageOutbox.update).not.toHaveBeenCalled();
  });

  it('BAJA registra la baja de la dirección y de la persona, y avisa a la gerencia', async () => {
    const { service, inbound, consents, notifications } = build({
      outbox: [sent()],
      persons: [{ id: 'p-2', phone: '351 555-0101', phone2: null }],
    });
    await service.handleWhatsApp(
      waPayload({ messages: [{ id: 'wamid.in1', from: '5493515550101', timestamp: '1762100000', type: 'text', text: { body: ' baja ' } }] }),
      '1000000001',
    );
    expect(inbound).toEqual([
      expect.objectContaining({ tenantId: 't-1', from: '5493515550101', personId: 'p-1', body: ' baja ', providerMsgId: 'wamid.in1' }),
    ]);
    expect(consents.map((c) => [c.personId, c.status, c.source, c.address])).toEqual([
      ['p-1', 'OptOut', 'Inbound', '5493515550101'],
      ['p-2', 'OptOut', 'Inbound', '5493515550101'],
    ]);
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-1', userId: 'u-admin', type: 'ContactOptedOut' }),
    );
  });

  it('un mensaje repetido por Meta se procesa una sola vez', async () => {
    const { service, consents, inbound } = build({ outbox: [sent()] });
    const payload = waPayload({ messages: [{ id: 'wamid.in2', from: '5493515550101', type: 'text', text: { body: 'STOP' } }] });
    await service.handleWhatsApp(payload, '1000000001');
    await service.handleWhatsApp(payload, '1000000001');
    expect(inbound).toHaveLength(1);
    expect(consents).toHaveLength(1);
  });

  it('otro texto se guarda y pasa a la bandeja de consultas, con el nombre del perfil', async () => {
    const { service, consents, inbound, inboxIngest, notifications } = build({ outbox: [sent()] });
    await service.handleWhatsApp(
      waPayload({
        contacts: [{ wa_id: '5493515550101', profile: { name: 'Iris Demo' } }],
        messages: [{ id: 'wamid.in3', from: '5493515550101', type: 'image', timestamp: '1762100000' }],
      }),
      '1000000001',
    );
    expect(inbound[0].body).toBe('[image]');
    expect(consents).toHaveLength(0);
    expect(inboxIngest.receiveStored).toHaveBeenCalledWith('t-1', 'wamid.in3', {
      channel: 'WhatsApp',
      address: '5493515550101',
      name: 'Iris Demo',
      body: '[image]',
      at: new Date(1762100000 * 1000),
      personId: 'p-1',
    });
    // El aviso lo da la bandeja de consultas, no el webhook.
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('un reintento de Meta vuelve a intentar llegar a la bandeja (es idempotente), pero no repite una baja', async () => {
    const { service, inboxIngest } = build({ outbox: [sent()] });
    const text = waPayload({ messages: [{ id: 'wamid.in5', from: '5493515550101', type: 'text', text: { body: 'hola' } }] });
    await service.handleWhatsApp(text, '1000000001');
    await service.handleWhatsApp(text, '1000000001');
    expect(inboxIngest.receiveStored).toHaveBeenCalledTimes(2);
  });

  it('un número al que nunca se le escribió se descarta si no se sabe de qué inmobiliaria es', async () => {
    const { service, inbound, inboxIngest } = build({ outbox: [sent({ to: '5491100000000' })], tenants: [{ id: 'a' }, { id: 'b' }] });
    await service.handleWhatsApp(
      waPayload({ messages: [{ id: 'wamid.in4', from: '5493515550101', text: { body: 'BAJA' } }] }),
      '1000000001',
    );
    expect(inbound).toHaveLength(0);
    expect(inboxIngest.receiveStored).not.toHaveBeenCalled();
  });

  it('una consulta nueva de un número desconocido va a la única inmobiliaria activa', async () => {
    const { service, inbound, inboxIngest, base } = build({ tenants: [{ id: 't-solo' }] });
    await service.handleWhatsApp(
      waPayload({ messages: [{ id: 'wamid.in6', from: '5493515550199', type: 'text', text: { body: 'Hola, ¿sigue disponible?' } }] }),
      '1000000001',
    );
    expect(inbound[0]).toMatchObject({ tenantId: 't-solo', personId: null });
    expect(inboxIngest.receiveStored).toHaveBeenCalledWith('t-solo', 'wamid.in6', expect.objectContaining({ address: '5493515550199', name: null }));
    expect(base.tenant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
  });

  it('con WHATSAPP_TENANT_SLUG se busca esa inmobiliaria', async () => {
    const { service, base } = build({ tenants: [{ id: 't-slug' }], slug: 'demo' });
    await service.handleWhatsApp(
      waPayload({ messages: [{ id: 'wamid.in7', from: '5493515550198', type: 'text', text: { body: 'Hola' } }] }),
      '1000000001',
    );
    expect(base.tenant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true, slug: 'demo' } }));
  });
});

describe('WebhooksService: Resend', () => {
  const email = (over: Record<string, unknown> = {}) =>
    sent({ channel: 'Email', to: 'iris@example.com', providerMsgId: 'em_1', ...over });

  it('entregado y rebotado cambian el estado del mensaje', async () => {
    const { service, outbox } = build({ outbox: [email()] });
    await service.handleResend({ type: 'email.delivered', created_at: '2026-11-02T15:00:00Z', data: { email_id: 'em_1' } });
    expect(outbox[0]).toMatchObject({ status: 'Delivered', deliveredAt: new Date('2026-11-02T15:00:00Z') });

    const bounced = build({ outbox: [email()] });
    await bounced.service.handleResend({ type: 'email.bounced', data: { email_id: 'em_1', bounce: { message: 'Mailbox does not exist' } } });
    expect(bounced.outbox[0]).toMatchObject({ status: 'Failed', error: 'BOUNCED: Mailbox does not exist' });
  });

  it('un rebote después de entregado no lo pisa; un tipo desconocido no hace nada', async () => {
    const { service, outbox, base } = build({ outbox: [email({ status: 'Delivered' })] });
    await service.handleResend({ type: 'email.bounced', data: { email_id: 'em_1' } });
    await service.handleResend({ type: 'email.opened', data: { email_id: 'em_1' } });
    await service.handleResend({ type: 'email.delivered', data: {} });
    expect(outbox[0].status).toBe('Delivered');
    expect(base.messageOutbox.update).not.toHaveBeenCalled();
  });

  it('una queja de spam es una baja del mail de esa persona', async () => {
    const { service, consents } = build({ outbox: [email()] });
    await service.handleResend({ type: 'email.complained', data: { email_id: 'em_1' } });
    expect(consents).toEqual([
      expect.objectContaining({ tenantId: 't-1', personId: 'p-1', channel: 'Email', status: 'OptOut', source: 'Complaint', address: 'iris@example.com' }),
    ]);
    const none = build();
    await none.service.handleResend({ type: 'email.complained', data: { email_id: 'em_x' } });
    expect(none.consents).toHaveLength(0);
  });
});
