/**
 * CP-1237 a CP-1239 — Carga del histórico de ICL y UVA de la serie de sistema
 * por rango de fechas (DEF-121). El lector del BCRA es real y escribe en la
 * base bajo el identificador de sistema; solo se sustituye `fetch`.
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { cleanDatabase, registerUser, createUserDirect, loginUser } from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { UserRole } from '@realfy/shared';

const SYSTEM = '__system__';

/** Respuesta del BCRA con un valor por día corrido entre dos fechas. */
function bcraResponse(from: string, to: string, base: number) {
  const detalle: { fecha: string; valor: number }[] = [];
  const day = new Date(`${from}T00:00:00.000Z`);
  for (let i = 0; day <= new Date(`${to}T00:00:00.000Z`); i++) {
    detalle.push({ fecha: day.toISOString().slice(0, 10), valor: base + i });
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return { ok: true, status: 200, json: async () => ({ results: [{ detalle: detalle.reverse() }] }) } as Response;
}

describe('Índices de sistema — carga del histórico por rango (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fetchMock: jest.SpyInstance;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [(await import('../../src/app.module')).AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await prisma.baseClient.indexData.deleteMany({ where: { tenantId: SYSTEM } });
    if (app) await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    await prisma.baseClient.indexData.deleteMany({ where: { tenantId: SYSTEM } });
    jest.restoreAllMocks();
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const u = new URL(String(url));
      return bcraResponse(u.searchParams.get('desde')!, u.searchParams.get('hasta')!, u.pathname.endsWith('/40') ? 1000 : 2000);
    });
  });

  const http = () => request(app.getHttpServer());
  const backfill = (token: string, body: object) =>
    http().post('/api/index-data/backfill').set('Authorization', `Bearer ${token}`).send(body);

  async function admin(prefix: string) {
    return registerUser(app, {
      email: `${prefix}@backfill-e2e.test`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Historico',
    });
  }

  it('CP-1237: el Admin carga el rango en la serie de sistema, repetirlo no duplica y todas las inmobiliarias lo ven', async () => {
    const a = await admin('cp1237-a');
    const b = await admin('cp1237-b');
    const body = { indexType: 'ICL', from: '2025-01-01', to: '2025-01-31' };

    const first = await backfill(a.accessToken, body).expect(201);
    expect(first.body).toMatchObject({ indexType: 'ICL', fetched: 31, inserted: 31, existing: 0, differing: 0, missingCount: 0 });
    const again = await backfill(a.accessToken, body).expect(201);
    expect(again.body).toMatchObject({ inserted: 0, existing: 31, differing: 0 });

    expect(await prisma.baseClient.indexData.count({ where: { tenantId: SYSTEM, indexType: 'ICL' } })).toBe(31);
    expect(await prisma.baseClient.indexData.count({ where: { tenantId: { not: SYSTEM }, indexType: 'ICL' } })).toBe(0);
    const row = await prisma.baseClient.indexData.findFirstOrThrow({
      where: { tenantId: SYSTEM, indexType: 'ICL', period: new Date('2025-01-10T00:00:00.000Z') },
    });
    expect(Number(row.value)).toBe(1009);
    expect(row.source).toBe('bcra-v4-icl');

    const list = await http()
      .get('/api/index-data?indexType=ICL&periodFrom=2025-01-01&periodTo=2025-01-31&limit=100')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    expect(list.body.total).toBe(31);
  });

  it('CP-1237: un valor de sistema ya cargado no se pisa aunque el BCRA devuelva otro', async () => {
    const a = await admin('cp1237-c');
    await prisma.baseClient.indexData.create({
      data: { tenantId: SYSTEM, indexType: 'UVA', period: new Date('2025-01-02T00:00:00.000Z'), value: '1', source: 'bcra-v4-uva' },
    });

    const res = await backfill(a.accessToken, { indexType: 'UVA', from: '2025-01-01', to: '2025-01-03' }).expect(201);

    expect(res.body).toMatchObject({ inserted: 2, existing: 1, differing: 1 });
    const kept = await prisma.baseClient.indexData.findFirstOrThrow({
      where: { tenantId: SYSTEM, indexType: 'UVA', period: new Date('2025-01-02T00:00:00.000Z') },
    });
    expect(Number(kept.value)).toBe(1);
  });

  it('CP-1238: solo el Admin lo corre; el resto de los roles recibe 403 y sin sesión 401', async () => {
    const a = await admin('cp1238');
    const body = { indexType: 'ICL', from: '2025-01-01', to: '2025-01-05' };
    for (const role of Object.values(UserRole).filter((r) => r !== UserRole.Admin)) {
      const email = `${role.toLowerCase()}@cp1238.test`;
      await createUserDirect(prisma, a.user.tenantId, { email, password: 'Password123!', role });
      const token = (await loginUser(app, email, 'Password123!')).accessToken;
      await backfill(token, body).expect(403);
    }
    await http().post('/api/index-data/backfill').send(body).expect(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.baseClient.indexData.count({ where: { tenantId: SYSTEM } })).toBe(0);
  });

  it('CP-1239: un rango inválido responde 400 y un fallo del BCRA responde 502 sin dejar datos', async () => {
    const a = await admin('cp1239');
    await backfill(a.accessToken, { indexType: 'ICL', from: '2025-02-01', to: '2025-01-01' }).expect(400);
    await backfill(a.accessToken, { indexType: 'IPC', from: '2025-01-01', to: '2025-02-01' }).expect(400);

    fetchMock.mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response);
    const res = await backfill(a.accessToken, { indexType: 'ICL', from: '2025-01-01', to: '2025-01-05' }).expect(502);
    expect(res.body).toMatchObject({ error: 'INDEX_SOURCE_UNAVAILABLE' });
    expect(await prisma.baseClient.indexData.count({ where: { tenantId: SYSTEM } })).toBe(0);
  });
});
