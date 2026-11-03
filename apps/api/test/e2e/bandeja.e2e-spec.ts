import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setupTestApp, cleanDatabase, teardownTestApp, registerUser, createUserDirect, loginUser } from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { UserRole } from '@realfy/shared';

const PASSWORD = 'Password123!';
const WA_SECRET = 'secreto-app-bandeja';
const INBOX_SECRET = 'secreto-casilla-de-consultas';
const PHONE_ID = '1000000001';

const ENV = [
  'MESSAGING_MODE',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_TENANT_SLUG',
  'INBOX_EMAIL_INGEST_SECRET',
] as const;

/**
 * Bandeja de consultas unificada (ítem 43, PR 5.3, CU-49): WhatsApp, mail, formulario del
 * micrositio y llamadas con responsable, plazo de 15 minutos y autorrespuesta. La API corre
 * con los proveedores de prueba (NODE_ENV=test): nada sale de la máquina.
 */
describe('Bandeja de consultas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    const setup = await setupTestApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  afterAll(async () => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await cleanDatabase(prisma);
    await teardownTestApp();
  });

  beforeEach(async () => {
    for (const k of ENV) delete process.env[k];
    process.env.WHATSAPP_APP_SECRET = WA_SECRET;
    process.env.WHATSAPP_PHONE_NUMBER_ID = PHONE_ID;
    process.env.INBOX_EMAIL_INGEST_SECRET = INBOX_SECRET;
    await cleanDatabase(prisma);
  });

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => http().get(`/api${path}`).set(auth(token));
  const post = (token: string, path: string, body: object = {}) => http().post(`/api${path}`).set(auth(token)).send(body);
  const put = (token: string, path: string, body: object = {}) => http().put(`/api${path}`).set(auth(token)).send(body);

  async function agency(tag: string) {
    const admin = await registerUser(app, { email: `admin@${tag}.test`, password: PASSWORD, firstName: 'Admin', lastName: 'Prueba' });
    const tenantId = admin.user.tenantId as string;
    const slug = `inmo-${tag}`;
    await http().patch(`/api/tenants/${tenantId}`).set(auth(admin.accessToken)).send({ slug }).expect(200);
    const tokens = { [UserRole.Admin]: admin.accessToken } as Record<UserRole, string>;
    const userIds = { [UserRole.Admin]: admin.user.id } as Record<UserRole, string>;
    for (const role of [UserRole.Ventas, UserRole.Soporte, UserRole.Lectura, UserRole.Liquidaciones]) {
      const email = `${role.toLowerCase()}@${tag}.test`;
      const u = await createUserDirect(prisma, tenantId, { email, password: PASSWORD, role, firstName: role, lastName: 'Prueba' });
      userIds[role] = u.id;
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    return { tenantId, slug, tokens, userIds, token: tokens[UserRole.Admin] };
  }

  const waPayload = (messages: object[], contacts: object[] = []) =>
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba', changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, contacts, messages } }] }],
    });
  const waSend = (payload: string) =>
    http()
      .post('/api/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', WA_SECRET).update(payload).digest('hex')}`)
      .send(payload);
  const waText = (id: string, from: string, body: string, ts = Math.floor(Date.now() / 1000)) =>
    waPayload([{ id, from, timestamp: String(ts), type: 'text', text: { body } }], [{ wa_id: from, profile: { name: 'Iris Demo' } }]);

  const emailIngest = (body: object, secret = INBOX_SECRET) => {
    const raw = JSON.stringify(body);
    return http()
      .post('/api/inbox/email-ingest')
      .set('Content-Type', 'application/json')
      .set('X-Realfy-Signature', `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`)
      .send(raw);
  };

  const list = async (token: string, query = '') => (await get(token, `/conversations${query}`).expect(200)).body;
  const detail = async (token: string, id: string) => (await get(token, `/conversations/${id}`).expect(200)).body;
  const outbox = async (token: string, query = '') => (await get(token, `/outbox${query}`).expect(200)).body;
  const runDispatch = (token: string) => post(token, '/outbox/_run-now').expect(200);
  const quietHoursOff = (tenantId: string) =>
    prisma.baseClient.tenant.update({ where: { id: tenantId }, data: { operationalDefaults: { messaging: { fromHour: 0, untilHour: 24 } } } });

  async function webInquiry(slug: string, over: Record<string, unknown> = {}) {
    return http()
      .post(`/api/public/${slug}/inquiries`)
      .send({
        firstName: 'Lucía',
        lastName: 'Gómez',
        email: 'lucia.gomez@correo.test',
        phone: '351 555-0102',
        message: 'Quisiera coordinar una visita.',
        ...over,
      })
      .expect(201);
  }

  it('CP-770 — una consulta del micrositio crea el interés y una consulta de canal Web con plazo de 15 minutos y autorrespuesta por mail', async () => {
    const { token, slug } = await agency('inb-1');
    const inquiry = await webInquiry(slug);

    const page = await list(token);
    expect(page.total).toBe(1);
    const item = page.items[0];
    expect(item).toMatchObject({ channel: 'Web', counterpartName: 'Lucía Gómez', address: 'lucia.gomez@correo.test', unread: 1 });
    expect(['Nueva', 'Asignada']).toContain(item.status);
    const minutes = (new Date(item.slaDueAt).getTime() - new Date(item.lastMessageAt).getTime()) / 60_000;
    // Dentro del horario son 15 minutos; fuera, corre desde la apertura (nunca menos de 15).
    expect(minutes).toBeGreaterThanOrEqual(15);

    const d = await detail(token, item.id);
    expect(d.lead.id).toBe(inquiry.body.id);
    expect(d.person).toMatchObject({ firstName: 'Lucía', lastName: 'Gómez' });
    expect(d.messages[0]).toMatchObject({ direction: 'In', body: 'Quisiera coordinar una visita.' });
    expect(d.replyRoute).toMatchObject({ channel: 'Email', to: 'lucia.gomez@correo.test' });

    // La autorrespuesta quedó en la bandeja de salida, por mail, con el modo apagado sin salir.
    const sent = await outbox(token, `?relatedType=Conversation&relatedId=${item.id}`);
    expect(sent.total).toBe(1);
    expect(sent.items[0]).toMatchObject({ channel: 'Email', templateKey: 'inbox_message', status: 'Pending', statusReason: 'MESSAGING_OFF' });
    expect(d.messages.find((m: any) => m.isAutoReply)).toMatchObject({ direction: 'Out', delivery: { status: 'Pending' } });
  });

  it('CP-771 — un WhatsApp de un número nuevo abre la consulta y se autorresponde con texto libre dentro de la ventana', async () => {
    const { token, tenantId } = await agency('inb-2');
    await quietHoursOff(tenantId);
    process.env.MESSAGING_MODE = 'live';

    await waSend(waText('wamid.inb.1', '5493515550111', 'Hola, ¿sigue disponible el depto?')).expect(200);

    const page = await list(token);
    expect(page.items[0]).toMatchObject({ channel: 'WhatsApp', counterpartName: 'Iris Demo', address: '5493515550111', status: 'Nueva' });
    const d = await detail(token, page.items[0].id);
    expect(d.messages.map((m: any) => [m.direction, m.isAutoReply])).toEqual([
      ['In', false],
      ['Out', true],
    ]);
    expect(d.messages[1].body).toContain('Hola Iris');

    expect((await runDispatch(token)).body).toMatchObject({ sent: 1 });
    const [m] = (await outbox(token, `?relatedType=Conversation&relatedId=${page.items[0].id}`)).items;
    expect(m).toMatchObject({ channel: 'WhatsApp', templateKey: 'inbox_message', status: 'Sent' });
    // Sin alta previa de WhatsApp: la persona escribió primero (ventana de atención al cliente).
  });

  it('CP-772 — otro mensaje del mismo número se suma al hilo, suma un sin leer y no repite la autorrespuesta', async () => {
    const { token } = await agency('inb-3');
    await waSend(waText('wamid.inb.2', '5493515550112', 'Hola')).expect(200);
    await waSend(waText('wamid.inb.3', '5493515550112', '¿Hay cochera?')).expect(200);
    // Meta reintenta el mismo aviso: no se duplica.
    await waSend(waText('wamid.inb.3', '5493515550112', '¿Hay cochera?')).expect(200);

    const page = await list(token);
    expect(page.total).toBe(1);
    expect(page.items[0].unread).toBe(2);
    const d = await detail(token, page.items[0].id);
    expect(d.messages.filter((m: any) => m.direction === 'In')).toHaveLength(2);
    expect(d.messages.filter((m: any) => m.isAutoReply)).toHaveLength(1);
  });

  it('CP-773 — mail entrante firmado: abre la consulta, se autorresponde, no se duplica y los automáticos no entran', async () => {
    const { token, slug } = await agency('inb-4');
    const body = {
      tenantSlug: slug,
      messageId: '<abc123@mail.demo>',
      from: 'Iris.Demo@Correo.test',
      fromName: 'Iris Demo',
      subject: 'Consulta por el departamento de Nueva Córdoba',
      text: 'Buen día, ¿puedo verlo el jueves?',
      receivedAt: new Date().toISOString(),
    };
    await emailIngest(body, 'otro-secreto').expect(401);
    await http().post('/api/inbox/email-ingest').send(body).expect(401);
    expect((await emailIngest(body).expect(200)).body).toEqual({ received: true });
    await emailIngest(body).expect(200); // reenvío repetido

    const page = await list(token, '?channel=Email');
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ address: 'iris.demo@correo.test', subject: 'Consulta por el departamento de Nueva Córdoba' });
    const d = await detail(token, page.items[0].id);
    expect(d.messages.filter((m: any) => m.direction === 'In')).toHaveLength(1);
    expect(d.messages.filter((m: any) => m.isAutoReply)).toHaveLength(1);

    expect((await emailIngest({ ...body, messageId: '<auto@mail.demo>', automatic: true }).expect(200)).body).toMatchObject({ ignored: 'automatic' });
    expect((await emailIngest({ ...body, messageId: '<nr@mail.demo>', from: 'no-reply@proveedor.test' }).expect(200)).body).toMatchObject({ ignored: 'automatic' });
    await emailIngest({ ...body, tenantSlug: 'no-existe', messageId: '<x@mail.demo>' }).expect(404);
    expect((await list(token)).total).toBe(1);
  });

  it('CP-774 — registrar llamada: una atendida queda en curso sin plazo; una para devolver nace asignada a quien la anota, con plazo', async () => {
    const { token, userIds } = await agency('inb-5');
    const answered = (await post(token, '/conversations/calls', { name: 'Iris Demo', phone: '351 555-0113', summary: 'Pidió los requisitos' }).expect(201)).body;
    expect(answered).toMatchObject({ channel: 'Telefono', status: 'EnCurso', slaDueAt: null, unread: 0 });
    expect(answered.firstResponseAt).not.toBeNull();
    expect(answered.assignee.id).toBe(userIds[UserRole.Admin]);
    const missed = (await post(token, '/conversations/calls', { name: 'Mario Demo', phone: '351 555-0114', summary: 'Llamó y no atendimos', answered: false }).expect(201)).body;
    expect(missed).toMatchObject({ status: 'Asignada', firstResponseAt: null });
    expect(missed.slaDueAt).not.toBeNull();
    // Por teléfono no hay autorrespuesta.
    expect((await outbox(token)).total).toBe(0);
    await post(token, '/conversations/calls', { name: 'X', phone: 'abc', summary: 'x' }).expect(400);
  });

  it('CP-775 — responder por el mismo canal: encola, toma la primera respuesta y deja la consulta esperando; el doble clic no duplica', async () => {
    const { token, tenantId, tokens } = await agency('inb-6');
    await quietHoursOff(tenantId);
    process.env.MESSAGING_MODE = 'live';
    await waSend(waText('wamid.inb.4', '5493515550115', 'Hola')).expect(200);
    const id = (await list(token)).items[0].id;
    await runDispatch(token);

    // Doble clic: dos pedidos a la vez con el mismo texto encolan un solo mensaje.
    const body = { body: 'Sí, está disponible. ¿Cuándo lo querés ver?' };
    const [r1, r2] = await Promise.all([
      post(tokens[UserRole.Ventas], `/conversations/${id}/reply`, body),
      post(tokens[UserRole.Ventas], `/conversations/${id}/reply`, body),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect([r1.body.queued, r2.body.queued].sort()).toEqual([false, true]);
    expect(r1.body).toMatchObject({ channel: 'WhatsApp' });

    const d = await detail(token, id);
    expect(d).toMatchObject({ status: 'Esperando', slaState: 'met', unread: 0 });
    expect(d.firstResponseAt).not.toBeNull();
    expect(d.assignee).not.toBeNull(); // quien contesta una consulta sin responsable se la queda
    expect(d.messages.filter((m: any) => m.direction === 'Out' && !m.isAutoReply)).toHaveLength(1);
    expect((await runDispatch(token)).body).toMatchObject({ sent: 1 });

    // El cliente contesta: vuelve a en curso.
    await waSend(waText('wamid.inb.5', '5493515550115', 'El jueves a la tarde')).expect(200);
    expect((await detail(token, id)).status).toBe('EnCurso');
    await post(tokens[UserRole.Lectura], `/conversations/${id}/reply`, { body: 'x' }).expect(403);
  });

  it('CP-776 — fuera de las 24 horas de WhatsApp no sale texto libre (409); con mail de la persona sale por mail', async () => {
    const { token } = await agency('inb-7');
    const old = Math.floor(Date.now() / 1000) - 30 * 3600;
    await waSend(waText('wamid.inb.6', '5493515550116', 'Hola', old)).expect(200);
    const id = (await list(token)).items[0].id;
    const d = await detail(token, id);
    expect(d).toMatchObject({ replyRoute: null, replyBlockedReason: 'WHATSAPP_WINDOW_CLOSED' });
    expect((await post(token, `/conversations/${id}/reply`, { body: 'Hola' }).expect(409)).body.error).toBe('WHATSAPP_WINDOW_CLOSED');

    const person = (await post(token, '/persons', { firstName: 'Iris', lastName: 'Demo', email: 'iris@demo.test', phone: '351 555-0116' }).expect(201)).body;
    await put(token, `/conversations/${id}/links`, { personId: person.id }).expect(200);
    expect((await detail(token, id)).replyRoute).toMatchObject({ channel: 'Email', to: 'iris@demo.test' });
    expect((await post(token, `/conversations/${id}/reply`, { body: 'Te escribimos por mail.' }).expect(200)).body.channel).toBe('Email');
  });

  it('CP-777 — la baja detiene la autorrespuesta y la respuesta manual', async () => {
    const { token, tenantId } = await agency('inb-8');
    const person = (await post(token, '/persons', { firstName: 'Iris', lastName: 'Demo', phone: '351 555-0117' }).expect(201)).body;
    await put(token, `/persons/${person.id}/consents`, { channel: 'WhatsApp', status: 'OptOut' }).expect(200);
    await waSend(waText('wamid.inb.7', '5493515550117', 'Hola')).expect(200);

    const [c] = (await list(token)).items;
    expect(c).toMatchObject({ channel: 'WhatsApp' });
    expect((await outbox(token)).total).toBe(0); // sin autorrespuesta
    const d = await detail(token, c.id);
    expect(d.person.id).toBe(person.id); // se reconoce por el teléfono normalizado
    expect(d.replyBlockedReason).toBe('CONTACT_OPTED_OUT');
    expect((await post(token, `/conversations/${c.id}/reply`, { body: 'Hola' }).expect(409)).body.error).toBe('CONTACT_OPTED_OUT');
    expect(await prisma.baseClient.messageOutbox.count({ where: { tenantId } })).toBe(0);
  });

  it('CP-778 — el control de plazos marca una sola vez las consultas vencidas y avisa al responsable y a la gerencia', async () => {
    const { token, userIds, tokens } = await agency('inb-9');
    await waSend(waText('wamid.inb.8', '5493515550118', 'Hola')).expect(200);
    const id = (await list(token)).items[0].id;
    await put(token, `/conversations/${id}/assignee`, { assigneeUserId: userIds[UserRole.Ventas] }).expect(200);
    await prisma.baseClient.conversation.update({ where: { id }, data: { slaDueAt: new Date(Date.now() - 60_000) } });

    expect((await list(token, '?slaBreached=true')).total).toBe(1);
    expect((await get(token, '/conversations/summary').expect(200)).body.breached).toBe(1);
    expect((await post(token, '/conversations/_run-sla').expect(200)).body).toEqual({ flagged: 1 });
    expect((await post(token, '/conversations/_run-sla').expect(200)).body).toEqual({ flagged: 0 });

    const notices = await prisma.baseClient.notification.findMany({ where: { type: 'InboxSlaBreached' }, orderBy: { userId: 'asc' } });
    expect(notices.map((n) => n.userId).sort()).toEqual([userIds[UserRole.Admin], userIds[UserRole.Ventas]].sort());
    expect((await get(tokens[UserRole.Ventas], '/notifications?isRead=false').expect(200)).body.items.map((n: any) => n.type)).toContain('InboxSlaBreached');
    expect((await detail(token, id)).slaBreachedAt).not.toBeNull();
    await post(tokens[UserRole.Ventas], '/conversations/_run-sla').expect(403);
  });

  it('CP-779 — asignar, cambiar estado, vincular propiedad y contrato, marcar como leída y contadores del menú', async () => {
    const { token, userIds, tokens } = await agency('inb-10');
    await waSend(waText('wamid.inb.9', '5493515550119', 'Hola')).expect(200);
    const id = (await list(token)).items[0].id;
    expect((await get(tokens[UserRole.Soporte], '/conversations/summary').expect(200)).body).toEqual({ unread: 1, breached: 0, unassigned: 1 });

    expect((await put(token, `/conversations/${id}/assignee`, { assigneeUserId: userIds[UserRole.Ventas] }).expect(200)).body).toMatchObject({ status: 'Asignada' });
    // Sin leer: sólo cuenta para el responsable (y las sin responsable).
    expect((await get(tokens[UserRole.Soporte], '/conversations/summary').expect(200)).body.unread).toBe(0);
    expect((await get(tokens[UserRole.Ventas], '/conversations/summary').expect(200)).body).toMatchObject({ unread: 1, unassigned: 0 });
    expect((await list(tokens[UserRole.Ventas], '?assignee=me&open=true')).total).toBe(1);
    expect((await list(token, '?assignee=none')).total).toBe(0);
    await put(token, `/conversations/${id}/assignee`, { assigneeUserId: '99999999-9999-4999-8999-999999999999' }).expect(400);

    await post(tokens[UserRole.Ventas], `/conversations/${id}/read`).expect(200);
    expect((await get(tokens[UserRole.Ventas], '/conversations/summary').expect(200)).body.unread).toBe(0);

    const property = (await post(token, '/properties', { title: 'Depto sintético', type: 'Departamento' }).expect(201)).body;
    const linked = (await put(token, `/conversations/${id}/links`, { related: { type: 'Property', id: property.id } }).expect(200)).body;
    expect(linked.related).toEqual({ type: 'Property', id: property.id });
    await put(token, `/conversations/${id}/links`, { related: { type: 'Contract', id: '99999999-9999-4999-8999-999999999999' } }).expect(404);
    await put(token, `/conversations/${id}/links`, {}).expect(400);

    expect((await put(token, `/conversations/${id}/status`, { status: 'Resuelta' }).expect(200)).body).toMatchObject({ status: 'Resuelta', previous: 'Asignada' });
    expect((await list(token, '?open=true')).total).toBe(0);
    expect((await list(token, '?status=Resuelta')).total).toBe(1);
    // Una consulta resuelta que vuelve a escribir se reabre con plazo nuevo.
    await waSend(waText('wamid.inb.10', '5493515550119', 'Una más')).expect(200);
    expect(await detail(token, id)).toMatchObject({ status: 'Asignada', firstResponseAt: null });
    await put(token, `/conversations/${id}/status`, { status: 'Otro' }).expect(400);
  });

  it('CP-780 — configuración: sólo Admin y Gerente la cambian; con la autorrespuesta apagada no se manda; respuestas rápidas visibles', async () => {
    const { token, tokens } = await agency('inb-11');
    const settings = (await get(tokens[UserRole.Ventas], '/conversations/settings').expect(200)).body;
    expect(settings).toMatchObject({ slaMinutes: 15, autoreply: { enabled: true } });
    expect(settings.quickReplies.length).toBeGreaterThan(0);
    await put(tokens[UserRole.Ventas], '/conversations/settings', settings).expect(403);
    await put(token, '/conversations/settings', { ...settings, slaMinutes: 0 }).expect(400);
    const next = { ...settings, slaMinutes: 30, businessHours: { ...settings.businessHours, enabled: false }, autoreply: { ...settings.autoreply, enabled: false } };
    expect((await put(token, '/conversations/settings', next).expect(200)).body.slaMinutes).toBe(30);

    await waSend(waText('wamid.inb.11', '5493515550120', 'Hola')).expect(200);
    const [c] = (await list(token)).items;
    expect((await outbox(token)).total).toBe(0);
    expect(Math.round((new Date(c.slaDueAt).getTime() - new Date(c.lastMessageAt).getTime()) / 60_000)).toBe(30);

    // El formulario de valores por defecto no borra la configuración de la bandeja.
    const defaults = (await get(token, '/tenants/me/operational-defaults').expect(200)).body;
    const { inbox: _inbox, publication: _publication, ...rest } = defaults;
    await put(token, '/tenants/me/operational-defaults', rest).expect(200);
    expect((await get(token, '/conversations/settings').expect(200)).body.slaMinutes).toBe(30);
  });

  it('CP-781 — roles: Lectura y Liquidaciones no entran a la bandeja; comercial, soporte y gerencia sí', async () => {
    const { token, tokens } = await agency('inb-12');
    await get(tokens[UserRole.Lectura], '/conversations').expect(403);
    await get(tokens[UserRole.Liquidaciones], '/conversations/summary').expect(403);
    await post(tokens[UserRole.Lectura], '/conversations/calls', { name: 'X', phone: '351 555-0121', summary: 'x' }).expect(403);
    await get(tokens[UserRole.Soporte], '/conversations').expect(200);
    await get(tokens[UserRole.Ventas], '/conversations').expect(200);
    await get(token, '/conversations').expect(200);
    await http().get('/api/conversations').expect(401);
  });

  it('CP-782 — aislamiento: otra inmobiliaria no ve ni toca las consultas, y el mail se ubica por la inmobiliaria de la casilla', async () => {
    const a = await agency('inb-13a');
    const b = await agency('inb-13b');
    await emailIngest({ tenantSlug: a.slug, messageId: '<iso@mail.demo>', from: 'iris@correo.test', text: 'Hola' }).expect(200);
    const [c] = (await list(a.token)).items;
    expect((await list(b.token)).total).toBe(0);
    await get(b.token, `/conversations/${c.id}`).expect(404);
    await post(b.token, `/conversations/${c.id}/reply`, { body: 'x' }).expect(404);
    await put(b.token, `/conversations/${c.id}/status`, { status: 'Resuelta' }).expect(404);
    await put(b.token, `/conversations/${c.id}/assignee`, { assigneeUserId: a.userIds[UserRole.Ventas] }).expect(404);
    expect((await list(a.token)).total).toBe(1);
  });

  it('CP-783 — el estado de entrega de la respuesta se ve en el hilo; con el modo apagado queda pendiente con el motivo', async () => {
    const { token, tenantId } = await agency('inb-14');
    await quietHoursOff(tenantId);
    await waSend(waText('wamid.inb.12', '5493515550122', 'Hola')).expect(200);
    const id = (await list(token)).items[0].id;
    await post(token, `/conversations/${id}/reply`, { body: 'Hola Iris' }).expect(200);
    const d = await detail(token, id);
    const replies = d.messages.filter((m: any) => m.direction === 'Out');
    expect(replies).toHaveLength(2);
    expect(replies.every((m: any) => m.delivery.status === 'Pending' && m.delivery.reason === 'MESSAGING_OFF')).toBe(true);
    process.env.MESSAGING_MODE = 'live';
    await runDispatch(token);
    expect((await detail(token, id)).messages.filter((m: any) => m.direction === 'Out').every((m: any) => m.delivery.status === 'Sent')).toBe(true);
  });
});
