import { AsyncLocalStorage } from 'async_hooks';
import { ClsService } from 'nestjs-cls';
import { DEFAULT_OPERATIONAL_DEFAULTS } from '@realfy/shared';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { InboxIngestService, type InboundInput } from './inbox-ingest.service';

const TENANT = 't-1';
const AT = new Date('2026-11-03T13:00:00Z'); // martes 10:00 en Buenos Aires

interface Opts {
  thread?: Record<string, unknown> | null;
  lead?: Record<string, unknown> | null;
  user?: { id: string } | null;
  person?: { id: string } | null;
  rawPersons?: { id: string; phone: string | null; phone2: string | null }[];
  inbox?: Record<string, unknown>;
  route?: { ok: true; route: { channel: string; to: string } } | { ok: false; error: string };
  enqueueCreated?: boolean;
  staff?: { id: string }[];
  inboundRow?: { id: string; conversationMessage: { id: string } | null } | null;
}

function build(opts: Opts = {}) {
  let created: Record<string, unknown> = {};
  const tx = {
    conversation: {
      create: jest.fn(async ({ data }: any) => {
        created = data;
        return { id: 'c-new' };
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    conversationMessage: { create: jest.fn().mockResolvedValue({}) },
  };
  const client = {
    conversation: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.channel) return opts.thread ?? null;
        // Recarga de la consulta tras guardar el mensaje: la existente o la que se acaba de crear.
        if (opts.thread) return { ...opts.thread, channel: 'WhatsApp', address: '5493515550101', counterpartName: 'Iris Demo', subject: null };
        return { id: where.id, ...created };
      }),
    },
    lead: { findFirst: jest.fn().mockResolvedValue(opts.lead ?? null) },
    user: { findFirst: jest.fn().mockResolvedValue(opts.user ?? null) },
    person: { findFirst: jest.fn().mockResolvedValue(opts.person ?? null) },
    inboundMessage: { findFirst: jest.fn().mockResolvedValue(opts.inboundRow ?? null) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const base = {
    $queryRaw: jest.fn().mockResolvedValue(opts.rawPersons ?? []),
    tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Inmobiliaria Demo' }) },
    user: { findMany: jest.fn().mockResolvedValue(opts.staff ?? [{ id: 'u-admin' }]) },
  };
  const prisma = { client, baseClient: base };
  const cls = new ClsService(new AsyncLocalStorage());
  const tenantContext = new TenantContextService(cls);
  const inbox = { ...DEFAULT_OPERATIONAL_DEFAULTS.inbox, ...(opts.inbox ?? {}) };
  const defaults = { get: jest.fn().mockResolvedValue({ ...DEFAULT_OPERATIONAL_DEFAULTS, inbox }) };
  const outbound = {
    resolveRoute: jest.fn().mockResolvedValue(opts.route ?? { ok: true, route: { channel: 'WhatsApp', to: '5493515550101' } }),
    enqueue: jest.fn().mockResolvedValue({ id: 'ob-1', status: 'Pending', statusReason: null, created: opts.enqueueCreated ?? true }),
  };
  const notifications = { createNotification: jest.fn().mockResolvedValue({ id: 'n' }) };
  const service = new InboxIngestService(prisma as never, cls, tenantContext, defaults as never, outbound as never, notifications as never);
  return { service, client, base, tx, outbound, notifications, tenantContext, defaults };
}

const wa = (over: Partial<InboundInput> = {}): InboundInput => ({
  channel: 'WhatsApp' as never,
  address: '5493515550101',
  name: 'Iris Demo',
  body: 'Hola, ¿sigue disponible el depto?',
  at: AT,
  ...over,
});

describe('InboxIngestService: abrir una consulta', () => {
  it('abre una consulta nueva sin responsable, con plazo de 15 minutos y mensaje entrante', async () => {
    const { service, tx, notifications } = build();
    const result = await service.receive(TENANT, wa({ inboundMessageId: 'in-1' }));
    expect(result).toEqual({ conversationId: 'c-new', created: true, reopened: false });
    expect(tx.conversation.create.mock.calls[0][0].data).toMatchObject({
      channel: 'WhatsApp',
      address: '5493515550101',
      counterpartName: 'Iris Demo',
      status: 'Nueva',
      assigneeUserId: null,
      firstResponseAt: null,
      slaDueAt: new Date('2026-11-03T13:15:00Z'),
      unread: 1,
      lastMessageAt: AT,
    });
    expect(tx.conversationMessage.create.mock.calls[0][0].data).toMatchObject({
      conversationId: 'c-new',
      direction: 'In',
      body: 'Hola, ¿sigue disponible el depto?',
      inboundMessageId: 'in-1',
    });
    // Sin responsable: aviso a Admin y Gerente.
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, userId: 'u-admin', type: 'InboundMessageReceived', entityType: 'Conversation' }),
    );
  });

  it('corre dentro del contexto de la inmobiliaria que se le indica', async () => {
    const { service, tenantContext, defaults } = build();
    defaults.get.mockImplementation(async (id: string) => {
      expect(id).toBe(TENANT);
      expect(tenantContext.getTenantId()).toBe(TENANT);
      return { ...DEFAULT_OPERATIONAL_DEFAULTS };
    });
    await service.receive(TENANT, wa());
    expect(defaults.get).toHaveBeenCalled();
  });

  it('toma como responsable al del interés de la persona y avisa a esa persona', async () => {
    const { service, tx, notifications, client } = build({
      lead: { id: 'lead-1', assignedToUserId: 'u-ventas' },
      user: { id: 'u-ventas' },
    });
    await service.receive(TENANT, wa({ personId: 'p-1' }));
    expect(client.lead.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { personId: 'p-1', isActive: true } }));
    expect(tx.conversation.create.mock.calls[0][0].data).toMatchObject({
      personId: 'p-1',
      leadId: 'lead-1',
      assigneeUserId: 'u-ventas',
      status: 'Asignada',
    });
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-ventas', type: 'InboxAssigned' }),
    );
  });

  it('usa el interés indicado, y el responsable por defecto de la configuración si no hay otro', async () => {
    const { service, tx, client } = build({
      lead: { id: 'lead-9', assignedToUserId: null },
      user: { id: 'u-def' },
      inbox: { defaultAssigneeUserId: 'u-def' },
    });
    await service.receive(TENANT, wa({ leadId: 'lead-9' }));
    expect(client.lead.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'lead-9' } }));
    expect(client.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u-def', isActive: true } }));
    expect(tx.conversation.create.mock.calls[0][0].data).toMatchObject({ leadId: 'lead-9', assigneeUserId: 'u-def' });
  });

  it('un responsable inactivo o de otra inmobiliaria se ignora', async () => {
    const { service, tx } = build({ user: null });
    await service.receive(TENANT, wa({ assigneeUserId: 'u-viejo' }));
    expect(tx.conversation.create.mock.calls[0][0].data).toMatchObject({ assigneeUserId: null, status: 'Nueva' });
  });

  it('una llamada ya atendida nace en curso, con primera respuesta y sin plazo ni autorrespuesta', async () => {
    const { service, tx, notifications, outbound } = build({ user: { id: 'u-1' } });
    await service.receive(
      TENANT,
      wa({ channel: 'Telefono' as never, answered: true, assigneeUserId: 'u-1', authorUserId: 'u-1', autoreply: false }),
    );
    expect(tx.conversation.create.mock.calls[0][0].data).toMatchObject({
      status: 'EnCurso',
      firstResponseAt: AT,
      slaDueAt: null,
      unread: 0,
    });
    expect(tx.conversationMessage.create.mock.calls[0][0].data.authorUserId).toBe('u-1');
    expect(notifications.createNotification).not.toHaveBeenCalled();
    expect(outbound.enqueue).not.toHaveBeenCalled();
  });

  it('fuera del horario de atención el plazo corre desde que abre', async () => {
    const { service, tx } = build();
    await service.receive(TENANT, wa({ at: new Date('2026-11-07T15:00:00Z') })); // sábado
    expect(tx.conversation.create.mock.calls[0][0].data.slaDueAt).toEqual(new Date('2026-11-09T12:15:00Z'));
  });
});

describe('InboxIngestService: hilos', () => {
  const thread = (over: Record<string, unknown> = {}) => ({
    id: 'c-old',
    status: 'Asignada',
    assigneeUserId: 'u-1',
    personId: null,
    lastMessageAt: new Date('2026-11-03T12:00:00Z'),
    ...over,
  });

  it('busca el hilo por inmobiliaria, canal y dirección dentro de la ventana', async () => {
    const { service, client } = build({ thread: thread() });
    await service.receive(TENANT, wa());
    expect(client.conversation.findFirst.mock.calls[0][0].where).toEqual({
      channel: 'WhatsApp',
      address: '5493515550101',
      status: { not: 'Archivada' },
      lastMessageAt: { gte: new Date(AT.getTime() - 72 * 3_600_000) },
    });
  });

  it('un mensaje nuevo se suma al hilo abierto, suma un sin leer y no abre otra consulta ni otra autorrespuesta', async () => {
    const { service, tx, outbound } = build({ thread: thread() });
    const result = await service.receive(TENANT, wa({ personId: 'p-9' }));
    expect(result).toEqual({ conversationId: 'c-old', created: false, reopened: false });
    expect(tx.conversation.create).not.toHaveBeenCalled();
    expect(tx.conversationMessage.create.mock.calls[0][0].data).toMatchObject({ conversationId: 'c-old', direction: 'In' });
    expect(tx.conversation.update.mock.calls[0][0]).toEqual({
      where: { id: 'c-old' },
      data: { unread: { increment: 1 }, lastMessageAt: AT, personId: 'p-9' },
    });
    expect(outbound.enqueue).not.toHaveBeenCalled();
  });

  it('una consulta en espera del cliente vuelve a en curso cuando contesta', async () => {
    const { service, tx } = build({ thread: thread({ status: 'Esperando' }) });
    await service.receive(TENANT, wa());
    expect(tx.conversation.update.mock.calls[0][0].data.status).toBe('EnCurso');
  });

  it('una consulta resuelta que vuelve a escribir se reabre con un plazo nuevo', async () => {
    const { service, tx, notifications } = build({ thread: thread({ status: 'Resuelta' }) });
    const result = await service.receive(TENANT, wa());
    expect(result.reopened).toBe(true);
    expect(tx.conversation.update.mock.calls[0][0].data).toMatchObject({
      status: 'Asignada',
      firstResponseAt: null,
      slaBreachedAt: null,
      slaDueAt: new Date('2026-11-03T13:15:00Z'),
    });
    expect(notifications.createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-1', type: 'InboxAssigned' }));
  });

  it('una resuelta sin responsable se reabre como nueva', async () => {
    const { service, tx } = build({ thread: thread({ status: 'Resuelta', assigneeUserId: null }) });
    await service.receive(TENANT, wa());
    expect(tx.conversation.update.mock.calls[0][0].data.status).toBe('Nueva');
  });

  it('un mensaje viejo que llega tarde no atrasa la última actividad', async () => {
    const { service, tx } = build({ thread: thread({ lastMessageAt: new Date('2026-11-03T14:00:00Z') }) });
    await service.receive(TENANT, wa());
    expect(tx.conversation.update.mock.calls[0][0].data.lastMessageAt).toEqual(new Date('2026-11-03T14:00:00Z'));
  });

  it('avisa al responsable de cada mensaje nuevo del hilo', async () => {
    const { service, notifications } = build({ thread: thread() });
    await service.receive(TENANT, wa());
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', type: 'InboundMessageReceived', title: 'Nuevo mensaje en una consulta' }),
    );
  });

  it('una llamada atendida que se suma a un hilo no suma sin leer', async () => {
    const { service, tx, notifications } = build({ thread: thread() });
    await service.receive(TENANT, wa({ answered: true, autoreply: false }));
    expect(tx.conversation.update.mock.calls[0][0].data.unread).toBeUndefined();
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });
});

describe('InboxIngestService: autorrespuesta', () => {
  it('encola una sola autorrespuesta por consulta, con el texto de la configuración y la clave de la consulta', async () => {
    const { service, outbound, tx } = build();
    await service.receive(TENANT, wa());
    expect(outbound.enqueue).toHaveBeenCalledTimes(1);
    const arg = outbound.enqueue.mock.calls[0][1];
    expect(arg).toMatchObject({
      route: { channel: 'WhatsApp', to: '5493515550101' },
      subject: 'Recibimos tu consulta - Inmobiliaria Demo',
      agency: 'Inmobiliaria Demo',
      idempotencyKey: 'inbox-autoreply:c-new',
    });
    expect(arg.text).toBe(
      'Hola Iris, gracias por escribirnos a Inmobiliaria Demo. Recibimos tu consulta y te respondemos a la brevedad.',
    );
    // La autorrespuesta queda en el hilo, atada a su mensaje de salida, y no detiene el plazo.
    const stored = tx.conversationMessage.create.mock.calls.at(-1)![0].data;
    expect(stored).toMatchObject({ direction: 'Out', isAutoReply: true, outboxMessageId: 'ob-1' });
    expect(tx.conversation.update).toHaveBeenCalledWith({ where: { id: 'c-new' }, data: { autoRepliedAt: expect.any(Date) } });
    expect(tx.conversation.create.mock.calls[0][0].data.firstResponseAt).toBeNull();
  });

  it('si la clave ya existía no vuelve a registrar el mensaje', async () => {
    const { service, tx } = build({ enqueueCreated: false });
    await service.receive(TENANT, wa());
    expect(tx.conversationMessage.create).toHaveBeenCalledTimes(1); // sólo el entrante
    expect(tx.conversation.update).not.toHaveBeenCalled();
  });

  it('apagada en la configuración no encola nada', async () => {
    const { service, outbound } = build({ inbox: { autoreply: { ...DEFAULT_OPERATIONAL_DEFAULTS.inbox.autoreply, enabled: false } } });
    await service.receive(TENANT, wa());
    expect(outbound.enqueue).not.toHaveBeenCalled();
  });

  it('no hay autorrespuesta por teléfono ni cuando se pidió omitirla', async () => {
    const { service, outbound } = build();
    await service.receive(TENANT, wa({ channel: 'Telefono' as never }));
    await service.receive(TENANT, wa({ autoreply: false }));
    expect(outbound.enqueue).not.toHaveBeenCalled();
  });

  it('no se le contesta a una casilla automática (evita autorrespuestas cruzadas)', async () => {
    const { service, outbound } = build();
    await service.receive(TENANT, wa({ channel: 'Email' as never, address: 'no-reply@proveedor.com' }));
    await service.receive(TENANT, wa({ channel: 'Email' as never, address: 'mailer-daemon@proveedor.com' }));
    expect(outbound.enqueue).not.toHaveBeenCalled();
  });

  it('si no hay por dónde contestar (baja, ventana cerrada) la consulta igual queda en la bandeja', async () => {
    const { service, outbound } = build({ route: { ok: false, error: 'CONTACT_OPTED_OUT' } });
    const result = await service.receive(TENANT, wa());
    expect(result.created).toBe(true);
    expect(outbound.enqueue).not.toHaveBeenCalled();
  });

  it('si el aviso o la autorrespuesta fallan, la consulta no se pierde', async () => {
    const { service, outbound } = build();
    outbound.enqueue.mockRejectedValueOnce(new Error('boom'));
    await expect(service.receive(TENANT, wa())).resolves.toMatchObject({ conversationId: 'c-new', created: true });
  });
});

describe('InboxIngestService.receiveStored', () => {
  it('completa un mensaje guardado que no llegó a la bandeja', async () => {
    const { service, tx } = build({ inboundRow: { id: 'in-7', conversationMessage: null } });
    const { inboundMessageId: _ignored, ...rest } = wa();
    await expect(service.receiveStored(TENANT, 'wamid.7', rest)).resolves.toMatchObject({ created: true });
    expect(tx.conversationMessage.create.mock.calls[0][0].data.inboundMessageId).toBe('in-7');
  });

  it('un mensaje que ya está en una consulta no se duplica', async () => {
    const { service, tx } = build({ inboundRow: { id: 'in-7', conversationMessage: { id: 'cm-1' } } });
    await expect(service.receiveStored(TENANT, 'wamid.7', wa())).resolves.toBeNull();
    expect(tx.conversationMessage.create).not.toHaveBeenCalled();
  });

  it('sin fila guardada no hace nada', async () => {
    const { service } = build({ inboundRow: null });
    await expect(service.receiveStored(TENANT, 'wamid.x', wa())).resolves.toBeNull();
  });
});

describe('InboxIngestService.matchPerson', () => {
  it('un mail se compara sin importar mayúsculas', async () => {
    const { service, client } = build({ person: { id: 'p-3' } });
    await expect(service.matchPerson(TENANT, 'Email' as never, 'iris@example.com')).resolves.toBe('p-3');
    expect(client.person.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { equals: 'iris@example.com', mode: 'insensitive' } } }),
    );
    await expect(service.matchPerson(TENANT, 'Email' as never, 'no es un mail@')).resolves.toBeNull();
  });

  it('un teléfono se compara con la normalización de calidad de datos (+54 9 vs 0351 15)', async () => {
    const { service, base } = build({
      rawPersons: [
        { id: 'p-a', phone: '4999999', phone2: null },
        { id: 'p-b', phone: '0351 15 555-0101', phone2: null },
      ],
    });
    await expect(service.matchPerson(TENANT, 'WhatsApp' as never, '5493515550101')).resolves.toBe('p-b');
    expect(base.$queryRaw).toHaveBeenCalled();
  });

  it('sin coincidencia o sin número válido da null', async () => {
    const { service } = build({ rawPersons: [] });
    await expect(service.matchPerson(TENANT, 'WhatsApp' as never, '5493515550101')).resolves.toBeNull();
    await expect(service.matchPerson(TENANT, 'WhatsApp' as never, '12')).resolves.toBeNull();
  });

  it('una consulta nueva sin persona indicada busca a la persona por su dirección', async () => {
    const { service, tx } = build({ rawPersons: [{ id: 'p-z', phone: null, phone2: '351-555-0101' }] });
    await service.receive(TENANT, wa());
    expect(tx.conversation.create.mock.calls[0][0].data.personId).toBe('p-z');
  });
});
