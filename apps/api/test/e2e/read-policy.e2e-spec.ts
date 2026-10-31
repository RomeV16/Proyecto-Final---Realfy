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
import { DEFAULT_READ_POLICY, READ_RESOURCES, UserRole } from '@realfy/shared';

const CBU = '0000000000000000000001';
const PASSWORD = 'Password123!';
const ALL_ROLES = Object.values(UserRole);
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('Política de lectura por rol (e2e)', () => {
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

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) =>
    request(app.getHttpServer()).get(`/api${path}`).set(auth(token));
  const put = (token: string, body: unknown) =>
    request(app.getHttpServer()).put('/api/tenants/me/read-policy').set(auth(token)).send(body as object);

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
      await createUserDirect(prisma, admin.user.tenantId, {
        email,
        password: PASSWORD,
        role,
      });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    return { tenantId: admin.user.tenantId as string, tokens };
  }

  async function personWithData(token: string) {
    const person = await request(app.getHttpServer())
      .post('/api/persons')
      .set(auth(token))
      .send({
        firstName: 'Ana',
        lastName: 'Prueba',
        dni: '00000001',
        cuit: '20-12345678-6',
        bankName: 'Banco Ficticio',
        cbu: CBU,
      })
      .expect(201);
    return person.body.id as string;
  }

  const policy = (overrides: Record<string, UserRole[]>) => ({ ...DEFAULT_READ_POLICY, ...overrides });

  describe('política por defecto', () => {
    it('CP-258 — sin configurar, cada rol lee como antes y nada se enmascara', async () => {
      const { tokens } = await agency('default');
      const personId = await personWithData(tokens[UserRole.Admin]);

      for (const role of ALL_ROLES) {
        const person = await get(tokens[role], `/persons/${personId}`);
        expect(person.status).toBe(200);
        expect(person.body.dni).toBe('00000001');
        expect(person.body.cuit).toBe('20-12345678-6');

        const accounts = await get(tokens[role], `/persons/${personId}/bank-accounts`);
        expect(accounts.status).toBe(200);

        for (const path of [
          '/renditions',
          '/invoices',
          '/reports/cashFlow',
          '/audit-logs',
          `/contracts/${MISSING_ID}/commission`,
        ]) {
          const res = await get(tokens[role], path);
          expect(res.body.error).not.toBe('READ_FORBIDDEN');
        }

        const access = await get(tokens[role], '/tenants/me/read-access').expect(200);
        expect(access.body.role).toBe(role);
        expect(Object.values(access.body.resources).every(Boolean)).toBe(true);
        expect(Object.keys(access.body.resources)).toEqual([...READ_RESOURCES]);
      }

      const stored = await get(tokens[UserRole.Admin], '/tenants/me/read-policy').expect(200);
      expect(stored.body).toEqual(DEFAULT_READ_POLICY);
    });
  });

  describe('política personalizada', () => {
    it('CP-259 — sin acceso a cuentas bancarias, Ventas recibe 403 READ_FORBIDDEN', async () => {
      const { tokens } = await agency('cuentas');
      const personId = await personWithData(tokens[UserRole.Admin]);
      await put(tokens[UserRole.Admin], policy({
        'persons.bankAccounts': [UserRole.Admin, UserRole.Liquidaciones],
      })).expect(200);

      const denied = await get(tokens[UserRole.Ventas], `/persons/${personId}/bank-accounts`);
      expect(denied.status).toBe(403);
      expect(denied.body.error).toBe('READ_FORBIDDEN');
      expect(denied.body.resource).toBe('persons.bankAccounts');

      await get(tokens[UserRole.Liquidaciones], `/persons/${personId}/bank-accounts`).expect(200);
      await get(tokens[UserRole.Admin], `/persons/${personId}/bank-accounts`).expect(200);

      const access = await get(tokens[UserRole.Ventas], '/tenants/me/read-access').expect(200);
      expect(access.body.resources['persons.bankAccounts']).toBe(false);
      expect(access.body.resources['persons.document']).toBe(true);
    });

    it('CP-260 — documentos y datos bancarios se enmascaran sin rechazar la persona', async () => {
      const { tokens } = await agency('mascara');
      const personId = await personWithData(tokens[UserRole.Admin]);
      await put(tokens[UserRole.Admin], policy({
        'persons.document': [UserRole.Admin, UserRole.Gerente],
        'persons.bankAccounts': [UserRole.Admin],
      })).expect(200);

      const ventas = await get(tokens[UserRole.Ventas], `/persons/${personId}`);
      expect(ventas.status).toBe(200);
      expect(ventas.body).toMatchObject({
        firstName: 'Ana',
        lastName: 'Prueba',
        dni: null,
        cuit: null,
        bankAccounts: null,
      });

      const list = await get(tokens[UserRole.Ventas], '/persons').expect(200);
      const row = list.body.items.find((p: { id: string }) => p.id === personId);
      expect(row.dni).toBeNull();
      expect(row.firstName).toBe('Ana');

      const gerente = await get(tokens[UserRole.Gerente], `/persons/${personId}`).expect(200);
      expect(gerente.body.dni).toBe('00000001');
      expect(gerente.body.bankAccounts).toBeNull();

      const admin = await get(tokens[UserRole.Admin], `/persons/${personId}`).expect(200);
      expect(admin.body).toMatchObject({ dni: '00000001', cuit: '20-12345678-6' });
      expect(admin.body.bankAccounts[0].cbu).toBe(CBU);

      // la base no se modifica: solo la respuesta
      const stored = await prisma.baseClient.person.findUnique({ where: { id: personId } });
      expect(stored?.dni).toBe('00000001');
    });

    it('CP-261 — facturas, rendiciones, reportes, auditoría y comisión respetan la política', async () => {
      const { tokens } = await agency('recursos');
      await put(tokens[UserRole.Admin], policy({
        renditions: [UserRole.Admin],
        invoices: [UserRole.Admin],
        'reports.financial': [UserRole.Admin],
        audit: [UserRole.Admin],
        'contracts.commission': [UserRole.Admin],
      })).expect(200);

      for (const path of [
        '/renditions',
        '/invoices',
        '/reports/cashFlow',
        '/audit-logs',
        `/contracts/${MISSING_ID}/commission`,
      ]) {
        const denied = await get(tokens[UserRole.Gerente], path);
        expect([path, denied.status, denied.body.error]).toEqual([path, 403, 'READ_FORBIDDEN']);
        const allowed = await get(tokens[UserRole.Admin], path);
        expect([path, allowed.body.error === 'READ_FORBIDDEN']).toEqual([path, false]);
      }
    });
  });

  describe('aislamiento y permisos', () => {
    it('CP-262 — la política de una inmobiliaria no afecta a otra', async () => {
      const a = await agency('aislada-a');
      const b = await agency('aislada-b');
      const personA = await personWithData(a.tokens[UserRole.Admin]);
      const personB = await personWithData(b.tokens[UserRole.Admin]);

      await put(a.tokens[UserRole.Admin], policy({
        'persons.bankAccounts': [UserRole.Admin],
        'persons.document': [UserRole.Admin],
      })).expect(200);

      await get(a.tokens[UserRole.Ventas], `/persons/${personA}/bank-accounts`).expect(403);
      await get(b.tokens[UserRole.Ventas], `/persons/${personB}/bank-accounts`).expect(200);
      const b2 = await get(b.tokens[UserRole.Ventas], `/persons/${personB}`).expect(200);
      expect(b2.body.dni).toBe('00000001');

      const bPolicy = await get(b.tokens[UserRole.Admin], '/tenants/me/read-policy').expect(200);
      expect(bPolicy.body).toEqual(DEFAULT_READ_POLICY);
      const bRow = await prisma.baseClient.tenant.findUnique({
        where: { id: b.tenantId },
        select: { readPolicy: true },
      });
      expect(bRow?.readPolicy).toBeNull();
    });

    it('CP-263 — solo el Admin lee y cambia la política; se valida lo que se guarda', async () => {
      const { tokens } = await agency('permisos');

      for (const role of ALL_ROLES.filter((r) => r !== UserRole.Admin)) {
        const g = await get(tokens[role], '/tenants/me/read-policy');
        expect([role, g.status, g.body.error]).toEqual([role, 403, 'FORBIDDEN']);
        const p = await put(tokens[role], DEFAULT_READ_POLICY);
        expect([role, p.status, p.body.error]).toEqual([role, 403, 'FORBIDDEN']);
      }

      const noAdmin = await put(tokens[UserRole.Admin], policy({ audit: [UserRole.Gerente] }));
      expect(noAdmin.status).toBe(400);
      expect(noAdmin.body.error).toBe('VALIDATION_ERROR');

      expect((await put(tokens[UserRole.Admin], { ...DEFAULT_READ_POLICY, secretos: ['Admin'] })).status).toBe(400);
      expect((await put(tokens[UserRole.Admin], policy({ audit: ['Admin', 'Dios'] as UserRole[] }))).status).toBe(400);
      expect((await put(tokens[UserRole.Admin], { audit: ['Admin'] })).status).toBe(400);

      const saved = policy({ audit: [UserRole.Admin, UserRole.Gerente] });
      await put(tokens[UserRole.Admin], saved).expect(200);
      const read = await get(tokens[UserRole.Admin], '/tenants/me/read-policy').expect(200);
      expect(read.body).toEqual(saved);

      // volver a abrir todo se aplica de inmediato
      await put(tokens[UserRole.Admin], DEFAULT_READ_POLICY).expect(200);
      expect((await get(tokens[UserRole.Soporte], '/audit-logs')).body.error).not.toBe('READ_FORBIDDEN');
    });

    it('CP-264 — con una política guardada inválida, la lectura sensible se deniega', async () => {
      const { tokens, tenantId } = await agency('cerrado');
      const personId = await personWithData(tokens[UserRole.Admin]);
      await prisma.baseClient.tenant.update({
        where: { id: tenantId },
        data: { readPolicy: { audit: 'todos' } },
      });

      const gated = await get(tokens[UserRole.Admin], `/persons/${personId}/bank-accounts`);
      expect([gated.status, gated.body.error]).toEqual([403, 'READ_FORBIDDEN']);
      const masked = await get(tokens[UserRole.Admin], `/persons/${personId}`);
      expect([masked.status, masked.body.error]).toEqual([403, 'READ_FORBIDDEN']);
      // las rutas sin política siguen funcionando
      await get(tokens[UserRole.Admin], '/tenants/me').expect(200);
    });
  });
});
