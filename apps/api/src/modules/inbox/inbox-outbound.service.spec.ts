import { InboxOutboundService, WHATSAPP_WINDOW_MS } from './inbox-outbound.service';

const NOW = new Date('2026-11-03T15:00:00Z');

interface Opts {
  person?: { email: string | null; phone: string | null } | null;
  /** Último mensaje entrante de WhatsApp por número. */
  windowOpenFor?: string[];
  /** Estado de consentimiento por "canal:dirección". */
  consents?: Record<string, 'OptIn' | 'OptOut'>;
}

function build(opts: Opts = {}) {
  const client = {
    person: { findFirst: jest.fn().mockResolvedValue(opts.person ?? null) },
    inboundMessage: {
      findFirst: jest.fn(async ({ where }: any) =>
        (opts.windowOpenFor ?? []).includes(where.from) && where.receivedAt.gte.getTime() === NOW.getTime() - WHATSAPP_WINDOW_MS
          ? { id: 'in-1' }
          : null,
      ),
    },
    contactConsent: {
      findFirst: jest.fn(async ({ where }: any) => {
        const key = `${where.channel}:${where.address ?? where.personId}`;
        const status = opts.consents?.[key];
        return status ? { id: 'c', status, at: new Date('2026-11-01T00:00:00Z') } : null;
      }),
    },
  };
  const outbox = { enqueue: jest.fn().mockResolvedValue({ id: 'ob-1', status: 'Pending', statusReason: null, created: true }) };
  const service = new InboxOutboundService({ client } as never, outbox as never);
  return { service, client, outbox };
}

const conv = (over: Record<string, unknown> = {}) => ({ id: 'c-1', channel: 'WhatsApp', address: '5493515550101', personId: null, ...over });

describe('InboxOutboundService.resolveRoute', () => {
  it('una consulta de WhatsApp se contesta por WhatsApp dentro de las 24 horas', async () => {
    const { service } = build({ windowOpenFor: ['5493515550101'] });
    await expect(service.resolveRoute(conv(), NOW)).resolves.toEqual({
      ok: true,
      route: { channel: 'WhatsApp', to: '5493515550101' },
    });
  });

  it('fuera de la ventana no hay texto libre: sin mail, se avisa que hay que llamar', async () => {
    const { service } = build();
    await expect(service.resolveRoute(conv(), NOW)).resolves.toEqual({ ok: false, error: 'WHATSAPP_WINDOW_CLOSED' });
  });

  it('fuera de la ventana pero con mail de la persona, sale por mail', async () => {
    const { service } = build({ person: { email: 'Iris@Example.com', phone: null } });
    await expect(service.resolveRoute(conv({ personId: 'p-1' }), NOW)).resolves.toEqual({
      ok: true,
      route: { channel: 'Email', to: 'iris@example.com' },
    });
  });

  it('un mail se contesta por mail', async () => {
    const { service, client } = build();
    await expect(service.resolveRoute(conv({ channel: 'Email', address: 'iris@example.com' }), NOW)).resolves.toEqual({
      ok: true,
      route: { channel: 'Email', to: 'iris@example.com' },
    });
    expect(client.person.findFirst).not.toHaveBeenCalled();
  });

  it('una consulta del sitio con mail sale por mail; con sólo teléfono, por WhatsApp si escribió hace menos de un día', async () => {
    const web = build({ windowOpenFor: ['5493515550101'] });
    await expect(web.service.resolveRoute(conv({ channel: 'Web', address: 'a@b.com' }), NOW)).resolves.toMatchObject({
      ok: true,
      route: { channel: 'Email' },
    });
    await expect(web.service.resolveRoute(conv({ channel: 'Web' }), NOW)).resolves.toMatchObject({
      ok: true,
      route: { channel: 'WhatsApp' },
    });
  });

  it('una llamada sin persona ni mail no tiene por dónde contestarse', async () => {
    const { service } = build();
    await expect(service.resolveRoute(conv({ channel: 'Telefono' }), NOW)).resolves.toEqual({
      ok: false,
      error: 'WHATSAPP_WINDOW_CLOSED',
    });
    await expect(service.resolveRoute(conv({ channel: 'Telefono', address: 'sin-numero' }), NOW)).resolves.toEqual({
      ok: false,
      error: 'NO_REPLY_CHANNEL',
    });
  });

  it('una baja se respeta en el canal; si queda otro canal viable, se usa ese', async () => {
    const { service } = build({
      person: { email: 'iris@example.com', phone: '5493515550101' },
      windowOpenFor: ['5493515550101'],
      consents: { 'WhatsApp:5493515550101': 'OptOut' },
    });
    await expect(service.resolveRoute(conv({ personId: 'p-1' }), NOW)).resolves.toMatchObject({
      ok: true,
      route: { channel: 'Email', to: 'iris@example.com' },
    });
  });

  it('con baja en todos los canales no se contesta', async () => {
    const { service } = build({
      person: { email: 'iris@example.com', phone: null },
      windowOpenFor: ['5493515550101'],
      consents: { 'WhatsApp:5493515550101': 'OptOut', 'Email:iris@example.com': 'OptOut' },
    });
    await expect(service.resolveRoute(conv({ personId: 'p-1' }), NOW)).resolves.toEqual({ ok: false, error: 'CONTACT_OPTED_OUT' });
  });
});

describe('InboxOutboundService.enqueue y replyKey', () => {
  it('encola el texto libre por el canal elegido, atado a la consulta', async () => {
    const { service, outbox } = build();
    const db = {};
    await service.enqueue(db, {
      conversation: conv({ personId: 'p-1' }),
      route: { channel: 'WhatsApp' as never, to: '5493515550101' },
      subject: 'Re: algo',
      text: 'Hola',
      agency: 'Inmobiliaria Demo',
      idempotencyKey: 'k',
      createdByUserId: 'u-1',
    });
    expect(outbox.enqueue).toHaveBeenCalledWith(db, {
      channel: 'WhatsApp',
      templateKey: 'inbox_message',
      vars: { subject: 'Re: algo', text: 'Hola', agency: 'Inmobiliaria Demo' },
      personId: 'p-1',
      to: '5493515550101',
      relatedType: 'Conversation',
      relatedId: 'c-1',
      idempotencyKey: 'k',
      createdByUserId: 'u-1',
    });
  });

  it('createdByUserId queda en null si no se indica', async () => {
    const { service, outbox } = build();
    await service.enqueue({}, { conversation: conv(), route: { channel: 'Email' as never, to: 'a@b.com' }, subject: 's', text: 't', agency: 'A', idempotencyKey: 'k' });
    expect(outbox.enqueue.mock.calls[0][1].createdByUserId).toBeNull();
  });

  it('la clave cambia con el texto y con el último mensaje, y se repite con un doble clic', () => {
    const { service } = build();
    const a = service.replyKey('c-1', 'm-1', 'Hola');
    expect(service.replyKey('c-1', 'm-1', 'Hola')).toBe(a);
    expect(service.replyKey('c-1', 'm-2', 'Hola')).not.toBe(a);
    expect(service.replyKey('c-1', 'm-1', 'Otro')).not.toBe(a);
    expect(service.replyKey('c-1', null, 'Hola')).toMatch(/^inbox-reply:c-1:[0-9a-f]{32}$/);
  });
});
