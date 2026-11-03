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
  ContractType,
  AdjustmentType,
  AdjustmentPeriod,
  formatMoneyAR,
} from '@realfy/shared';

const PASSWORD = 'Password123!';

/**
 * Cobranza escalonada (ítem 43, 5.4, ADR-0013, CU-48). El proceso diario se dispara con
 * POST /collection-cases/_run-now, a un día simulado (`today`), con los proveedores de
 * prueba: nada sale de la máquina. Las liquidaciones se crean directo con fechas fijas
 * (marzo y abril de 2026) para que la línea de tiempo no dependa del día en que corre.
 */
describe('Cobranza escalonada (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const savedMode = process.env.MESSAGING_MODE;

  beforeAll(async () => {
    const setup = await setupTestApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  afterAll(async () => {
    if (savedMode === undefined) delete process.env.MESSAGING_MODE;
    else process.env.MESSAGING_MODE = savedMode;
    await cleanDatabase(prisma);
    await teardownTestApp();
  });

  beforeEach(async () => {
    delete process.env.MESSAGING_MODE;
    await cleanDatabase(prisma);
  });

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => http().get(`/api${path}`).set(auth(token));
  const post = (token: string, path: string, body: object = {}) => http().post(`/api${path}`).set(auth(token)).send(body);
  const patch = (token: string, path: string, body: object = {}) => http().patch(`/api${path}`).set(auth(token)).send(body);
  const put = (token: string, path: string, body: object = {}) => http().put(`/api${path}`).set(auth(token)).send(body);
  const runOn = (token: string, today: string) => post(token, '/collection-cases/_run-now', { today }).expect(200).then((r) => r.body);

  async function agency(tag: string, { enabled = true }: { enabled?: boolean } = {}) {
    const admin = await registerUser(app, { email: `admin@${tag}.test`, password: PASSWORD, firstName: 'Admin', lastName: 'Prueba' });
    const tenantId = admin.user.tenantId as string;
    const tokens = { [UserRole.Admin]: admin.accessToken } as Record<UserRole, string>;
    for (const role of [UserRole.Gerente, UserRole.Liquidaciones, UserRole.Lectura, UserRole.Ventas]) {
      const email = `${role.toLowerCase()}@${tag}.test`;
      await createUserDirect(prisma, tenantId, { email, password: PASSWORD, role });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    await prisma.baseClient.tenant.update({
      where: { id: tenantId },
      data: { operationalDefaults: { messaging: { fromHour: 0, untilHour: 24 }, collections: { enabled } } },
    });
    return { tenantId, tokens, token: admin.accessToken, adminId: admin.user.id as string };
  }

  /** Contrato activo con una inquilina con celular y mail (datos sintéticos) y dos liquidaciones enviadas e impagas. */
  async function debtor(a: { token: string; tenantId: string }, tag: string) {
    const token = a.token;
    const lessor = (await post(token, '/persons', { firstName: 'Ana', lastName: 'Locadora', email: `ana@${tag}.test` }).expect(201)).body.id;
    const tenantPerson = (
      await post(token, '/persons', { firstName: 'Iris', lastName: 'Inquilina', email: `iris@${tag}.test`, phone: '351 555-0101', address: 'Calle Falsa 123' }).expect(201)
    ).body.id;
    await post(token, `/persons/${tenantPerson}/roles`, { role: PersonRole.Inquilino }).expect(201);
    const property = await post(token, '/properties', { title: 'Unidad sintética', type: 'Departamento', street: 'Calle Ficticia', number: '742' }).expect(201);
    const contract = (
      await post(token, '/contracts', {
        propertyId: property.body.id,
        contractType: ContractType.Alquiler,
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
    await post(token, `/contracts/${contract.id}/activate`).expect(201);
    const liq = (period: Date, dueDate: Date) =>
      prisma.baseClient.liquidacion.create({
        data: {
          tenantId: a.tenantId,
          contractId: contract.id,
          period,
          status: 'Enviada',
          dueDate,
          subtotal: '100000.00',
          total: '100000.00',
          lineItems: {
            create: [{ tenantId: a.tenantId, type: 'Alquiler', description: 'Alquiler', amount: '100000.00', commissionable: true, beneficiary: 'Locador' }],
          },
        },
      });
    const march = await liq(new Date(Date.UTC(2026, 2, 1)), new Date(Date.UTC(2026, 2, 10)));
    const april = await liq(new Date(Date.UTC(2026, 3, 1)), new Date(Date.UTC(2026, 3, 10)));
    return { contractId: contract.id as string, tenantPerson: tenantPerson as string, march, april };
  }

  const cases = async (token: string, query = '') => (await get(token, `/collection-cases${query}`).expect(200)).body;
  const queued = (tenantId: string) =>
    prisma.baseClient.messageOutbox.findMany({ where: { tenantId, relatedType: 'CollectionCase' }, orderBy: { createdAt: 'asc' } });

  it('CP-754 — línea de tiempo completa: recordatorios a los 5, 10 y 15 días, carta documento al vencer el siguiente, confirmación del envío y derivación manual', async () => {
    const a = await agency('cob-1');
    const d = await debtor(a, 'cob-1');
    // Con el alta de WhatsApp los recordatorios salen por ahí.
    await put(a.token, `/persons/${d.tenantPerson}/consents`, { channel: 'WhatsApp', status: 'OptIn', note: 'Firmó el alta en la oficina' }).expect(200);

    // 4 días de vencida: abre el caso, todavía no toca nada.
    expect(await runOn(a.token, '2026-03-14')).toMatchObject({ opened: 1, remindersQueued: 0 });
    const opened = (await cases(a.token)).items[0];
    expect(opened).toMatchObject({ stage: 'Recordatorio', nextAction: 'Recordatorio', tenantNames: 'Iris Inquilina' });
    expect(opened.nextActionAt).toBe('2026-03-15T00:00:00.000Z');

    // Día 5: recordatorio amable con el importe exacto de hoy (el mismo del cálculo de la liquidación).
    expect(await runOn(a.token, '2026-03-15')).toMatchObject({ opened: 0, remindersQueued: 1 });
    const payoff = (await get(a.token, `/liquidaciones/${d.march.id}/payoff?date=2026-03-15`).expect(200)).body;
    const [first] = await queued(a.tenantId);
    expect(first).toMatchObject({ channel: 'WhatsApp', templateKey: 'payment_reminder_1', to: '5493515550101', relatedId: opened.id });
    expect(first.vars).toMatchObject({ name: 'Iris Inquilina', amount: `ARS ${formatMoneyAR(payoff.total)}`, periods: '03/2026', agency: expect.any(String) });
    expect(first.idempotencyKey).toBe(`CollectionReminder:${opened.id}:1:2026-03-15:${d.tenantPerson}:WhatsApp`);
    // Correrlo otra vez el mismo día no repite nada.
    expect(await runOn(a.token, '2026-03-15')).toMatchObject({ remindersQueued: 0 });
    expect(await queued(a.tenantId)).toHaveLength(1);

    // Días 10 y 15: más firmes.
    await runOn(a.token, '2026-03-20');
    await runOn(a.token, '2026-03-25');
    expect((await queued(a.tenantId)).map((m) => m.templateKey)).toEqual(['payment_reminder_1', 'payment_reminder_2', 'payment_reminder_3']);

    // Al vencer el alquiler siguiente (10/04): el 11/04 se prepara el borrador y no sale ningún mensaje más.
    expect(await runOn(a.token, '2026-04-10')).toMatchObject({ lettersPrepared: 0 });
    expect(await runOn(a.token, '2026-04-11')).toMatchObject({ lettersPrepared: 1 });
    expect(await queued(a.tenantId)).toHaveLength(3);
    let detail = (await get(a.token, `/collection-cases/${opened.id}`).expect(200)).body;
    expect(detail).toMatchObject({ stage: 'Prejudicial', planStatus: 'AwaitingLetterConfirmation', nextAction: 'CartaDocumento', nextActionManual: true });
    expect(detail.debt).toHaveLength(2);
    const letter = detail.actions.find((x: any) => x.kind === 'CartaDocumento');
    expect(letter).toMatchObject({ status: 'Preparada', onDate: null });
    expect(letter.letter).toMatchObject({ recipientName: 'Iris Inquilina', recipientAddress: 'Calle Falsa 123', periods: '03/2026 y 04/2026', termDays: 10, issuedOn: '11/04/2026' });

    // El PDF es un borrador; se edita y recién entonces se confirma el envío (nunca sale solo).
    const pdf = await get(a.tokens[UserRole.Lectura], `/collection-cases/${opened.id}/actions/${letter.id}/letter.pdf`).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    await patch(a.tokens[UserRole.Lectura], `/collection-cases/${opened.id}/actions/${letter.id}`, { termDays: 12 }).expect(403);
    await patch(a.tokens[UserRole.Liquidaciones], `/collection-cases/${opened.id}/actions/${letter.id}`, { recipientAddress: 'Av. Demo 55', termDays: 10 }).expect(200);
    await post(a.token, `/collection-cases/${opened.id}/actions/${letter.id}/sent`, { sentOn: '2026-04-10' }).expect(400);
    await post(a.token, `/collection-cases/${opened.id}/actions/${letter.id}/sent`, { sentOn: '2099-01-01' }).expect(400);
    detail = (await post(a.tokens[UserRole.Liquidaciones], `/collection-cases/${opened.id}/actions/${letter.id}/sent`, { sentOn: '2026-04-13', note: 'Pieza CD 123' }).expect(200)).body;
    expect(detail.actions.find((x: any) => x.id === letter.id)).toMatchObject({ status: 'Realizada', onDate: '2026-04-13T00:00:00.000Z', letter: { recipientAddress: 'Av. Demo 55' } });
    expect(detail).toMatchObject({ nextAction: 'DerivacionAbogado', nextActionAt: '2026-04-23T00:00:00.000Z', nextActionManual: true });
    await post(a.token, `/collection-cases/${opened.id}/actions/${letter.id}/sent`, { sentOn: '2026-04-13' }).expect(409);
    await patch(a.token, `/collection-cases/${opened.id}/actions/${letter.id}`, { termDays: 5 }).expect(409);

    // Vencido el plazo se sugiere derivar, pero el sistema no deriva: es de la gerencia.
    await runOn(a.token, '2026-04-23');
    expect((await get(a.token, `/collection-cases/${opened.id}`).expect(200)).body.stage).toBe('Prejudicial');
    await post(a.tokens[UserRole.Liquidaciones], `/collection-cases/${opened.id}/derive`, { lawyer: 'Estudio Demo' }).expect(403);
    detail = (await post(a.tokens[UserRole.Gerente], `/collection-cases/${opened.id}/derive`, { lawyer: 'Estudio Demo', note: 'Plazo vencido' }).expect(200)).body;
    expect(detail).toMatchObject({ stage: 'Abogado', planStatus: 'Manual', nextAction: null });
    expect(await runOn(a.token, '2026-05-30')).toMatchObject({ remindersQueued: 0, lettersPrepared: 0 });
    await post(a.tokens[UserRole.Liquidaciones], `/collection-cases/${opened.id}/judicial`, {}).expect(403);
    expect((await post(a.token, `/collection-cases/${opened.id}/judicial`, { note: 'Expediente 1234/26' }).expect(200)).body.stage).toBe('Judicial');
    expect((await post(a.token, `/collection-cases/${opened.id}/derive`, {}).expect(400)).body.error).toBe('INVALID_TRANSITION');

    const audit = await prisma.baseClient.auditLog.findMany({ where: { tenantId: a.tenantId, entity: 'CollectionCase' } });
    expect(audit.length).toBeGreaterThanOrEqual(5);
    // La carta documento nunca pasa por la bandeja de salida: solo hay recordatorios.
    expect((await queued(a.tenantId)).every((m) => m.templateKey.startsWith('payment_reminder_'))).toBe(true);
  });

  it('CP-755 — la cobranza viene apagada: sin activarla no se abre ningún caso ni se encola nada', async () => {
    const a = await agency('cob-2', { enabled: false });
    await debtor(a, 'cob-2');
    expect(await runOn(a.token, '2026-03-20')).toMatchObject({ opened: 0, remindersQueued: 0 });
    expect((await cases(a.token)).total).toBe(0);
    expect(await queued(a.tenantId)).toHaveLength(0);
  });

  it('CP-756 — un pago parcial deja el caso abierto y uno total lo cierra', async () => {
    const a = await agency('cob-3');
    const d = await debtor(a, 'cob-3');
    await runOn(a.token, '2026-03-12');
    const id = (await cases(a.token)).items[0].id;

    await prisma.baseClient.payment.create({
      data: { tenantId: a.tenantId, liquidacionId: d.march.id, amount: '30000.00', method: 'Efectivo', paidAt: new Date('2026-03-13T12:00:00.000Z') },
    });
    await runOn(a.token, '2026-03-14');
    let detail = (await get(a.token, `/collection-cases/${id}`).expect(200)).body;
    expect(detail).toMatchObject({ stage: 'Recordatorio', balance: '170000.00' });
    expect(detail.actions.find((x: any) => x.kind === 'Pago')).toMatchObject({ amount: '30000.00' });

    await prisma.baseClient.payment.create({
      data: { tenantId: a.tenantId, liquidacionId: d.march.id, amount: '70000.00', method: 'Efectivo', paidAt: new Date('2026-03-14T12:00:00.000Z') },
    });
    await prisma.baseClient.liquidacion.update({ where: { id: d.march.id }, data: { status: 'Pagada' } });
    await prisma.baseClient.liquidacion.update({ where: { id: d.april.id }, data: { dueDate: new Date(Date.UTC(2026, 3, 10)), status: 'Pagada' } });
    expect(await runOn(a.token, '2026-03-15')).toMatchObject({ closed: 1, remindersQueued: 0 });
    detail = (await get(a.token, `/collection-cases/${id}`).expect(200)).body;
    expect(detail).toMatchObject({ stage: 'Cerrado', closeReason: 'Pagado', nextAction: null });
    expect((await cases(a.token)).total).toBe(0);
    expect((await cases(a.token, '?stage=Cerrado')).total).toBe(1);
    await post(a.token, `/collection-cases/${id}/notes`, { note: 'x' }).expect(409);
  });

  it('CP-757 — un acuerdo de pago pausa los avisos hasta su fecha; una nota y el responsable quedan en el caso', async () => {
    const a = await agency('cob-4');
    await debtor(a, 'cob-4');
    await runOn(a.token, '2026-03-12');
    const id = (await cases(a.token)).items[0].id;

    const next = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await post(a.token, `/collection-cases/${id}/agreement`, { payOn: '2020-01-01' }).expect(400);
    const detail = (await post(a.tokens[UserRole.Liquidaciones], `/collection-cases/${id}/agreement`, { payOn: next, amount: '50000', note: 'Paga la mitad' }).expect(200)).body;
    expect(detail).toMatchObject({ planStatus: 'Paused', nextAction: null });
    expect(await runOn(a.token, '2026-03-20')).toMatchObject({ remindersQueued: 0 });
    expect(await queued(a.tenantId)).toHaveLength(0);

    await post(a.tokens[UserRole.Liquidaciones], `/collection-cases/${id}/notes`, { note: 'Llamó la inquilina' }).expect(200);
    const me = a.adminId;
    const assigned = (await patch(a.token, `/collection-cases/${id}`, { assigneeId: me }).expect(200)).body;
    expect(assigned.assigneeName).toContain('Admin');
    expect((await cases(a.token, `?assigneeId=${me}`)).total).toBe(1);
    await patch(a.token, `/collection-cases/${id}`, { assigneeId: '5b3a8c1e-6c5d-4a49-9d6a-0f2f1a1b2c3d' }).expect(400);
    const closed = (await post(a.token, `/collection-cases/${id}/close`, { note: 'Pagó en efectivo' }).expect(200)).body;
    expect(closed).toMatchObject({ stage: 'Cerrado', closeReason: 'Manual' });
  });

  it('CP-758 — un contacto sin canal queda registrado y avisa a la gerencia; el mail sale cuando no hay alta de WhatsApp', async () => {
    const a = await agency('cob-5');
    const d = await debtor(a, 'cob-5');
    // Sin alta de WhatsApp el recordatorio va por mail.
    await runOn(a.token, '2026-03-15');
    expect((await queued(a.tenantId)).map((m) => [m.channel, m.to])).toEqual([['Email', 'iris@cob-5.test']]);

    // Con la baja del mail, el siguiente no tiene a dónde salir: queda anotado.
    await put(a.token, `/persons/${d.tenantPerson}/consents`, { channel: 'Email', status: 'OptOut', note: 'Pidió la baja' }).expect(200);
    await runOn(a.token, '2026-03-20');
    const id = (await cases(a.token)).items[0].id;
    const detail = (await get(a.token, `/collection-cases/${id}`).expect(200)).body;
    expect(detail.actions.find((x: any) => x.level === 2)).toMatchObject({ channel: null, note: expect.stringContaining('Sin medio de contacto') });
    expect(await queued(a.tenantId)).toHaveLength(1);
    expect(await prisma.baseClient.notification.count({ where: { tenantId: a.tenantId, type: 'SystemAlert', entityType: 'CollectionCase' } })).toBeGreaterThan(0);
  });

  it('CP-759 — roles y aislamiento: Lectura consulta sin escribir, Ventas no entra y otra inmobiliaria no ve nada', async () => {
    const a = await agency('cob-6');
    await debtor(a, 'cob-6');
    const b = await agency('cob-7');
    await runOn(a.token, '2026-03-12');
    const id = (await cases(a.token)).items[0].id;

    expect((await cases(a.tokens[UserRole.Lectura])).total).toBe(1);
    await get(a.tokens[UserRole.Ventas], '/collection-cases').expect(403);
    await post(a.tokens[UserRole.Lectura], `/collection-cases/${id}/notes`, { note: 'x' }).expect(403);
    await post(a.tokens[UserRole.Lectura], `/collection-cases/${id}/close`, { note: 'x' }).expect(403);
    await post(a.tokens[UserRole.Liquidaciones], '/collection-cases/_run-now', {}).expect(403);

    expect((await cases(b.token)).total).toBe(0);
    await get(b.token, `/collection-cases/${id}`).expect(404);
    await post(b.token, `/collection-cases/${id}/notes`, { note: 'x' }).expect(404);
    await get(a.token, '/collection-cases?stage=Nada').expect(400);
    expect((await cases(a.token, '?minDays=3000')).total).toBe(0);
    expect((await cases(a.token, '?minDays=1')).total).toBe(1);
  });
});
