import { AsyncLocalStorage } from 'async_hooks';
import { ClsService } from 'nestjs-cls';
import { DEFAULT_OPERATIONAL_DEFAULTS } from '@realfy/shared';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { InboxService } from './inbox.service';

const TENANT = 't-1';
const USER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const CONV = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-03T13:00:00Z');

const conversation = (over: Record<string, unknown> = {}) => ({
  id: CONV,
  channel: 'WhatsApp',
  address: '5493515550101',
  counterpartName: 'Iris Demo',
  subject: null,
  status: 'Nueva',
  personId: null,
  leadId: null,
  relatedType: null,
  relatedId: null,
  assigneeUserId: null,
  firstResponseAt: null,
  slaDueAt: new Date('2026-11-03T13:15:00Z'),
  slaBreachedAt: null,
  unread: 1,
  lastMessageAt: NOW,
  ...over,
});

function build(opts: { conv?: Record<string, unknown> | null; route?: any; enqueueCreated?: boolean; found?: boolean; calls?: Record<string, unknown> } = {}) {
  const tx = {
    conversationMessage: { create: jest.fn().mockResolvedValue({}) },
    conversation: { update: jest.fn().mockResolvedValue({}) },
  };
  const client = {
    conversation: {
      findFirst: jest.fn().mockResolvedValue(opts.conv === undefined ? conversation() : opts.conv),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    conversationMessage: { findFirst: jest.fn().mockResolvedValue({ id: 'm-last' }) },
    user: { findFirst: jest.fn().mockResolvedValue(opts.found === false ? null : { id: USER }) },
    person: { findFirst: jest.fn().mockResolvedValue(opts.found === false ? null : { id: 'p-1' }) },
    lead: { findFirst: jest.fn().mockResolvedValue(opts.found === false ? null : { id: 'l-1' }) },
    property: { findFirst: jest.fn().mockResolvedValue(opts.found === false ? null : { id: 'pr-1' }) },
    contract: { findFirst: jest.fn().mockResolvedValue(opts.found === false ? null : { id: 'ct-1' }) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const base = { tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Inmobiliaria Demo' }) } };
  const cls = new ClsService(new AsyncLocalStorage());
  const tenantContext = new TenantContextService(cls);
  const store: { value: any } = { value: { ...DEFAULT_OPERATIONAL_DEFAULTS } };
  const defaults = {
    get: jest.fn(async () => store.value),
    set: jest.fn(async (_t: string, v: unknown) => {
      store.value = v;
      return v;
    }),
  };
  const ingest = { receiveInContext: jest.fn().mockResolvedValue({ conversationId: CONV, created: true, reopened: false }) };
  const outbound = {
    resolveRoute: jest.fn().mockResolvedValue(opts.route ?? { ok: true, route: { channel: 'WhatsApp', to: '5493515550101' } }),
    enqueue: jest.fn().mockResolvedValue({ id: 'ob-1', status: 'Pending', statusReason: 'MESSAGING_OFF', created: opts.enqueueCreated ?? true }),
    replyKey: jest.fn().mockReturnValue('key-1'),
  };
  const notifications = { createNotification: jest.fn().mockResolvedValue({ id: 'n' }) };
  const service = new InboxService(
    { client, baseClient: base } as never,
    tenantContext,
    defaults as never,
    ingest as never,
    outbound as never,
    notifications as never,
  );
  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    cls.run(async () => {
      tenantContext.setTenantId(TENANT);
      tenantContext.setUserId(USER);
      return fn();
    });
  return { service, client, tx, defaults, ingest, outbound, notifications, run, store, tenantContext };
}

describe('InboxService: configuración', () => {
  it('lee y reemplaza la configuración sin tocar el resto de los valores por defecto', async () => {
    const { service, run, store, client } = build();
    const current = await run(() => service.getSettings());
    expect(current.slaMinutes).toBe(15);
    const next = { ...current, slaMinutes: 30, defaultAssigneeUserId: USER };
    await expect(run(() => service.updateSettings(next))).resolves.toMatchObject({ slaMinutes: 30 });
    expect(client.user.findFirst).toHaveBeenCalled();
    expect(store.value.inbox.slaMinutes).toBe(30);
    expect(store.value.dueDay).toBe(DEFAULT_OPERATIONAL_DEFAULTS.dueDay);
  });

  it('rechaza una configuración inválida o un responsable por defecto inexistente', async () => {
    const a = build();
    await expect(a.run(() => a.service.updateSettings({ slaMinutes: 0 }))).rejects.toMatchObject({ status: 400 });
    const b = build({ found: false });
    await expect(b.run(() => b.service.updateSettings({ defaultAssigneeUserId: USER }))).rejects.toMatchObject({ status: 400 });
  });

  it('sin contexto de inmobiliaria no hace nada', async () => {
    const { service } = build();
    await expect(service.getSettings()).rejects.toMatchObject({ status: 403 });
  });
});

describe('InboxService.list', () => {
  it('arma los filtros: abiertas, canal, mis consultas, plazo vencido y búsqueda', async () => {
    const { service, client, run } = build();
    await run(() =>
      service.list({ open: 'true', channel: 'WhatsApp', assignee: 'me', slaBreached: 'true', search: 'iris', page: '2', limit: '10' }),
    );
    const args = client.conversation.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      status: { notIn: ['Resuelta', 'Archivada'] },
      channel: 'WhatsApp',
      assigneeUserId: USER,
      firstResponseAt: null,
      slaDueAt: { lte: expect.any(Date) },
    });
    expect(args.where.AND).toHaveLength(2);
    expect(args).toMatchObject({ skip: 10, take: 10, orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }] });
  });

  it('un estado explícito pesa más que "abiertas"; sin responsable y por id', async () => {
    const { service, client, run } = build();
    await run(() => service.list({ status: 'Resuelta', open: 'true', assignee: 'none' }));
    expect(client.conversation.findMany.mock.calls[0][0].where).toEqual({ status: 'Resuelta', assigneeUserId: null });
    await run(() => service.list({ assignee: OTHER }));
    expect(client.conversation.findMany.mock.calls[1][0].where).toEqual({ assigneeUserId: OTHER });
  });

  it('devuelve cada consulta con el responsable, el plazo y una vista previa', async () => {
    const { service, client, run } = build();
    client.conversation.findMany.mockResolvedValue([
      { ...conversation(), assignee: { firstName: 'Ana', lastName: 'Demo' }, messages: [{ body: 'x'.repeat(300) }] },
      { ...conversation({ id: 'c-2' }), assignee: null, messages: [] },
    ]);
    client.conversation.count.mockResolvedValue(2);
    const page = await run(() => service.list({}));
    expect(page).toMatchObject({ total: 2, page: 1, limit: 30, totalPages: 1 });
    expect(page.items[0]).toMatchObject({ assigneeName: 'Ana Demo', slaState: expect.any(String) });
    expect(page.items[0].preview).toHaveLength(140);
    expect(page.items[1]).toMatchObject({ assigneeName: null, preview: null });
  });

  it('rechaza filtros inválidos', async () => {
    const { service, run } = build();
    await expect(run(() => service.list({ limit: '9999' }))).rejects.toMatchObject({ status: 400 });
  });
});

describe('InboxService.summary', () => {
  it('cuenta sin leer (propias o sin responsable), plazo vencido y sin responsable entre las abiertas', async () => {
    const { service, client, run } = build();
    client.conversation.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2).mockResolvedValueOnce(5);
    await expect(run(() => service.summary())).resolves.toEqual({ unread: 4, breached: 2, unassigned: 5 });
    expect(client.conversation.count.mock.calls[0][0].where).toMatchObject({
      status: { notIn: ['Resuelta', 'Archivada'] },
      unread: { gt: 0 },
      OR: [{ assigneeUserId: USER }, { assigneeUserId: null }],
    });
  });
});

describe('InboxService.get y markRead', () => {
  it('devuelve el hilo con el estado de entrega y por dónde saldría una respuesta', async () => {
    const { service, client, run } = build();
    client.conversation.findFirst.mockResolvedValue({
      ...conversation({ relatedType: 'Property', relatedId: 'pr-1' }),
      assignee: { id: USER, firstName: 'Ana', lastName: 'Demo' },
      person: { id: 'p-1', firstName: 'Iris', lastName: 'Demo', email: null, phone: null },
      lead: null,
      messages: [
        { id: 'm1', direction: 'In', body: 'Hola', at: NOW, isAutoReply: false, authorUserId: null, outboxMessage: null },
        {
          id: 'm2',
          direction: 'Out',
          body: 'Gracias',
          at: NOW,
          isAutoReply: true,
          authorUserId: null,
          outboxMessage: { status: 'Pending', statusReason: 'MESSAGING_OFF', error: null, channel: 'WhatsApp' },
        },
      ],
    });
    const detail = await run(() => service.get(CONV));
    expect(detail).toMatchObject({
      assignee: { id: USER, name: 'Ana Demo' },
      related: { type: 'Property', id: 'pr-1' },
      replyRoute: { channel: 'WhatsApp', to: '5493515550101' },
      replyBlockedReason: null,
    });
    expect(detail.messages[1].delivery).toEqual({ status: 'Pending', reason: 'MESSAGING_OFF', error: null });
    expect(detail.messages[0].delivery).toBeNull();
  });

  it('si no se puede contestar, lo dice y no da ruta', async () => {
    const { service, client, run } = build({ route: { ok: false, error: 'WHATSAPP_WINDOW_CLOSED' } });
    client.conversation.findFirst.mockResolvedValue({ ...conversation(), assignee: null, person: null, lead: null, messages: [] });
    const detail = await run(() => service.get(CONV));
    expect(detail).toMatchObject({ replyRoute: null, replyBlockedReason: 'WHATSAPP_WINDOW_CLOSED', assignee: null, related: null });
  });

  it('una consulta que no existe (o es de otra inmobiliaria) da 404', async () => {
    const { service, run } = build({ conv: null });
    await expect(run(() => service.get(CONV))).rejects.toMatchObject({ status: 404 });
    await expect(run(() => service.markRead(CONV))).rejects.toMatchObject({ status: 404 });
  });

  it('marcar como leída deja el contador en cero', async () => {
    const { service, client, run } = build();
    await expect(run(() => service.markRead(CONV))).resolves.toEqual({ id: CONV, unread: 0 });
    expect(client.conversation.updateMany).toHaveBeenCalledWith({ where: { id: CONV, unread: { gt: 0 } }, data: { unread: 0 } });
  });
});

describe('InboxService.reply', () => {
  it('encola la respuesta, la registra en el hilo, toma la primera respuesta y deja la consulta esperando al cliente', async () => {
    const { service, tx, outbound, run } = build();
    const result = await run(() => service.reply(CONV, { body: '  Sí, está disponible  ' }));
    expect(result).toEqual({ outboxId: 'ob-1', status: 'Pending', statusReason: 'MESSAGING_OFF', channel: 'WhatsApp', queued: true });
    expect(outbound.enqueue.mock.calls[0][1]).toMatchObject({
      route: { channel: 'WhatsApp', to: '5493515550101' },
      subject: 'Re: tu consulta',
      text: 'Sí, está disponible',
      agency: 'Inmobiliaria Demo',
      idempotencyKey: 'key-1',
      createdByUserId: USER,
    });
    expect(tx.conversationMessage.create.mock.calls[0][0].data).toMatchObject({
      direction: 'Out',
      outboxMessageId: 'ob-1',
      authorUserId: USER,
      body: 'Sí, está disponible',
    });
    expect(tx.conversation.update.mock.calls[0][0].data).toMatchObject({
      firstResponseAt: expect.any(Date),
      unread: 0,
      status: 'Esperando',
      assigneeUserId: USER, // quien contesta una consulta sin responsable se la queda
    });
  });

  it('no pisa la primera respuesta ni el responsable que ya había, ni el estado de una consulta ya en espera', async () => {
    const first = new Date('2026-11-03T13:05:00Z');
    const { service, tx, run } = build({ conv: conversation({ status: 'Esperando', assigneeUserId: OTHER, firstResponseAt: first }) });
    await run(() => service.reply(CONV, { body: 'Hola', subject: 'Asunto propio' }));
    expect(tx.conversation.update.mock.calls[0][0].data).toMatchObject({ firstResponseAt: first, status: 'Esperando', assigneeUserId: OTHER });
  });

  it('el mismo envío repetido (doble clic) no agrega otro mensaje al hilo', async () => {
    const { service, tx, run } = build({ enqueueCreated: false });
    await expect(run(() => service.reply(CONV, { body: 'Hola' }))).resolves.toMatchObject({ queued: false });
    expect(tx.conversationMessage.create).not.toHaveBeenCalled();
    expect(tx.conversation.update).not.toHaveBeenCalled();
  });

  it('con el asunto de la consulta responde "Re: ..."', async () => {
    const { service, outbound, run } = build({ conv: conversation({ channel: 'Email', subject: 'Consulta por el depto' }) });
    await run(() => service.reply(CONV, { body: 'Hola' }));
    expect(outbound.enqueue.mock.calls[0][1].subject).toBe('Re: Consulta por el depto');
  });

  it.each(['CONTACT_OPTED_OUT', 'WHATSAPP_WINDOW_CLOSED', 'NO_REPLY_CHANNEL'])('si no hay ruta (%s) responde 409 con el motivo', async (error) => {
    const { service, outbound, run } = build({ route: { ok: false, error } });
    await expect(run(() => service.reply(CONV, { body: 'Hola' }))).rejects.toMatchObject({ status: 409, response: { error } });
    expect(outbound.enqueue).not.toHaveBeenCalled();
  });

  it('una consulta archivada no se contesta; una vacía o inexistente tampoco', async () => {
    const a = build({ conv: conversation({ status: 'Archivada' }) });
    await expect(a.run(() => a.service.reply(CONV, { body: 'Hola' }))).rejects.toMatchObject({ status: 409, response: { error: 'CONVERSATION_ARCHIVED' } });
    const b = build();
    await expect(b.run(() => b.service.reply(CONV, { body: ' ' }))).rejects.toMatchObject({ status: 400 });
    const c = build({ conv: null });
    await expect(c.run(() => c.service.reply(CONV, { body: 'Hola' }))).rejects.toMatchObject({ status: 404 });
  });
});

describe('InboxService: responsable, estado y vínculos', () => {
  it('asignar pasa una consulta nueva a asignada y avisa al nuevo responsable', async () => {
    const { service, client, notifications, run } = build();
    await expect(run(() => service.assign(CONV, { assigneeUserId: OTHER }))).resolves.toEqual({
      id: CONV,
      assigneeUserId: OTHER,
      status: 'Asignada',
    });
    expect(client.conversation.update).toHaveBeenCalledWith({ where: { id: CONV }, data: { assigneeUserId: OTHER, status: 'Asignada' } });
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OTHER, type: 'InboxAssigned', entityId: CONV }),
    );
  });

  it('asignarse a uno mismo no manda aviso; desasignar vuelve a nueva sólo si nadie atendió', async () => {
    const a = build();
    await a.run(() => a.service.assign(CONV, { assigneeUserId: USER }));
    expect(a.notifications.createNotification).not.toHaveBeenCalled();
    const b = build({ conv: conversation({ status: 'Asignada', assigneeUserId: USER }) });
    await expect(b.run(() => b.service.assign(CONV, { assigneeUserId: null }))).resolves.toMatchObject({ status: 'Nueva' });
    const c = build({ conv: conversation({ status: 'EnCurso', assigneeUserId: USER }) });
    await expect(c.run(() => c.service.assign(CONV, { assigneeUserId: null }))).resolves.toMatchObject({ status: 'EnCurso' });
  });

  it('un responsable inexistente o inválido se rechaza', async () => {
    const a = build({ found: false });
    await expect(a.run(() => a.service.assign(CONV, { assigneeUserId: OTHER }))).rejects.toMatchObject({ status: 400 });
    const b = build();
    await expect(b.run(() => b.service.assign(CONV, { assigneeUserId: 'no-es-uuid' }))).rejects.toMatchObject({ status: 400 });
  });

  it('cambiar el estado; cerrar la consulta limpia los sin leer', async () => {
    const { service, client, run } = build();
    await expect(run(() => service.changeStatus(CONV, { status: 'EnCurso' }))).resolves.toEqual({ id: CONV, status: 'EnCurso', previous: 'Nueva' });
    expect(client.conversation.update).toHaveBeenLastCalledWith({ where: { id: CONV }, data: { status: 'EnCurso' } });
    await run(() => service.changeStatus(CONV, { status: 'Resuelta' }));
    expect(client.conversation.update).toHaveBeenLastCalledWith({ where: { id: CONV }, data: { status: 'Resuelta', unread: 0 } });
    await expect(run(() => service.changeStatus(CONV, { status: 'Otra' }))).rejects.toMatchObject({ status: 400 });
  });

  it('vincula persona, interés y propiedad o contrato, y desvincula con null', async () => {
    const { service, client, run } = build();
    client.conversation.findFirst.mockResolvedValue({ ...conversation(), assignee: null, person: null, lead: null, messages: [] });
    await run(() =>
      service.link(CONV, {
        personId: '55555555-5555-4555-8555-555555555555',
        leadId: '66666666-6666-4666-8666-666666666666',
        related: { type: 'Contract', id: '77777777-7777-4777-8777-777777777777' },
      }),
    );
    expect(client.conversation.update.mock.calls[0][0].data).toEqual({
      personId: '55555555-5555-4555-8555-555555555555',
      leadId: '66666666-6666-4666-8666-666666666666',
      relatedType: 'Contract',
      relatedId: '77777777-7777-4777-8777-777777777777',
    });
    await run(() => service.link(CONV, { personId: null, leadId: null, related: null }));
    expect(client.conversation.update.mock.calls[1][0].data).toEqual({
      personId: null,
      leadId: null,
      relatedType: null,
      relatedId: null,
    });
    await run(() => service.link(CONV, { related: { type: 'Property', id: '77777777-7777-4777-8777-777777777777' } }));
    expect(client.property.findFirst).toHaveBeenCalled();
  });

  it('vincular con algo que no existe da 404 y sin campos da 400', async () => {
    const { service, run } = build({ found: false });
    const id = '55555555-5555-4555-8555-555555555555';
    await expect(run(() => service.link(CONV, { personId: id }))).rejects.toMatchObject({ status: 404, response: { error: 'PERSON_NOT_FOUND' } });
    await expect(run(() => service.link(CONV, { leadId: id }))).rejects.toMatchObject({ status: 404, response: { error: 'LEAD_NOT_FOUND' } });
    await expect(run(() => service.link(CONV, { related: { type: 'Property', id } }))).rejects.toMatchObject({
      status: 404,
      response: { error: 'PROPERTY_NOT_FOUND' },
    });
    await expect(run(() => service.link(CONV, { related: { type: 'Contract', id } }))).rejects.toMatchObject({
      status: 404,
      response: { error: 'CONTRACT_NOT_FOUND' },
    });
    await expect(run(() => service.link(CONV, {}))).rejects.toMatchObject({ status: 400 });
  });
});

describe('InboxService.registerCall', () => {
  it('anota la llamada como consulta de teléfono asignada a quien la registra', async () => {
    const { service, ingest, client, run } = build();
    client.conversation.findFirst.mockResolvedValue({ ...conversation({ channel: 'Telefono' }), assignee: null, person: null, lead: null, messages: [] });
    await run(() => service.registerCall({ name: 'Iris Demo', phone: '351 555-0101', summary: 'Quiere ver el depto', answered: false }));
    expect(ingest.receiveInContext).toHaveBeenCalledWith({
      channel: 'Telefono',
      address: '5493515550101',
      name: 'Iris Demo',
      subject: 'Llamada',
      body: 'Quiere ver el depto',
      at: expect.any(Date),
      relatedType: null,
      relatedId: null,
      assigneeUserId: USER,
      authorUserId: USER,
      answered: false,
      autoreply: false,
    });
  });

  it('con propiedad la valida y la vincula', async () => {
    const { service, ingest, client, run } = build();
    client.conversation.findFirst.mockResolvedValue({ ...conversation(), assignee: null, person: null, lead: null, messages: [] });
    const propertyId = '88888888-8888-4888-8888-888888888888';
    await run(() => service.registerCall({ name: 'Iris', phone: '351 555-0101', summary: 'x', propertyId }));
    expect(ingest.receiveInContext.mock.calls[0][0]).toMatchObject({ relatedType: 'Property', relatedId: propertyId, answered: true });
  });

  it('un teléfono inválido o una propiedad inexistente se rechazan', async () => {
    const a = build();
    await expect(a.run(() => a.service.registerCall({ name: 'Iris', phone: 'abcdefg', summary: 'x' }))).rejects.toMatchObject({
      status: 400,
      response: { error: 'INVALID_PHONE' },
    });
    const b = build({ found: false });
    await expect(
      b.run(() => b.service.registerCall({ name: 'Iris', phone: '351 555-0101', summary: 'x', propertyId: '88888888-8888-4888-8888-888888888888' })),
    ).rejects.toMatchObject({ status: 404 });
  });
});
