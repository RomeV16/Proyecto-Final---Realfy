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
  DEFAULT_OPERATIONAL_DEFAULTS,
  UserRole,
  PersonRole,
  PropertyType,
  ContractType,
  AdjustmentType,
  AdjustmentPeriod,
} from '@realfy/shared';

const START = '2026-01-01T00:00:00.000Z';
const END = '2028-01-01T00:00:00.000Z';
const PASSWORD = 'Password123!';
const ALL_ROLES = Object.values(UserRole);
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('Reglas versionadas, acuerdos y valores por defecto (e2e)', () => {
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

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => http().get(`/api${path}`).set(auth(token));
  const post = (token: string, path: string, body: object) =>
    http().post(`/api${path}`).set(auth(token)).send(body);

  /** Inmobiliaria con un usuario de cada rol (el Admin es quien se registra). */
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

  async function createPerson(token: string, firstName: string) {
    const res = await post(token, '/persons', { firstName, lastName: 'Sintético' }).expect(201);
    return res.body.id as string;
  }

  async function createContract(token: string, extra: Record<string, unknown> = {}) {
    const owner = await createPerson(token, 'Ana');
    const tenantPerson = await createPerson(token, 'Ines');
    await post(token, `/persons/${tenantPerson}/roles`, { role: PersonRole.Inquilino }).expect(201);
    const property = await post(token, '/properties', {
      title: 'Unidad de prueba',
      type: PropertyType.Departamento,
    }).expect(201);
    const res = await post(token, '/contracts', {
      propertyId: property.body.id,
      contractType: ContractType.Alquiler,
      startDate: START,
      endDate: END,
      rentAmount: '100000.00',
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

  // ─── Valores por defecto de la inmobiliaria ─────────

  describe('valores por defecto', () => {
    it('CP-120 — sin configurar rigen los del código y cualquier rol los lee', async () => {
      const { tokens } = await agency('defaults-1');
      for (const role of ALL_ROLES) {
        const res = await get(tokens[role], '/tenants/me/operational-defaults').expect(200);
        expect(res.body).toEqual(DEFAULT_OPERATIONAL_DEFAULTS);
      }
    });

    it('CP-120 — Admin y Gerente guardan; el resto recibe 403; lo no enviado toma el valor del código', async () => {
      const { tokens } = await agency('defaults-2');
      const put = (token: string, body: object) =>
        http().put('/api/tenants/me/operational-defaults').set(auth(token)).send(body);

      for (const role of ALL_ROLES.filter((r) => r !== UserRole.Admin && r !== UserRole.Gerente)) {
        await put(tokens[role], { dueDay: 5 }).expect(403);
      }
      const saved = await put(tokens[UserRole.Gerente], { dueDay: 5, fees: { alta: 6 } }).expect(200);
      expect(saved.body.dueDay).toBe(5);
      expect(saved.body.fees).toEqual({ alta: 6, renovacion: 5, ventaConstruido: 3, ventaLote: 5 });
      expect(saved.body.ipcLagMonths).toBe(2);

      const read = await get(tokens[UserRole.Lectura], '/tenants/me/operational-defaults').expect(200);
      expect(read.body).toEqual(saved.body);
    });

    it('CP-120 — valida el cuerpo con 400 VALIDATION_ERROR y no guarda', async () => {
      const { tokens } = await agency('defaults-3');
      const res = await http()
        .put('/api/tenants/me/operational-defaults')
        .set(auth(tokens[UserRole.Admin]))
        .send({ dueDay: 40, surprise: true })
        .expect(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
      const read = await get(tokens[UserRole.Admin], '/tenants/me/operational-defaults').expect(200);
      expect(read.body).toEqual(DEFAULT_OPERATIONAL_DEFAULTS);
    });

    it('CP-120 — los valores de una inmobiliaria no se ven en otra', async () => {
      const a = await agency('defaults-4a');
      const b = await agency('defaults-4b');
      await http()
        .put('/api/tenants/me/operational-defaults')
        .set(auth(a.tokens[UserRole.Admin]))
        .send({ commissionPct: 9 })
        .expect(200);
      const other = await get(b.tokens[UserRole.Admin], '/tenants/me/operational-defaults').expect(200);
      expect(other.body.commissionPct).toBe(7);
    });

    it('CP-121 — un contrato nuevo nace con las reglas de los valores por defecto', async () => {
      const { tokens } = await agency('defaults-5');
      const token = tokens[UserRole.Admin];
      await http()
        .put('/api/tenants/me/operational-defaults')
        .set(auth(token))
        .send({ dueDay: 6, ipcLagMonths: 3 })
        .expect(200);

      const contract = await createContract(token);

      const terms = (await get(token, `/contracts/${contract.id}/terms`).expect(200)).body;
      expect(terms.versions).toHaveLength(1);
      expect(terms.current).toMatchObject({
        adjustmentType: 'IPC',
        adjustmentPeriod: 'Trimestral',
        adjustmentBase: 'Vigente',
        indexLagMonths: 3,
        dueDay: 6,
        paymentFlow: 'Partido',
      });
      expect(terms.current.validFrom).toBe(START);

      const periods = (await get(token, `/contracts/${contract.id}/periods`).expect(200)).body;
      expect(periods).toHaveLength(1);
      expect(periods[0]).toMatchObject({ seq: 1, kind: 'Original', initialRent: '100000' });
    });
  });

  // ─── Convenios y versiones ──────────────────────────

  describe('convenios', () => {
    it('CP-122 — un convenio de cambio de regla crea la versión y actualiza las columnas del contrato', async () => {
      const { tokens } = await agency('agr-1');
      const token = tokens[UserRole.Gerente];
      const contract = await createContract(tokens[UserRole.Admin]);

      const created = await post(token, `/contracts/${contract.id}/agreements`, {
        kind: 'CambioRegla',
        effectiveFrom: '2026-03-01T00:00:00.000Z',
        notes: 'Pasa a porcentaje fijo semestral',
        termsPatch: { adjustmentType: 'FixedPercent', adjustmentPeriod: 'Semestral', customPct: '12' },
      }).expect(201);
      expect(created.body.versions).toHaveLength(1);
      expect(created.body.versions[0]).toMatchObject({
        agreementId: created.body.id,
        adjustmentType: 'FixedPercent',
        // Lo que el convenio no cambia se copia de la versión anterior.
        dueDay: 10,
        indexLagMonths: 2,
      });

      const terms = (await get(token, `/contracts/${contract.id}/terms`).expect(200)).body;
      expect(terms.versions.map((v: any) => v.adjustmentType)).toEqual(['IPC', 'FixedPercent']);
      expect(terms.current.adjustmentType).toBe('FixedPercent');

      // Columnas vigentes del contrato en sincronía y cronograma semestral.
      const detail = (await get(token, `/contracts/${contract.id}`).expect(200)).body;
      expect(detail).toMatchObject({
        adjustmentType: 'FixedPercent',
        adjustmentPeriod: 'Semestral',
        customAdjustmentPct: '12',
      });
      expect(detail.schedules.length).toBe(4);
    });

    it('CP-122 — la versión vigente depende de la fecha consultada', async () => {
      const { tokens } = await agency('agr-2');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);
      await post(token, `/contracts/${contract.id}/agreements`, {
        kind: 'Bonificacion',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        termsPatch: { discountPct: '15' },
      }).expect(201);

      const before = (await get(token, `/contracts/${contract.id}/terms?at=2026-05-31T00:00:00.000Z`)).body;
      const after = (await get(token, `/contracts/${contract.id}/terms?at=2026-06-01T00:00:00.000Z`)).body;
      const beforeStart = (await get(token, `/contracts/${contract.id}/terms?at=2025-12-31T00:00:00.000Z`)).body;

      expect(before.current.discountPct).toBeNull();
      expect(after.current.discountPct).toBe('15');
      expect(beforeStart.current).toBeNull();
      await get(token, `/contracts/${contract.id}/terms?at=ayer`).expect(400);
    });

    it('CP-123 — un convenio con fecha futura crea la versión pero no toca las columnas', async () => {
      const { tokens } = await agency('agr-3');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);

      await post(token, `/contracts/${contract.id}/agreements`, {
        kind: 'CambioRegla',
        effectiveFrom: '2099-01-01T00:00:00.000Z',
        termsPatch: { adjustmentType: 'ICL' },
      }).expect(201);

      const detail = (await get(token, `/contracts/${contract.id}`).expect(200)).body;
      expect(detail.adjustmentType).toBe('IPC');
      const terms = (await get(token, `/contracts/${contract.id}/terms`).expect(200)).body;
      expect(terms.versions).toHaveLength(2);
      expect(terms.current.adjustmentType).toBe('IPC');
    });

    it('CP-123 — es atómico: una fecha repetida responde 409 y no deja convenio', async () => {
      const { tokens } = await agency('agr-4');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);
      const body = {
        kind: 'Rebaja',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        termsPatch: { discountPct: '10' },
      };
      await post(token, `/contracts/${contract.id}/agreements`, body).expect(201);

      const again = await post(token, `/contracts/${contract.id}/agreements`, body).expect(409);
      expect(again.body.error).toBe('TERMS_VERSION_EXISTS');

      const agreements = (await get(token, `/contracts/${contract.id}/agreements`).expect(200)).body;
      expect(agreements).toHaveLength(1);
      expect(await prisma.baseClient.contractTermsVersion.count({ where: { contractId: contract.id } })).toBe(2);
    });

    it('CP-123 — valida: fecha anterior al inicio, kind sin termsPatch y modalidad sin porcentaje', async () => {
      const { tokens } = await agency('agr-5');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);
      const path = `/contracts/${contract.id}/agreements`;

      const early = await post(token, path, {
        kind: 'Rebaja',
        effectiveFrom: '2025-06-01T00:00:00.000Z',
        termsPatch: { discountPct: '10' },
      }).expect(400);
      expect(early.body.error).toBe('AGREEMENT_BEFORE_START');

      const noPatch = await post(token, path, { kind: 'Rebaja', effectiveFrom: '2026-06-01T00:00:00.000Z' }).expect(400);
      expect(noPatch.body.error).toBe('VALIDATION_ERROR');

      const noPct = await post(token, path, {
        kind: 'CambioRegla',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        termsPatch: { adjustmentType: 'FixedPercent' },
      }).expect(400);
      expect(noPct.body.error).toBe('MISSING_ADJUSTMENT_PCT');
      expect(await prisma.baseClient.contractAgreement.count()).toBe(0);
    });

    it('CP-124 — solo Admin y Gerente registran convenios; todos los roles los leen', async () => {
      const { tokens } = await agency('agr-6');
      const contract = await createContract(tokens[UserRole.Admin]);
      const path = `/contracts/${contract.id}/agreements`;
      const body = { kind: 'CambioReparto', effectiveFrom: '2026-06-01T00:00:00.000Z' };

      for (const role of ALL_ROLES.filter((r) => r !== UserRole.Admin && r !== UserRole.Gerente)) {
        await post(tokens[role], path, body).expect(403);
      }
      const created = await post(tokens[UserRole.Gerente], path, body).expect(201);
      for (const role of ALL_ROLES) {
        await get(tokens[role], path).expect(200);
        await get(tokens[role], `/contracts/${contract.id}/terms`).expect(200);
        await get(tokens[role], `/contracts/${contract.id}/periods`).expect(200);
      }
      for (const role of ALL_ROLES.filter((r) => r !== UserRole.Admin && r !== UserRole.Gerente)) {
        await http().delete(`/api${path}/${created.body.id}`).set(auth(tokens[role])).expect(403);
        await http().patch(`/api${path}/${created.body.id}`).set(auth(tokens[role])).send({ notes: 'x' }).expect(403);
      }
    });

    it('CP-124 — un convenio de otra inmobiliaria no se ve ni se toca (404)', async () => {
      const a = await agency('agr-7a');
      const b = await agency('agr-7b');
      const contract = await createContract(a.tokens[UserRole.Admin]);
      const created = await post(a.tokens[UserRole.Admin], `/contracts/${contract.id}/agreements`, {
        kind: 'CambioReparto',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
      }).expect(201);
      const tokenB = b.tokens[UserRole.Admin];
      const path = `/contracts/${contract.id}/agreements`;

      await get(tokenB, path).expect(404);
      await get(tokenB, `/contracts/${contract.id}/terms`).expect(404);
      await get(tokenB, `/contracts/${contract.id}/periods`).expect(404);
      await post(tokenB, path, { kind: 'CambioReparto', effectiveFrom: '2026-06-01T00:00:00.000Z' }).expect(404);
      await http().delete(`/api${path}/${created.body.id}`).set(auth(tokenB)).expect(404);
      expect(await prisma.baseClient.contractAgreement.count()).toBe(1);
    });

    it('CP-125 — solo se borra el último convenio; las columnas vuelven a la versión anterior', async () => {
      const { tokens } = await agency('agr-8');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);
      const path = `/contracts/${contract.id}/agreements`;
      const first = await post(token, path, {
        kind: 'CambioRegla',
        effectiveFrom: '2026-03-01T00:00:00.000Z',
        termsPatch: { adjustmentType: 'ICL' },
      }).expect(201);
      const second = await post(token, path, {
        kind: 'CambioRegla',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        termsPatch: { adjustmentType: 'CCP' },
      }).expect(201);

      const blocked = await http().delete(`/api${path}/${first.body.id}`).set(auth(token)).expect(409);
      expect(blocked.body.error).toBe('AGREEMENT_HAS_LATER_VERSIONS');
      await http().patch(`/api${path}/${first.body.id}`).set(auth(token)).send({ notes: 'x' }).expect(409);

      await http().patch(`/api${path}/${second.body.id}`).set(auth(token)).send({ notes: 'corregida' }).expect(200);
      expect((await get(token, `/contracts/${contract.id}`).expect(200)).body.adjustmentType).toBe('CCP');

      await http().delete(`/api${path}/${second.body.id}`).set(auth(token)).expect(200);
      expect((await get(token, `/contracts/${contract.id}`).expect(200)).body.adjustmentType).toBe('ICL');

      await http().delete(`/api${path}/${first.body.id}`).set(auth(token)).expect(200);
      expect((await get(token, `/contracts/${contract.id}`).expect(200)).body.adjustmentType).toBe('IPC');
      await http().delete(`/api${path}/${MISSING_ID}`).set(auth(token)).expect(404);
    });

    it('CP-125 — con versiones, pisar la modalidad por PATCH se rechaza; sin ellas corrige la inicial', async () => {
      const { tokens } = await agency('agr-9');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);

      await http()
        .patch(`/api/contracts/${contract.id}`)
        .set(auth(token))
        .send({ adjustmentType: 'ICL' })
        .expect(200);
      expect((await get(token, `/contracts/${contract.id}/terms`)).body.current.adjustmentType).toBe('ICL');

      await post(token, `/contracts/${contract.id}/agreements`, {
        kind: 'Rebaja',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        termsPatch: { discountPct: '10' },
      }).expect(201);
      const res = await http()
        .patch(`/api/contracts/${contract.id}`)
        .set(auth(token))
        .send({ adjustmentType: 'IPC' })
        .expect(409);
      expect(res.body.error).toBe('RULES_CHANGE_REQUIRES_AGREEMENT');
    });

    it('CP-123 — cada convenio y cada cambio de reglas quedan en la auditoría', async () => {
      const { tokens, tenantId } = await agency('agr-10');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);
      await post(token, `/contracts/${contract.id}/agreements`, {
        kind: 'Rebaja',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        termsPatch: { discountPct: '10' },
      }).expect(201);
      // La auditoría se escribe sin esperar la respuesta.
      await new Promise((resolve) => setTimeout(resolve, 300));

      const entries = await prisma.baseClient.auditLog.findMany({
        where: { tenantId, entity: 'Contract', action: 'CREATE' },
      });
      expect(entries.some((e) => (e.changes as any)?.operation === 'contract-agreement')).toBe(true);
    });
  });

  // ─── Fin real y fin efectivo ────────────────────────

  describe('fin real', () => {
    it('CP-126 — PATCH actualEndDate guarda la prórroga de palabra y valida contra el inicio', async () => {
      const { tokens } = await agency('end-1');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token);

      const ok = await http()
        .patch(`/api/contracts/${contract.id}`)
        .set(auth(token))
        .send({ actualEndDate: '2028-04-01T00:00:00.000Z' })
        .expect(200);
      expect(ok.body.actualEndDate).toBe('2028-04-01T00:00:00.000Z');
      expect(ok.body.endDate).toBe(END);

      const bad = await http()
        .patch(`/api/contracts/${contract.id}`)
        .set(auth(token))
        .send({ actualEndDate: '2025-12-31T00:00:00.000Z' })
        .expect(400);
      expect(bad.body.error).toBe('VALIDATION_ERROR');

      const cleared = await http()
        .patch(`/api/contracts/${contract.id}`)
        .set(auth(token))
        .send({ actualEndDate: null })
        .expect(200);
      expect(cleared.body.actualEndDate).toBeNull();
    });

    it('CP-127 — un contrato pasado de su fin pactado sin fin real sigue Activo (D-3)', async () => {
      const { tokens } = await agency('end-2');
      const token = tokens[UserRole.Admin];
      const contract = await createContract(token, {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2025-01-01T00:00:00.000Z',
        status: 'Activo',
      });
      expect(contract.status).toBe('Activo');

      const detail = (await get(token, `/contracts/${contract.id}`).expect(200)).body;
      expect(detail.status).toBe('Activo');
      expect(detail.actualEndDate).toBeNull();
      expect(new Date(detail.endDate).getTime()).toBeLessThan(Date.now());
    });
  });

  // ─── Índices estimados ──────────────────────────────

  describe('índices estimados', () => {
    const period = '2026-09-01T00:00:00.000Z';

    it('CP-128 — el oficial reemplaza al estimado bajo la misma clave y queda el reemplazo', async () => {
      const { tokens } = await agency('idx-1');
      const admin = tokens[UserRole.Admin];

      const estimate = await post(admin, '/index-data', {
        indexType: 'IPC',
        period,
        value: '2.100000',
        isEstimate: true,
        estimateSource: 'REM',
      }).expect(201);
      expect(estimate.body).toMatchObject({ isEstimate: true, estimateSource: 'REM' });

      const official = await post(admin, '/index-data', {
        indexType: 'IPC',
        period,
        value: '2.400000',
        source: 'INDEC',
      }).expect(201);
      expect(official.body).toMatchObject({ id: estimate.body.id, isEstimate: false, estimateSource: null });
      expect(await prisma.baseClient.indexData.count()).toBe(1);

      const replaced = (await get(tokens[UserRole.Gerente], '/index-data/estimates-replaced?since=2000-01-01')).body;
      expect(replaced.items).toHaveLength(1);
      expect(replaced.items[0]).toMatchObject({
        indexType: 'IPC',
        estimateValue: '2.1',
        estimateSource: 'REM',
        officialValue: '2.4',
        via: 'manual',
        contractIds: [],
      });
      const none = (await get(tokens[UserRole.Gerente], '/index-data/estimates-replaced?since=2999-01-01')).body;
      expect(none.items).toEqual([]);
    });

    it('CP-128 — un estimado no pisa a un valor oficial (409) y el RBAC del informe es Admin/Gerente', async () => {
      const { tokens } = await agency('idx-2');
      const admin = tokens[UserRole.Admin];
      await post(admin, '/index-data', { indexType: 'IPC', period, value: '2.4' }).expect(201);

      const res = await post(admin, '/index-data', {
        indexType: 'IPC',
        period,
        value: '2.1',
        isEstimate: true,
      }).expect(409);
      expect(res.body.error).toBe('OFFICIAL_VALUE_EXISTS');
      await post(admin, '/index-data', { indexType: 'IPC', period, value: '2.1', estimateSource: 'REM' }).expect(400);

      for (const role of ALL_ROLES.filter((r) => r !== UserRole.Admin && r !== UserRole.Gerente)) {
        await get(tokens[role], '/index-data/estimates-replaced').expect(403);
      }
    });

    it('CP-129 — el estimado se lista con su marca y no cuenta como último valor', async () => {
      const { tokens } = await agency('idx-3');
      const admin = tokens[UserRole.Admin];
      await post(admin, '/index-data', { indexType: 'IPC', period, value: '2.4' }).expect(201);
      await post(admin, '/index-data', {
        indexType: 'IPC',
        period: '2026-10-01T00:00:00.000Z',
        value: '2.1',
        isEstimate: true,
        estimateSource: 'REM',
      }).expect(201);
      await post(admin, '/index-data', { indexType: 'TasaActivaBNA', period, value: '40.5' }).expect(201);

      const list = (await get(admin, '/index-data?indexType=IPC')).body;
      expect(list.items.map((i: any) => [i.period.slice(0, 7), i.isEstimate])).toEqual([
        ['2026-10', true],
        ['2026-09', false],
      ]);

      const latest = (await get(admin, '/index-data/latest')).body;
      const ipc = latest.find((l: any) => l.indexType === 'IPC');
      expect(ipc.latest.period.slice(0, 7)).toBe('2026-09');
      expect(latest.some((l: any) => l.indexType === 'TasaActivaBNA')).toBe(true);
    });
  });
});
