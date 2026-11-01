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

const PdfPrinter = require('pdfmake/src/printer');

const PASSWORD = 'Password123!';
const ALL_ROLES = Object.values(UserRole);

describe('Generador de liquidaciones (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const setup = await setupTestApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await teardownTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  afterEach(() => jest.restoreAllMocks());

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => http().get(`/api${path}`).set(auth(token));
  const post = (token: string, path: string, body: object = {}) =>
    http().post(`/api${path}`).set(auth(token)).send(body);

  async function agency(tag: string) {
    const admin = await registerUser(app, {
      email: `admin@${tag}.test`,
      password: PASSWORD,
      firstName: 'Admin',
      lastName: 'Prueba',
    });
    const tokens = { [UserRole.Admin]: admin.accessToken } as Record<UserRole, string>;
    for (const role of ALL_ROLES.filter((r) => r !== UserRole.Admin)) {
      const email = `${role.toLowerCase()}@${tag}.test`;
      await createUserDirect(prisma, admin.user.tenantId, { email, password: PASSWORD, role });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    return { tenantId: admin.user.tenantId as string, tokens };
  }

  async function createContract(token: string, extra: Record<string, unknown> = {}, ownerName = 'Ana') {
    const owner = (await post(token, '/persons', { firstName: ownerName, lastName: 'Sintética' }).expect(201)).body.id;
    const tenantPerson = (await post(token, '/persons', { firstName: 'Ines', lastName: 'Sintética' }).expect(201)).body.id;
    await post(token, `/persons/${tenantPerson}/roles`, { role: PersonRole.Inquilino }).expect(201);
    const property = await post(token, '/properties', {
      title: 'Unidad de prueba',
      type: PropertyType.Departamento,
    }).expect(201);
    const res = await post(token, '/contracts', {
      propertyId: property.body.id,
      contractType: ContractType.Alquiler,
      status: ContractStatus.Activo,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2028-12-31T00:00:00.000Z',
      rentAmount: '300000.00',
      rentCurrency: 'ARS',
      adjustmentType: AdjustmentType.IPC,
      adjustmentPeriod: AdjustmentPeriod.Trimestral,
      guarantees: [],
      persons: [
        { personId: owner, role: PersonRole.Propietario },
        { personId: tenantPerson, role: PersonRole.Inquilino },
      ],
      ...extra,
    }).expect(201);
    return res.body as any;
  }

  const generate = (token: string, month: number, year: number) =>
    post(token, '/liquidaciones/generate', { month, year }).expect(201);

  const liquidaciones = async (token: string) =>
    (await get(token, '/liquidaciones?limit=100').expect(200)).body.items as any[];

  // ─── Fechas del contrato, prorrateo y vencimiento ───

  describe('fechas del contrato', () => {
    it('CP-303 — un contrato que empieza el 16 prorratea el primer mes y vence el día de inicio', async () => {
      const { tokens } = await agency('gen-1');
      const token = tokens[UserRole.Admin];
      await createContract(token, { startDate: '2026-11-16T00:00:00.000Z' });

      const res = await generate(token, 11, 2026);
      expect(res.body).toMatchObject({ created: 1, outOfRange: 0, total: 1 });

      const [liq] = await liquidaciones(token);
      expect(liq).toMatchObject({ total: '150000', kind: 'Mensual', isProvisional: false });
      expect(liq.dueDate).toBe('2026-11-16T00:00:00.000Z');
      const rent = liq.lineItems[0];
      expect(rent).toMatchObject({ type: 'Alquiler', amount: '150000', commissionable: true, beneficiary: 'Locador' });
      expect(rent.description).toContain('proporcional: 15 de 30 días');

      // El mes siguiente es completo y vence el 10.
      await generate(token, 12, 2026);
      const dec = (await liquidaciones(token)).find((l) => l.period.startsWith('2026-12'));
      expect(dec).toMatchObject({ total: '300000' });
      expect(dec.dueDate).toBe('2026-12-10T00:00:00.000Z');
    });

    it('CP-304 — no hay liquidación antes del inicio ni después del fin real', async () => {
      const { tokens } = await agency('gen-2');
      const token = tokens[UserRole.Admin];
      const future = await createContract(token, { startDate: '2026-12-01T00:00:00.000Z' });
      const ended = await createContract(token);
      await http()
        .patch(`/api/contracts/${ended.id}`)
        .set(auth(token))
        .send({ actualEndDate: '2026-10-31T00:00:00.000Z' })
        .expect(200);
      const ok = await createContract(token);

      const res = await generate(token, 11, 2026);
      expect(res.body).toMatchObject({ created: 1, outOfRange: 1, failed: 0, total: 2 });
      const byContract = Object.fromEntries(res.body.results.map((r: any) => [r.contractId, r]));
      // Un contrato que empieza después del mes ni se consulta.
      expect(byContract[future.id]).toBeUndefined();
      expect(byContract[ended.id]).toMatchObject({ status: 'out_of_range', reason: 'AfterEnd' });
      expect(byContract[ok.id]).toMatchObject({ status: 'created' });
      expect(await liquidaciones(token)).toHaveLength(1);
    });

    it('CP-305 — el último mes con fin real se prorratea', async () => {
      const { tokens } = await agency('gen-3');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);
      await http()
        .patch(`/api/contracts/${contract.id}`)
        .set(auth(token))
        .send({ actualEndDate: '2026-11-15T00:00:00.000Z' })
        .expect(200);
      await generate(token, 11, 2026);
      const [liq] = await liquidaciones(token);
      expect(liq.total).toBe('150000');
    });

    it('CP-306 — pasado el fin pactado sin fin real, un contrato Activo sigue liquidando', async () => {
      const { tokens } = await agency('gen-4');
      const token = tokens[UserRole.Admin];
      await createContract(token, { startDate: '2025-01-01T00:00:00.000Z', endDate: '2026-06-30T00:00:00.000Z' });
      const res = await generate(token, 11, 2026);
      expect(res.body.created).toBe(1);
      expect((await liquidaciones(token))[0].total).toBe('300000');
    });

    it('CP-307 — generar dos veces no duplica (idempotente)', async () => {
      const { tokens } = await agency('gen-5');
      const token = tokens[UserRole.Admin];
      await createContract(token);
      await generate(token, 11, 2026);
      const again = await generate(token, 11, 2026);
      expect(again.body).toMatchObject({ created: 0, skipped: 1 });
      expect(await liquidaciones(token)).toHaveLength(1);
    });
  });

  describe('reglas vigentes en el período', () => {
    it('CP-308 — vencimiento y bonificación de la versión de reglas vigente en el mes', async () => {
      const { tokens } = await agency('gen-6');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);
      await post(token, `/contracts/${contract.id}/agreements`, {
        kind: 'Bonificacion',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        termsPatch: { dueDay: 20, discountPct: '10' },
      }).expect(201);

      await generate(token, 5, 2026);
      await generate(token, 7, 2026);
      const items = await liquidaciones(token);
      const may = items.find((l) => l.period.startsWith('2026-05'));
      const jul = items.find((l) => l.period.startsWith('2026-07'));

      expect(may.dueDate).toBe('2026-05-10T00:00:00.000Z');
      expect(may.total).toBe('300000');
      expect(jul.dueDate).toBe('2026-07-20T00:00:00.000Z');
      expect(jul.subtotal).toBe('300000');
      expect(jul.total).toBe('270000');
      const discount = jul.lineItems.find((li: any) => li.type === 'Descuento');
      expect(discount).toMatchObject({ amount: '30000', commissionable: true, beneficiary: 'Locador' });
    });

    it('CP-309 — un período pasado usa el alquiler de entonces, no el vigente hoy', async () => {
      const { tenantId, tokens } = await agency('gen-7');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);
      await prisma.baseClient.contractAdjustment.create({
        data: {
          tenantId,
          contractId: contract.id,
          periodNumber: 1,
          adjustmentDate: new Date('2026-07-01T00:00:00.000Z'),
          previousAmount: '300000',
          newAmount: '360000',
          percentage: '20',
          calculatedAt: new Date('2026-06-15T00:00:00.000Z'),
          appliedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      });
      await prisma.baseClient.contract.update({ where: { id: contract.id }, data: { rentAmount: '360000' } });

      await generate(token, 3, 2026);
      await generate(token, 8, 2026);
      const items = await liquidaciones(token);
      expect(items.find((l) => l.period.startsWith('2026-03')).total).toBe('300000');
      expect(items.find((l) => l.period.startsWith('2026-08')).total).toBe('360000');
    });

    it('CP-310 — un alquiler con ajuste provisional da un pago a cuenta provisional', async () => {
      const { tenantId, tokens } = await agency('gen-8');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);
      await prisma.baseClient.contractAdjustment.create({
        data: {
          tenantId,
          contractId: contract.id,
          periodNumber: 1,
          adjustmentDate: new Date('2026-04-01T00:00:00.000Z'),
          previousAmount: '300000',
          newAmount: '330000',
          percentage: '10',
          calculatedAt: new Date('2026-03-15T00:00:00.000Z'),
          appliedAt: new Date('2026-04-01T00:00:00.000Z'),
          isProvisional: true,
        },
      });
      await generate(token, 5, 2026);
      const [liq] = await liquidaciones(token);
      expect(liq).toMatchObject({ kind: 'PagoACuenta', isProvisional: true, total: '330000' });
    });
  });

  // ─── Renglones con destino ──────────────────────────

  describe('renglones con destino y comisionable', () => {
    it('CP-311 — un renglón manual toma el destino y la comisión del tipo, o los indicados', async () => {
      const { tokens } = await agency('lines-1');
      const token = tokens[UserRole.Admin];
      await createContract(token);
      await generate(token, 11, 2026);
      const [liq] = await liquidaciones(token);

      const add = (body: object) => post(token, `/liquidaciones/${liq.id}/line-items`, body).expect(201);
      await add({ type: 'Extra', description: 'Reparación canilla', amount: '5000' });
      await add({ type: 'Honorario', description: 'Gestión', amount: '500' });
      await add({ type: 'Servicio', description: 'Gas', amount: '4200' });
      await add({ type: 'Multa', description: 'Punitorio', amount: '900' });
      const res = await add({ type: 'Impuesto', description: 'ABL', amount: '3000', beneficiary: 'Locador' });

      const flags = Object.fromEntries(
        res.body.lineItems.map((li: any) => [li.type, [li.commissionable, li.beneficiary]]),
      );
      expect(flags).toEqual({
        Alquiler: [true, 'Locador'],
        Extra: [false, 'Locador'],
        Honorario: [false, 'Inmobiliaria'],
        Servicio: [false, 'Ente'],
        Multa: [true, 'Locador'],
        Impuesto: [false, 'Locador'],
      });
      expect(res.body.total).toBe('313600');
    });

    it('CP-312 — un tipo o destino inválido se rechaza con 400', async () => {
      const { tokens } = await agency('lines-2');
      const token = tokens[UserRole.Admin];
      await createContract(token);
      await generate(token, 11, 2026);
      const [liq] = await liquidaciones(token);
      await post(token, `/liquidaciones/${liq.id}/line-items`, {
        type: 'Extra',
        description: 'x',
        amount: '1',
        beneficiary: 'Vecino',
      }).expect(400);
    });
  });

  // ─── Cron diario y _run-now ─────────────────────────

  describe('generación automática', () => {
    it('CP-313 — el proceso diario genera el mes siguiente a diez días del mes, por inmobiliaria y con auditoría', async () => {
      const a = await agency('cron-a');
      const b = await agency('cron-b');
      await createContract(a.tokens[UserRole.Admin]);
      await createContract(b.tokens[UserRole.Admin]);
      await createContract(b.tokens[UserRole.Admin]);

      const run = (today: string) =>
        post(a.tokens[UserRole.Admin], '/liquidaciones/_run-now', { today }).expect(200);

      // Antes de la ventana no genera nada.
      expect((await run('2026-10-21')).body.created).toBe(0);
      expect(await liquidaciones(a.tokens[UserRole.Admin])).toHaveLength(0);

      const first = await run('2026-10-22');
      expect(first.body).toMatchObject({ tenantsProcessed: 2, tenantsFailed: 0, created: 3 });

      // Cada inmobiliaria ve solo lo suyo.
      const mine = await liquidaciones(a.tokens[UserRole.Admin]);
      const theirs = await liquidaciones(b.tokens[UserRole.Admin]);
      expect(mine).toHaveLength(1);
      expect(theirs).toHaveLength(2);
      expect(mine[0].period).toBe('2026-11-01T00:00:00.000Z');
      expect(mine.every((l) => l.tenantId === a.tenantId)).toBe(true);
      expect(theirs.every((l) => l.tenantId === b.tenantId)).toBe(true);

      // Idempotente: otra corrida no repite ni vuelve a auditar.
      const second = await run('2026-10-23');
      expect(second.body.created).toBe(0);

      const audits = await prisma.baseClient.auditLog.findMany({
        where: { entity: 'Liquidacion', tenantId: { in: [a.tenantId, b.tenantId] } },
      });
      expect(audits).toHaveLength(2);
      expect(audits.map((x) => x.tenantId).sort()).toEqual([a.tenantId, b.tenantId].sort());
    });

    it('CP-314 — la anticipación sale de los valores por defecto de la inmobiliaria', async () => {
      const { tokens } = await agency('cron-lead');
      const token = tokens[UserRole.Admin];
      await createContract(token);
      await http()
        .put('/api/tenants/me/operational-defaults')
        .set(auth(token))
        .send({ leadDays: 20 })
        .expect(200);

      expect((await post(token, '/liquidaciones/_run-now', { today: '2026-10-11' }).expect(200)).body.created).toBe(0);
      expect((await post(token, '/liquidaciones/_run-now', { today: '2026-10-12' }).expect(200)).body.created).toBe(1);
    });

    it('CP-315 — _run-now es solo del Admin y valida la fecha', async () => {
      const { tokens } = await agency('cron-rbac');
      for (const role of ALL_ROLES.filter((r) => r !== UserRole.Admin)) {
        await post(tokens[role], '/liquidaciones/_run-now', {}).expect(403);
      }
      await post(tokens[UserRole.Admin], '/liquidaciones/_run-now', { today: '22/10/2026' }).expect(400);
      await post(tokens[UserRole.Admin], '/liquidaciones/_run-now', {}).expect(200);
      await http().post('/api/liquidaciones/_run-now').send({}).expect(401);
    });

    it('CP-316 — generate sigue pidiendo rol de facturación', async () => {
      const { tokens } = await agency('gen-rbac');
      await post(tokens[UserRole.Lectura], '/liquidaciones/generate', { month: 11, year: 2026 }).expect(403);
      await post(tokens[UserRole.Liquidaciones], '/liquidaciones/generate', { month: 11, year: 2026 }).expect(201);
    });
  });

  // ─── Convenciones pactables ─────────────────────────

  describe('convenciones de liquidación pactables', () => {
    const termsOf = async (token: string, contractId: string) =>
      (await get(token, `/contracts/${contractId}/terms`).expect(200)).body.current;

    const FACTORY = {
      prorationMode: 'DiasReales',
      midMonthAdjustmentMode: 'DesdePeriodoSiguiente',
      firstDueMode: 'DiaDeInicio',
      fixedDiscountProration: 'Proporcional',
    };

    it('CP-323 — el contrato nace con las convenciones de la inmobiliaria o con las pactadas en el alta', async () => {
      const { tokens } = await agency('conv-1');
      const token = tokens[UserRole.Admin];

      const plain = await createContract(token);
      expect(await termsOf(token, plain.id)).toMatchObject(FACTORY);

      await http()
        .put('/api/tenants/me/operational-defaults')
        .set(auth(token))
        .send({ prorationMode: 'Mes30', firstDueMode: 'AlFirmar' })
        .expect(200);
      const withDefaults = await createContract(token);
      expect(await termsOf(token, withDefaults.id)).toMatchObject({
        ...FACTORY,
        prorationMode: 'Mes30',
        firstDueMode: 'AlFirmar',
      });
      // El contrato anterior no cambia: el valor por defecto rige para los que se cargan después.
      expect(await termsOf(token, plain.id)).toMatchObject(FACTORY);

      const own = await createContract(token, {
        liquidationRules: { prorationMode: 'SinProrrateo', fixedDiscountProration: 'Completo' },
      });
      expect(await termsOf(token, own.id)).toMatchObject({
        prorationMode: 'SinProrrateo',
        midMonthAdjustmentMode: 'DesdePeriodoSiguiente',
        firstDueMode: 'AlFirmar',
        fixedDiscountProration: 'Completo',
      });
    });

    it('CP-324 — valores inválidos se rechazan con 400 y no se guarda nada', async () => {
      const { tokens } = await agency('conv-2');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);
      await http()
        .patch(`/api/contracts/${contract.id}`)
        .set(auth(token))
        .send({ liquidationRules: { prorationMode: 'Quincena' } })
        .expect(400);
      await http()
        .put('/api/tenants/me/operational-defaults')
        .set(auth(token))
        .send({ firstDueMode: 'Nunca' })
        .expect(400);
      expect(await termsOf(token, contract.id)).toMatchObject(FACTORY);
    });

    it('CP-325 — se corrigen en la versión inicial y, con convenios, solo por convenio', async () => {
      const { tokens } = await agency('conv-3');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);

      const patched = await http()
        .patch(`/api/contracts/${contract.id}`)
        .set(auth(token))
        .send({ liquidationRules: { midMonthAdjustmentMode: 'Prorrateado' } })
        .expect(200);
      expect(patched.body.id).toBe(contract.id);
      expect(await termsOf(token, contract.id)).toMatchObject({
        ...FACTORY,
        midMonthAdjustmentMode: 'Prorrateado',
      });

      await post(token, `/contracts/${contract.id}/agreements`, {
        kind: 'CambioRegla',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        termsPatch: { prorationMode: 'Mes30' },
      }).expect(201);
      // La versión nueva copia las convenciones vigentes y cambia solo lo del convenio.
      expect(await termsOf(token, contract.id)).toMatchObject({
        prorationMode: 'Mes30',
        midMonthAdjustmentMode: 'Prorrateado',
      });
      const blocked = await http()
        .patch(`/api/contracts/${contract.id}`)
        .set(auth(token))
        .send({ liquidationRules: { firstDueMode: 'AlFirmar' } })
        .expect(409);
      expect(blocked.body.error).toBe('RULES_CHANGE_REQUIRES_AGREEMENT');
    });

    it('CP-326 — el prorrateo del primer mes sigue la convención pactada', async () => {
      const { tokens } = await agency('conv-4');
      const token = tokens[UserRole.Admin];
      const dias = await createContract(token, { startDate: '2026-12-16T00:00:00.000Z' });
      const mes30 = await createContract(token, {
        startDate: '2026-12-16T00:00:00.000Z',
        liquidationRules: { prorationMode: 'Mes30' },
      });
      const sin = await createContract(token, {
        startDate: '2026-12-16T00:00:00.000Z',
        liquidationRules: { prorationMode: 'SinProrrateo' },
      });
      await generate(token, 12, 2026);
      const byContract = Object.fromEntries((await liquidaciones(token)).map((l) => [l.contractId, l]));
      expect(byContract[dias.id].total).toBe('154838.71'); // 300000 x 16 / 31
      expect(byContract[mes30.id].total).toBe('150000'); // 15 de 30
      expect(byContract[sin.id].total).toBe('300000');
    });

    it('CP-327 — un convenio con fecha cambia la convención desde ese período', async () => {
      const { tokens } = await agency('conv-5');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token, {
        startDate: '2026-01-16T00:00:00.000Z',
        liquidationRules: { prorationMode: 'SinProrrateo' },
      });
      await post(token, `/contracts/${contract.id}/agreements`, {
        kind: 'CambioRegla',
        effectiveFrom: '2026-12-01T00:00:00.000Z',
        termsPatch: { prorationMode: 'DiasReales' },
      }).expect(201);
      await http()
        .patch(`/api/contracts/${contract.id}`)
        .set(auth(token))
        .send({ actualEndDate: '2026-12-20T00:00:00.000Z' })
        .expect(200);
      await generate(token, 12, 2026);
      // Diciembre rige la versión nueva: 20 de 31 días reales.
      expect((await liquidaciones(token))[0].total).toBe('193548.39');
    });

    it('CP-328 — el ajuste a mitad de mes se ignora, se aplica al mes o se parte por días', async () => {
      const { tenantId, tokens } = await agency('conv-6');
      const token = tokens[UserRole.Admin];
      const adjust = async (id: string) => {
        await prisma.baseClient.contractAdjustment.create({
          data: {
            tenantId,
            contractId: id,
            periodNumber: 1,
            adjustmentDate: new Date('2026-11-15T00:00:00.000Z'),
            previousAmount: '300000',
            newAmount: '330000',
            percentage: '10',
            calculatedAt: new Date('2026-10-20T00:00:00.000Z'),
            appliedAt: new Date('2026-11-15T00:00:00.000Z'),
          },
        });
        await prisma.baseClient.contract.update({ where: { id }, data: { rentAmount: '330000' } });
      };
      const siguiente = await createContract(token);
      const mes = await createContract(token, { liquidationRules: { midMonthAdjustmentMode: 'DesdeEsePeriodo' } });
      const partido = await createContract(token, { liquidationRules: { midMonthAdjustmentMode: 'Prorrateado' } });
      for (const c of [siguiente, mes, partido]) await adjust(c.id);

      await generate(token, 11, 2026);
      const byContract = Object.fromEntries((await liquidaciones(token)).map((l) => [l.contractId, l]));
      expect(byContract[siguiente.id].total).toBe('300000');
      expect(byContract[mes.id].total).toBe('330000');
      expect(byContract[partido.id].total).toBe('316000'); // 14 días a 300000 y 16 a 330000
      expect(byContract[partido.id].lineItems.map((li: any) => li.amount)).toEqual(['140000', '176000']);
      expect(byContract[partido.id].lineItems.every((li: any) => li.commissionable)).toBe(true);
    });

    it('CP-329 — al firmar: el primer mes no se liquida y se informa; el siguiente sí', async () => {
      const { tokens } = await agency('conv-7');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token, {
        startDate: '2026-11-16T00:00:00.000Z',
        liquidationRules: { firstDueMode: 'AlFirmar' },
      });
      const nov = await generate(token, 11, 2026);
      expect(nov.body).toMatchObject({ created: 0, outOfRange: 0, notBilled: 1 });
      expect(nov.body.results[0]).toMatchObject({
        contractId: contract.id,
        status: 'not_billed',
        reason: 'ChargedAtSigning',
      });
      expect(await liquidaciones(token)).toHaveLength(0);

      const dec = await generate(token, 12, 2026);
      expect(dec.body.created).toBe(1);
      expect((await liquidaciones(token))[0].total).toBe('300000');
    });

    it('CP-330 — inicio tardío con cobro en el mes siguiente: un solo cobro, sin duplicar', async () => {
      const { tokens } = await agency('conv-8');
      const token = tokens[UserRole.Admin];
      await createContract(token, {
        startDate: '2026-11-16T00:00:00.000Z',
        liquidationRules: { firstDueMode: 'VencimientoMesSiguiente' },
      });
      const nov = await generate(token, 11, 2026);
      expect(nov.body.results[0]).toMatchObject({ status: 'not_billed', reason: 'DeferredToNextPeriod' });

      await generate(token, 12, 2026);
      const [dec] = await liquidaciones(token);
      expect(dec.total).toBe('450000');
      expect(dec.dueDate).toBe('2026-12-10T00:00:00.000Z');
      const deferred = dec.lineItems.find((li: any) => li.sourceType === 'DeferredFirstMonth');
      expect(deferred).toMatchObject({ type: 'Alquiler', amount: '150000', commissionable: true, beneficiary: 'Locador' });
      expect(deferred.description).toContain('cobrado con este período');
    });

    it('CP-331 — por defecto (día de inicio) el primer mes vence el día de inicio, como siempre', async () => {
      const { tokens } = await agency('conv-9');
      const token = tokens[UserRole.Admin];
      await createContract(token, { startDate: '2026-11-16T00:00:00.000Z' });
      await generate(token, 11, 2026);
      const [liq] = await liquidaciones(token);
      expect(liq.total).toBe('150000');
      expect(liq.dueDate).toBe('2026-11-16T00:00:00.000Z');
    });

    it('CP-332 — el descuento fijo se prorratea o se aplica completo según lo pactado', async () => {
      const { tokens } = await agency('conv-10');
      const token = tokens[UserRole.Admin];
      const proporcional = await createContract(token, { startDate: '2026-11-16T00:00:00.000Z' });
      const completo = await createContract(token, {
        startDate: '2026-11-16T00:00:00.000Z',
        liquidationRules: { fixedDiscountProration: 'Completo' },
      });
      // Un convenio no puede fecharse el día de inicio (ya hay una versión): se carga en la versión inicial.
      await prisma.baseClient.contractTermsVersion.updateMany({
        where: { contractId: { in: [proporcional.id, completo.id] } },
        data: { discountAmount: '20000' },
      });
      await generate(token, 11, 2026);
      const byContract = Object.fromEntries((await liquidaciones(token)).map((l) => [l.contractId, l]));
      expect(byContract[proporcional.id].total).toBe('140000'); // 150000 - 10000
      expect(byContract[completo.id].total).toBe('130000'); // 150000 - 20000
    });

    it('CP-333 — sin versión de reglas rigen los valores por defecto de la inmobiliaria', async () => {
      const { tenantId, tokens } = await agency('conv-11');
      const token = tokens[UserRole.Admin];
      await http().put('/api/tenants/me/operational-defaults').set(auth(token)).send({ prorationMode: 'SinProrrateo' }).expect(200);
      const contract = await createContract(token, { startDate: '2026-12-16T00:00:00.000Z' });
      await prisma.baseClient.contractTermsVersion.deleteMany({ where: { contractId: contract.id, tenantId } });
      await generate(token, 12, 2026);
      expect((await liquidaciones(token))[0].total).toBe('300000');
    });
  });

  // ─── Recibo ─────────────────────────────────────────

  describe('recibo', () => {
    async function approve(token: string, id: string) {
      await post(token, `/liquidaciones/${id}/transition`, { status: 'Revision' }).expect(200);
      return (await post(token, `/liquidaciones/${id}/transition`, { status: 'Aprobada' }).expect(200)).body;
    }

    it('CP-317 — el número se asigna al aprobar, correlativo por inmobiliaria y sin reasignarse', async () => {
      const a = await agency('rec-a');
      const b = await agency('rec-b');
      const ta = a.tokens[UserRole.Admin];
      const tb = b.tokens[UserRole.Admin];
      await createContract(ta);
      await createContract(ta);
      await createContract(tb);
      await generate(ta, 11, 2026);
      await generate(tb, 11, 2026);

      const [a1, a2] = await liquidaciones(ta);
      const [b1] = await liquidaciones(tb);
      expect((await get(ta, `/liquidaciones/${a1.id}`).expect(200)).body.receiptNumber).toBeNull();

      const first = await approve(ta, a1.id);
      const second = await approve(ta, a2.id);
      const other = await approve(tb, b1.id);
      expect([first.receiptNumber, second.receiptNumber]).toEqual(['00000001', '00000002']);
      expect(other.receiptNumber).toBe('00000001');

      // Enviar no cambia el número.
      const sent = await post(ta, `/liquidaciones/${a1.id}/transition`, { status: 'Enviada' }).expect(200);
      expect(sent.body.receiptNumber).toBe('00000001');
      expect(sent.body.receiptSeq).toBe(1);
    });

    it('CP-318 — aprobaciones simultáneas no repiten número', async () => {
      const { tokens } = await agency('rec-race');
      const token = tokens[UserRole.Admin];
      for (let i = 0; i < 4; i++) await createContract(token);
      await generate(token, 11, 2026);
      const items = await liquidaciones(token);
      for (const l of items) await post(token, `/liquidaciones/${l.id}/transition`, { status: 'Revision' }).expect(200);
      await Promise.all(
        items.map((l) => post(token, `/liquidaciones/${l.id}/transition`, { status: 'Aprobada' }).expect(200)),
      );
      const seqs = (await liquidaciones(token)).map((l) => l.receiptSeq).sort();
      expect(seqs).toEqual([1, 2, 3, 4]);
    });

    it('CP-319 — el PDF lleva número, monto en letras, por cuenta y orden y renglones por destino', async () => {
      const { tokens } = await agency('rec-pdf');
      const token = tokens[UserRole.Admin];
      await createContract(token, {}, 'Marta');
      await generate(token, 11, 2026);
      const [liq] = await liquidaciones(token);
      await post(token, `/liquidaciones/${liq.id}/line-items`, { type: 'Servicio', description: 'Gas 10/2026', amount: '4200.50' }).expect(201);
      await post(token, `/liquidaciones/${liq.id}/line-items`, { type: 'Honorario', description: 'Gestión', amount: '800' }).expect(201);
      await approve(token, liq.id);

      const docs: any[] = [];
      const original = PdfPrinter.prototype.createPdfKitDocument;
      jest.spyOn(PdfPrinter.prototype, 'createPdfKitDocument').mockImplementation(function (this: any, def: any) {
        docs.push(def);
        return original.call(this, def);
      });

      const pdf = await get(token, `/liquidaciones/${liq.id}/pdf`).expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');

      const texts: string[] = docs[0].content.flatMap((c: any) => (typeof c.text === 'string' ? [c.text] : []));
      expect(texts).toContain('RECIBO Nº 00000001');
      expect(texts).toContain('Son: Trescientos cinco mil pesos con cincuenta centavos.');
      expect(texts).toContain('Cobrado por cuenta y orden de Marta Sintética.');
      const table = docs[0].content.find((c: any) => c.table?.widths?.length === 3);
      const titles = table.table.body.filter((r: any[]) => r[0]?.colSpan === 3).map((r: any[]) => r[0].text);
      expect(titles).toEqual(['A favor del locador', 'A favor de entes y proveedores', 'A favor de la inmobiliaria']);
    });
  });
});
