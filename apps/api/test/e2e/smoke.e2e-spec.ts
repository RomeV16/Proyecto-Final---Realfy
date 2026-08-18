import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  PersonRole,
  ContractType,
  ContractStatus,
  PropertyType,
  AdjustmentType,
  AdjustmentPeriod,
  LiquidacionStatus,
  PaymentMethod,
  ServiceType,
  Currency,
} from '@realfy/shared';

/**
 * Full System Smoke Test
 *
 * Exercises the complete user journey through real HTTP endpoints:
 *   register → onboard → property → persons → contract → liquidación
 *   → payment → dashboard → services
 *
 * This is the single most important test in the codebase — it proves
 * that the assembled system works end-to-end.
 */
describe('Full System Smoke Test (e2e)', () => {
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

  it('complete user journey: register → property → persons → contract → liquidación → payment → dashboard → services', async () => {
    // ─── (a) Register ──────────────────────────────────
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'smoke-admin@inmobiliaria.com',
        password: 'SmokeTest123!',
        firstName: 'Smoke',
        lastName: 'Admin',
      })
      .expect(201);

    const accessToken = registerRes.body.tokens.accessToken;
    const tenantId = registerRes.body.user.tenantId;

    expect(accessToken).toBeDefined();
    expect(tenantId).toBeDefined();

    // ─── (b) Update Tenant ─────────────────────────────
    await request(app.getHttpServer())
      .patch(`/api/tenants/${tenantId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Inmobiliaria Smoke Test',
        cuit: '30-71234567-1',
        province: 'CABA',
      })
      .expect(200);

    // ─── (c) Create Property ───────────────────────────
    const propertyRes = await request(app.getHttpServer())
      .post('/api/properties')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Departamento 2B - Av. Corrientes',
        type: PropertyType.Departamento,
        street: 'Av. Corrientes',
        number: '4567',
        city: 'Buenos Aires',
        province: 'CABA',
        area: 85,
        rooms: 3,
        bedrooms: 2,
        bathrooms: 1,
        price: 200000,
        currency: 'ARS',
      })
      .expect(201);

    const propertyId = propertyRes.body.id;
    expect(propertyId).toBeDefined();

    // ─── (d) Create Persons ────────────────────────────
    // Propietario
    const propietarioRes = await request(app.getHttpServer())
      .post('/api/persons')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Roberto',
        lastName: 'Fernández',
        email: 'roberto@smoke.com',
        cuit: '20-11111111-2',
      })
      .expect(201);

    const propietarioId = propietarioRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/persons/${propietarioId}/roles`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: PersonRole.Propietario })
      .expect(201);

    // Inquilino
    const inquilinoRes = await request(app.getHttpServer())
      .post('/api/persons')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Lucía',
        lastName: 'Gómez',
        email: 'lucia@smoke.com',
        cuit: '27-22222222-8',
      })
      .expect(201);

    const inquilinoId = inquilinoRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/persons/${inquilinoId}/roles`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: PersonRole.Inquilino })
      .expect(201);

    // ─── (e) Create Contract ───────────────────────────
    const contractRes = await request(app.getHttpServer())
      .post('/api/contracts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        propertyId,
        contractType: ContractType.Alquiler,
        status: ContractStatus.Activo,
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
        rentAmount: '200000.00',
        rentCurrency: 'ARS',
        depositAmount: '400000.00',
        depositCurrency: 'ARS',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        notes: 'Smoke test contract',
        persons: [
          { personId: propietarioId, role: PersonRole.Propietario },
          { personId: inquilinoId, role: PersonRole.Inquilino },
        ],
        guarantees: [],
      })
      .expect(201);

    const contractId = contractRes.body.id;
    expect(contractId).toBeDefined();

    // ─── (f) Generate Liquidación ──────────────────────
    const genRes = await request(app.getHttpServer())
      .post('/api/liquidaciones/generate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ month: 3, year: 2026 })
      .expect(201);

    expect(genRes.body.created).toBe(1);

    // Fetch the liquidación
    const liqListRes = await request(app.getHttpServer())
      .get('/api/liquidaciones')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const liquidacionId = liqListRes.body.items[0].id;
    expect(liquidacionId).toBeDefined();

    // ─── (g) Transition: Borrador → Revision → Aprobada → Enviada
    await request(app.getHttpServer())
      .post(`/api/liquidaciones/${liquidacionId}/transition`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: LiquidacionStatus.Revision })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/liquidaciones/${liquidacionId}/transition`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: LiquidacionStatus.Aprobada })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/liquidaciones/${liquidacionId}/transition`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: LiquidacionStatus.Enviada })
      .expect(200);

    // ─── (h) Register Payment ──────────────────────────
    const payRes = await request(app.getHttpServer())
      .post(`/api/liquidaciones/${liquidacionId}/payments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        amount: '200000.00',
        method: PaymentMethod.Transferencia,
        paidAt: new Date().toISOString(),
      })
      .expect(200);

    expect(payRes.body.status).toBe(LiquidacionStatus.Pagada);
    expect(payRes.body.paidAt).toBeDefined();

    // ─── (i) Dashboard Stats ───────────────────────────
    const dashRes = await request(app.getHttpServer())
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(dashRes.body.totalProperties).toBeGreaterThanOrEqual(1);
    expect(dashRes.body.activeContracts).toBeGreaterThanOrEqual(1);

    // ─── (j) Create Service ────────────────────────────
    const serviceRes = await request(app.getHttpServer())
      .post('/api/services')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        propertyId,
        serviceType: ServiceType.Electricidad,
        providerName: 'EPEC',
        accountNumber: 'SMOKE-12345',
        amount: 12500,
        currency: Currency.ARS,
        dueDay: 15,
      })
      .expect(201);

    expect(serviceRes.body.id).toBeDefined();
    expect(serviceRes.body.serviceType).toBe(ServiceType.Electricidad);

    // ─── (k) Verify Service Appears in List ────────────
    const svcListRes = await request(app.getHttpServer())
      .get('/api/services')
      .query({ propertyId })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(svcListRes.body.items).toHaveLength(1);
    expect(svcListRes.body.items[0].providerName).toBe('EPEC');

    // ─── Final Dashboard check with services ────────────
    const finalDashRes = await request(app.getHttpServer())
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(finalDashRes.body.totalServices).toBeGreaterThanOrEqual(1);
  });
});
