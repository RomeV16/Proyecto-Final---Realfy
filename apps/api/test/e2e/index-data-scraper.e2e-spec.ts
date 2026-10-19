/**
 * CP-53 / CP-54 — Flujo completo de RF-14: los índices obtenidos
 * automáticamente deben ser visibles para la inmobiliaria y alimentar el
 * cálculo de ajustes sin carga manual (regresión de DEF-01 y DEF-06).
 *
 * El scraper se mantiene real (escribe en la base bajo el identificador de
 * sistema); solo se sustituyen las llamadas HTTP a BCRA e INDEC.
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { cleanDatabase, registerUser } from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { IndexScraperService } from '../../src/modules/index-data/index-scraper.service';
import {
  IndexType,
  PersonRole,
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
  PropertyType,
} from '@realfy/shared';

describe('IndexData — obtención automática de punta a punta (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let scraper: IndexScraperService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [(await import('../../src/app.module')).AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    scraper = moduleFixture.get(IndexScraperService);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await prisma.baseClient.indexData.deleteMany({ where: { tenantId: '__system__' } });
    if (app) await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    await prisma.baseClient.indexData.deleteMany({ where: { tenantId: '__system__' } });
    jest.restoreAllMocks();
    // Dobles solo para la red: lo que el BCRA y el INDEC devolverían ya parseado.
    jest.spyOn(scraper, 'fetchICL').mockResolvedValue([
      { period: '2025-01-02', value: 31.47, source: 'bcra-v4-icl' },
      { period: '2025-04-01', value: 34.62, source: 'bcra-v4-icl' },
    ]);
    jest.spyOn(scraper, 'fetchUVA').mockResolvedValue([
      { period: '2025-04-01', value: 1881.02, source: 'bcra-v4-uva' },
    ]);
    jest.spyOn(scraper, 'fetchIPC').mockResolvedValue([
      { period: '2025-01', value: 2.0, source: 'indec-datos-gob-ar' },
      { period: '2025-02', value: 3.0, source: 'indec-datos-gob-ar' },
    ]);
  });

  async function admin(prefix: string) {
    return registerUser(app, {
      email: `${prefix}@scraper-e2e.test`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Scraper',
    });
  }

  async function refresh(token: string) {
    const res = await request(app.getHttpServer())
      .post('/api/index-data/refresh')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(res.body.counts).toEqual({ icl: 2, uva: 1, ipc: 2 });
  }

  it('CP-53: tras el refresco, el listado y el último valor muestran los índices obtenidos', async () => {
    const user = await admin('cp53');
    await refresh(user.accessToken);

    const list = await request(app.getHttpServer())
      .get('/api/index-data?indexType=IPC')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(list.body.total).toBe(2);
    expect(list.body.items.map((r: any) => Number(r.value)).sort()).toEqual([2, 3]);

    const latest = await request(app.getHttpServer())
      .get('/api/index-data/latest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    const icl = latest.body.find((r: any) => r.indexType === IndexType.ICL);
    expect(icl).toBeDefined();
    expect(Number(icl.latest.value)).toBe(34.62);
  });

  it('CP-53: la carga manual de la inmobiliaria tiene prioridad sobre el valor obtenido para el mismo período', async () => {
    const user = await admin('cp53b');
    await refresh(user.accessToken);

    await request(app.getHttpServer())
      .post('/api/index-data')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ indexType: IndexType.IPC, period: '2025-02-01T00:00:00.000Z', value: '2.50', source: 'manual' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/api/index-data?indexType=IPC')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(list.body.total).toBe(2);
    const feb = list.body.items.find((r: any) => r.period.startsWith('2025-02'));
    expect(Number(feb.value)).toBe(2.5);
    expect(feb.source).toBe('manual');
  });

  it('CP-53: los índices de sistema no rompen el aislamiento: otra inmobiliaria sigue sin ver cargas manuales ajenas', async () => {
    const a = await admin('cp53-a');
    const b = await admin('cp53-b');
    await refresh(a.accessToken);
    await request(app.getHttpServer())
      .post('/api/index-data')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ indexType: IndexType.ICL, period: '2025-03-01T00:00:00.000Z', value: '33.00' })
      .expect(201);

    const listB = await request(app.getHttpServer())
      .get('/api/index-data?indexType=ICL')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    const values = listB.body.items.map((r: any) => Number(r.value)).sort();
    expect(values).toEqual([31.47, 34.62]); // solo lo obtenido automáticamente, no la carga de A
  });

  it('CP-54: un contrato IPC sin carga manual se previsualiza con los índices obtenidos (factor 1,0506)', async () => {
    const user = await admin('cp54');
    const token = user.accessToken;
    await refresh(token);

    const property = await request(app.getHttpServer())
      .post('/api/properties')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Depto scraper',
        type: PropertyType.Departamento,
        street: 'Av. Corrientes',
        number: '1000',
        city: 'Buenos Aires',
        province: 'CABA',
        area: 60,
        rooms: 2,
        bedrooms: 1,
        bathrooms: 1,
        price: 100000,
        currency: 'USD',
      })
      .expect(201);

    const person = async (role: PersonRole) => {
      const res = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Test', lastName: role, email: `${role}-cp54@scraper-e2e.test` })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/persons/${res.body.id}/roles`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role })
        .expect(201);
      return res.body;
    };
    const propietario = await person(PersonRole.Propietario);
    const inquilino = await person(PersonRole.Inquilino);

    const contract = await request(app.getHttpServer())
      .post('/api/contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        propertyId: property.body.id,
        contractType: ContractType.Alquiler,
        status: ContractStatus.Activo,
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
        rentAmount: '100000.00',
        rentCurrency: 'ARS',
        depositAmount: '200000.00',
        depositCurrency: 'ARS',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        persons: [
          { personId: propietario.id, role: PersonRole.Propietario },
          { personId: inquilino.id, role: PersonRole.Inquilino },
        ],
        guarantees: [],
      })
      .expect(201);

    const preview = await request(app.getHttpServer())
      .post(`/api/contracts/${contract.body.id}/preview-adjustment`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(preview.body.indexType).toBe(IndexType.IPC);
    expect(preview.body.factor).toBe('1.050600');
    expect(preview.body.projectedRent).toBe('105060.00');
    expect(preview.body.projectedDelta).toBe('5060.00');
  });
});
