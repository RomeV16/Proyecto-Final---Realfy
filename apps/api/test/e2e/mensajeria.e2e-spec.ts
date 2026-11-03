import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
  createUserDirect,
  loginUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  UserRole,
  PersonRole,
  PropertyType,
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
} from '@realfy/shared';

const PASSWORD = 'Password123!';
const WA_SECRET = 'secreto-app-prueba';
const RESEND_KEY = Buffer.from('clave-de-prueba-de-32-bytes!!!!!');

/** Variables de la mensajería que cada prueba fija; se restauran al terminar. */
const MESSAGING_ENV = [
  'MESSAGING_MODE',
  'MESSAGING_ALLOWLIST',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'RESEND_WEBHOOK_SECRET',
] as const;

/**
 * Mensajería saliente (ítem 43, ADR-0013, CU-44). La API corre con los
 * proveedores de prueba (NODE_ENV=test): nada sale de la máquina. El despacho
 * se dispara con POST /outbox/_run-now y el modo se cambia con las variables
 * del proceso, que la configuración lee en cada consulta.
 */
describe('Mensajería saliente (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of MESSAGING_ENV) saved[k] = process.env[k];
    const setup = await setupTestApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  afterAll(async () => {
    for (const k of MESSAGING_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await cleanDatabase(prisma);
    await teardownTestApp();
  });

  beforeEach(async () => {
    for (const k of MESSAGING_ENV) delete process.env[k];
    await cleanDatabase(prisma);
  });

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => http().get(`/api${path}`).set(auth(token));
  const post = (token: string, path: string, body: object = {}) => http().post(`/api${path}`).set(auth(token)).send(body);
  const put = (token: string, path: string, body: object = {}) => http().put(`/api${path}`).set(auth(token)).send(body);
  const runNow = (token: string) => post(token, '/outbox/_run-now').expect(200);

  async function agency(tag: string) {
    const admin = await registerUser(app, { email: `admin@${tag}.test`, password: PASSWORD, firstName: 'Admin', lastName: 'Prueba' });
    const tenantId = admin.user.tenantId as string;
    const tokens = { [UserRole.Admin]: admin.accessToken } as Record<UserRole, string>;
    for (const role of [UserRole.Liquidaciones, UserRole.Lectura, UserRole.Ventas, UserRole.Marketing]) {
      const email = `${role.toLowerCase()}@${tag}.test`;
      await createUserDirect(prisma, tenantId, { email, password: PASSWORD, role });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    // Horario permitido de todo el día: la prueba no depende de la hora a la que corre.
    await prisma.baseClient.tenant.update({ where: { id: tenantId }, data: { operationalDefaults: { messaging: { fromHour: 0, untilHour: 24 } } } });
    return { tenantId, tokens, token: tokens[UserRole.Admin] };
  }

  /** Contrato activo con un locador y una inquilina con mail y celular (datos sintéticos). */
  async function contract(token: string, tag: string) {
    const lessor = (await post(token, '/persons', { firstName: 'Ana', lastName: 'Locadora', email: `ana@${tag}.test` }).expect(201)).body.id;
    const tenantPerson = (
      await post(token, '/persons', { firstName: 'Iris', lastName: 'Inquilina', email: `iris@${tag}.test`, phone: '351 555-0101' }).expect(201)
    ).body.id;
    await post(token, `/persons/${tenantPerson}/roles`, { role: PersonRole.Inquilino }).expect(201);
    const property = await post(token, '/properties', { title: 'Unidad sintética', type: PropertyType.Departamento }).expect(201);
    const c = (
      await post(token, '/contracts', {
        propertyId: property.body.id,
        contractType: ContractType.Alquiler,
        status: ContractStatus.Activo,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2028-12-31T00:00:00.000Z',
        rentAmount: '100000.00',
        rentCurrency: 'ARS',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Anual,
        guarantees: [],
        persons: [
          { personId: lessor, role: PersonRole.Propietario },
          { personId: tenantPerson, role: PersonRole.Inquilino },
        ],
      }).expect(201)
    ).body;
    await post(token, '/liquidaciones/generate', { month: 1, year: 2026 }).expect(201);
    const liq = (await get(token, `/liquidaciones?contractId=${c.id}&limit=10`).expect(200)).body.items[0];
    for (const status of ['Revision', 'Aprobada', 'Enviada']) {
      await post(token, `/liquidaciones/${liq.id}/transition`, { status }).expect(200);
    }
    return { contractId: c.id as string, lessor, tenantPerson, liquidacionId: liq.id as string };
  }

  async function receipt(token: string, liquidacionId: string): Promise<string> {
    const res = await post(token, `/liquidaciones/${liquidacionId}/payments`, {
      method: 'Efectivo',
      paidAt: '2026-01-08T12:00:00.000Z',
      amount: '100000',
    }).expect(200);
    return res.body.registeredPayment.receipt.id;
  }

  const outbox = async (token: string, query = '') => (await get(token, `/outbox${query}`).expect(200)).body;

  it('CP-631 — la liquidación enviada encola el mail al inquilino; con el modo apagado no sale nada', async () => {
    const { token, tokens } = await agency('msg-1');
    const { liquidacionId } = await contract(token, 'msg-1');

    const page = await outbox(tokens[UserRole.Lectura], `?relatedType=Liquidacion&relatedId=${liquidacionId}`);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      channel: 'Email',
      templateKey: 'liquidacion',
      to: 'iris@msg-1.test',
      personName: 'Iris Inquilina',
      status: 'Pending',
      statusReason: 'MESSAGING_OFF',
    });

    expect((await runNow(token)).body).toMatchObject({ sent: 0 });
    expect((await outbox(token)).items[0].status).toBe('Pending');

    process.env.MESSAGING_MODE = 'live';
    expect((await runNow(token)).body).toMatchObject({ sent: 1 });
    const sent = (await outbox(token)).items[0];
    expect(sent).toMatchObject({ status: 'Sent', attempts: 1, statusReason: null });
    expect(sent.sentAt).not.toBeNull();
    await get(tokens[UserRole.Marketing], '/outbox').expect(403);
  });

  it('CP-632 — enviar un recibo: una vez por canal; WhatsApp solo con el alta registrada', async () => {
    const { token, tokens } = await agency('msg-2');
    const { liquidacionId, tenantPerson } = await contract(token, 'msg-2');
    const receiptId = await receipt(token, liquidacionId);
    process.env.MESSAGING_MODE = 'live';

    await post(tokens[UserRole.Ventas], '/outbox/send', { kind: 'Receipt', id: receiptId, channel: 'Email' }).expect(403);
    const first = (await post(tokens[UserRole.Liquidaciones], '/outbox/send', { kind: 'Receipt', id: receiptId, channel: 'Email' }).expect(200)).body;
    const again = (await post(token, '/outbox/send', { kind: 'Receipt', id: receiptId, channel: 'Email' }).expect(200)).body;
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ templateKey: 'receipt', relatedType: 'Receipt', to: 'iris@msg-2.test', vars: { number: '00000001', name: 'Iris' } });

    const wa = (await post(token, '/outbox/send', { kind: 'Receipt', id: receiptId, channel: 'WhatsApp' }).expect(200)).body;
    expect(wa.to).toBe('5493515550101');
    await runNow(token);
    const byId = async (id: string) => (await outbox(token, `?relatedId=${receiptId}`)).items.find((m: any) => m.id === id);
    expect(await byId(first.id)).toMatchObject({ status: 'Sent' });
    expect(await byId(wa.id)).toMatchObject({ status: 'Blocked', statusReason: 'NO_OPT_IN' });

    // La persona dio el alta por escrito: se registra y se reintenta.
    await put(tokens[UserRole.Lectura], `/persons/${tenantPerson}/consents`, { channel: 'WhatsApp', status: 'OptIn' }).expect(403);
    const consents = (await put(tokens[UserRole.Ventas], `/persons/${tenantPerson}/consents`, { channel: 'WhatsApp', status: 'OptIn', note: 'Firmó el alta en la oficina' }).expect(200)).body;
    expect(consents.channels.find((c: any) => c.channel === 'WhatsApp')).toMatchObject({ status: 'OptIn', source: 'Manual', address: '5493515550101' });
    await post(tokens[UserRole.Liquidaciones], `/outbox/${wa.id}/retry`).expect(403);
    expect((await post(token, `/outbox/${wa.id}/retry`).expect(200)).body).toMatchObject({ status: 'Pending', attempts: 0 });
    await runNow(token);
    expect(await byId(wa.id)).toMatchObject({ status: 'Sent' });

    await post(token, '/outbox/send', { kind: 'Receipt', id: receiptId, channel: 'Fax' }).expect(400);
  });

  it('CP-633 — con allowlist solo salen las direcciones de la lista; el resto queda bloqueado', async () => {
    const { token } = await agency('msg-3');
    await contract(token, 'msg-3');
    process.env.MESSAGING_MODE = 'allowlist';
    process.env.MESSAGING_ALLOWLIST = 'otra@msg-3.test';
    expect((await runNow(token)).body).toMatchObject({ sent: 0, blocked: 1 });
    const [m] = (await outbox(token)).items;
    expect(m).toMatchObject({ status: 'Blocked', statusReason: 'NOT_IN_ALLOWLIST' });

    process.env.MESSAGING_ALLOWLIST = 'otra@msg-3.test, IRIS@msg-3.test';
    await post(token, `/outbox/${m.id}/retry`).expect(200);
    expect((await runNow(token)).body).toMatchObject({ sent: 1 });
  });

  it('CP-634 — el estado de cuenta se manda emitido y pasa a Enviado cuando el mensaje sale', async () => {
    const { token } = await agency('msg-4');
    const { liquidacionId, lessor } = await contract(token, 'msg-4');
    await receipt(token, liquidacionId);
    await post(token, '/owner-statements/generate?period=2026-01').expect(200);
    const st = (await get(token, `/owner-statements?personId=${lessor}`).expect(200)).body.items[0];

    const draft = await post(token, '/outbox/send', { kind: 'OwnerStatement', id: st.id, channel: 'Email' });
    expect(draft.status).toBe(400);
    expect(draft.body.error).toBe('OWNER_STATEMENT_NOT_ISSUED');

    await post(token, `/owner-statements/${st.id}/issue`).expect(200);
    const msg = (await post(token, '/outbox/send', { kind: 'OwnerStatement', id: st.id, channel: 'Email' }).expect(200)).body;
    expect(msg).toMatchObject({ to: 'ana@msg-4.test', templateKey: 'owner_statement' });
    expect((await get(token, `/owner-statements/${st.id}`).expect(200)).body.status).toBe('Emitido');

    process.env.MESSAGING_MODE = 'live';
    await runNow(token);
    const after = (await get(token, `/owner-statements/${st.id}`).expect(200)).body;
    expect(after.status).toBe('Enviado');
    expect(after.sentAt).not.toBeNull();
  });

  it('CP-635 — webhooks firmados: estado de entrega, baja por WhatsApp y firma inválida rechazada', async () => {
    const { token, tenantId } = await agency('msg-5');
    const { tenantPerson } = await contract(token, 'msg-5');
    const [liq] = (await outbox(token)).items;
    await prisma.baseClient.messageOutbox.update({
      where: { id: liq.id },
      data: { status: 'Sent', providerMsgId: 'em_e2e_1', sentAt: new Date() },
    });
    await prisma.baseClient.messageOutbox.create({
      data: {
        tenantId,
        channel: 'WhatsApp',
        personId: tenantPerson,
        to: '5493515550101',
        templateKey: 'ticket_status',
        vars: {},
        status: 'Sent',
        providerMsgId: 'wamid.e2e.1',
        idempotencyKey: 'e2e:wa:1',
      },
    });
    process.env.WHATSAPP_APP_SECRET = WA_SECRET;
    process.env.WHATSAPP_VERIFY_TOKEN = 'token-verificacion';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1000000001';
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${RESEND_KEY.toString('base64')}`;

    // Verificación de la suscripción.
    const challenge = await http()
      .get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=token-verificacion&hub.challenge=4242')
      .expect(200);
    expect(challenge.text).toBe('4242');
    await http().get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1').expect(403);

    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '1000000001' },
                statuses: [{ id: 'wamid.e2e.1', status: 'delivered', timestamp: '1762100000' }],
                messages: [{ id: 'wamid.in.e2e', from: '5493515550101', timestamp: '1762100100', type: 'text', text: { body: 'BAJA' } }],
              },
            },
          ],
        },
      ],
    });
    const metaSig = `sha256=${createHmac('sha256', WA_SECRET).update(payload).digest('hex')}`;
    const send = (sig: string | null, body = payload) => {
      const r = http().post('/api/webhooks/whatsapp').set('Content-Type', 'application/json');
      if (sig) r.set('X-Hub-Signature-256', sig);
      return r.send(body);
    };
    await send(null).expect(401);
    await send(metaSig, payload.replace('BAJA', 'HOLA')).expect(401);
    expect((await send(metaSig).expect(200)).body).toEqual({ received: true });

    const wa = await prisma.baseClient.messageOutbox.findUnique({ where: { providerMsgId: 'wamid.e2e.1' } });
    expect(wa).toMatchObject({ status: 'Delivered' });
    const consents = (await get(token, `/persons/${tenantPerson}/consents`).expect(200)).body;
    expect(consents.channels.find((c: any) => c.channel === 'WhatsApp')).toMatchObject({ status: 'OptOut', source: 'Inbound' });
    expect(await prisma.baseClient.inboundMessage.count({ where: { tenantId } })).toBe(1);
    // Meta reintenta el mismo aviso: no se duplica.
    await send(metaSig).expect(200);
    expect(await prisma.baseClient.inboundMessage.count({ where: { tenantId } })).toBe(1);

    // Resend (svix).
    const event = JSON.stringify({ type: 'email.delivered', created_at: '2026-11-02T15:00:00.000Z', data: { email_id: 'em_e2e_1' } });
    const ts = String(Math.floor(Date.now() / 1000));
    const svix = createHmac('sha256', RESEND_KEY).update(`msg_e2e.${ts}.`).update(event).digest('base64');
    const resend = (sig: string) =>
      http()
        .post('/api/webhooks/resend')
        .set('Content-Type', 'application/json')
        .set('svix-id', 'msg_e2e')
        .set('svix-timestamp', ts)
        .set('svix-signature', sig)
        .send(event);
    await resend('v1,AAAA').expect(401);
    await resend(`v1,${svix}`).expect(200);
    expect((await outbox(token, '?channel=Email')).items[0]).toMatchObject({ status: 'Delivered' });
  });

  it('CP-636 — aislamiento: otra inmobiliaria no ve ni toca los mensajes ni el consentimiento', async () => {
    const a = await agency('msg-6a');
    const { tenantPerson } = await contract(a.token, 'msg-6a');
    const [m] = (await outbox(a.token)).items;
    const b = await agency('msg-6b');
    expect((await outbox(b.token)).total).toBe(0);
    await post(b.token, `/outbox/${m.id}/retry`).expect(404);
    await post(b.token, `/outbox/${m.id}/cancel`).expect(404);
    await get(b.token, `/persons/${tenantPerson}/consents`).expect(404);
    await put(b.token, `/persons/${tenantPerson}/consents`, { channel: 'Email', status: 'OptOut' }).expect(404);
  });

  it('CP-637 — cancelar uno pendiente; uno cancelado se reintenta; uno enviado no se cancela; la configuración', async () => {
    const { token, tokens } = await agency('msg-7');
    await contract(token, 'msg-7');
    const [m] = (await outbox(token)).items;
    await post(tokens[UserRole.Liquidaciones], `/outbox/${m.id}/cancel`).expect(403);
    expect((await post(token, `/outbox/${m.id}/cancel`).expect(200)).body.status).toBe('Cancelled');
    expect((await post(token, `/outbox/${m.id}/cancel`)).body.error).toBe('MESSAGE_NOT_CANCELLABLE');
    await post(token, `/outbox/${m.id}/retry`).expect(200);
    process.env.MESSAGING_MODE = 'live';
    await runNow(token);
    expect((await post(token, `/outbox/${m.id}/cancel`)).body.error).toBe('MESSAGE_NOT_CANCELLABLE');
    expect((await post(token, `/outbox/${m.id}/retry`)).body.error).toBe('MESSAGE_NOT_RETRYABLE');

    const settings = (await get(token, '/messaging/settings').expect(200)).body;
    expect(settings).toMatchObject({
      mode: 'live',
      providers: { email: { configured: true }, whatsapp: { configured: true } },
      sendingWindow: { fromHour: 0, untilHour: 24 },
    });
    expect(settings.templates).toHaveLength(10);
    await get(tokens[UserRole.Liquidaciones], '/messaging/settings').expect(403);
  });
});
