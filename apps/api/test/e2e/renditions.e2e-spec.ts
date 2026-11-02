import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import {
  cleanDatabase,
  createTestUser,
  createUserDirect,
  loginUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { RenditionPdfService } from '../../src/modules/renditions/rendition-pdf.service';
import {
  UserRole,
  PersonRole,
  FiscalCondition,
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
  PropertyType,
  LiquidacionStatus,
  PaymentMethod,
  LineItemType,
  CommissionType,
  RendicionStatus,
} from '@realfy/shared';

/**
 * Rendiciones: histórico de solo lectura (ADR-0009). Las que existen se listan,
 * se ven y se imprimen; ya no se generan, no cambian de estado, no se editan ni
 * se envían (la cuenta corriente del locador las reemplaza). La comisión del
 * contrato sigue configurándose acá.
 */
describe('Renditions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Mock PDF service to avoid pdfmake dependency in e2e tests
  const mockPdfService = {
    generateRenditionPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [(await import('../../src/app.module')).AppModule],
    })
      .overrideProvider(RenditionPdfService)
      .useValue(mockPdfService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    if (app) await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    jest.clearAllMocks();
    mockPdfService.generateRenditionPdf.mockResolvedValue(
      Buffer.from('%PDF-1.4 mock rendition'),
    );
  });

  // ─── Helpers ──────────────────────────────────────────

  /**
   * Creates full chain: tenant + user + property + propietario + inquilino +
   * contract + liquidación (Pagada) + payment + commission config.
   * Returns everything needed for rendition testing.
   */
  async function setupFullChain(role: UserRole = UserRole.Admin) {
    // Register user (creates tenant automatically)
    const { accessToken, user } = await createTestUser(app, {
      email: `rendition-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
      password: 'Test1234!',
      firstName: 'Admin',
      lastName: 'User',
    });

    const tenantId = user.tenantId;

    // Create property
    const property = await prisma.baseClient.property.create({
      data: {
        tenantId,
        title: 'Test Depto',
        type: PropertyType.Departamento,
        street: 'Av. Corrientes',
        number: '1234',
        city: 'Buenos Aires',
        province: 'CABA',
        area: 50,
        rooms: 2,
        bedrooms: 1,
        bathrooms: 1,
        price: 100000,
        currency: 'ARS',
      },
    });

    // Create owner (Propietario) person
    const owner = await prisma.baseClient.person.create({
      data: {
        tenantId,
        firstName: 'Carlos',
        lastName: 'Propietario',
        email: 'carlos@test.com',
        cuit: '20-33456789-0',
        fiscalCondition: FiscalCondition.ConsumidorFinal,
      },
    });

    // Create inquilino person
    const inquilino = await prisma.baseClient.person.create({
      data: {
        tenantId,
        firstName: 'Juan',
        lastName: 'Inquilino',
        email: 'juan@test.com',
        cuit: '20-12345678-0',
        fiscalCondition: FiscalCondition.ConsumidorFinal,
      },
    });

    // Create contract
    const contract = await prisma.baseClient.contract.create({
      data: {
        tenantId,
        propertyId: property.id,
        contractType: ContractType.Alquiler,
        status: ContractStatus.Activo,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2028-01-01'),
        rentAmount: '150000.00',
        rentCurrency: 'ARS',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        isActive: true,
        persons: {
          createMany: {
            data: [{ tenantId, personId: inquilino.id, role: PersonRole.Inquilino }],
          },
        },
        lessors: {
          create: {
            tenantId,
            personId: owner.id,
            payoutPct: '100.0000',
            validFrom: new Date('2026-01-01'),
          },
        },
      },
    });

    // Create liquidación with status Pagada (required for rendition generation)
    const liquidacion = await prisma.baseClient.liquidacion.create({
      data: {
        tenantId,
        contractId: contract.id,
        period: new Date('2026-03-01'),
        dueDate: new Date('2026-03-10'),
        status: LiquidacionStatus.Pagada,
        subtotal: '150000.00',
        total: '150000.00',
        currency: 'ARS',
        lineItems: {
          create: {
            tenantId,
            type: LineItemType.Alquiler,
            description: 'Alquiler 03/2026',
            amount: '150000.00',
            currency: 'ARS',
            commissionable: true,
            beneficiary: 'Locador',
          },
        },
      },
    });

    // Create payment
    const payment = await prisma.baseClient.payment.create({
      data: {
        tenantId,
        liquidacionId: liquidacion.id,
        amount: '150000.00',
        currency: 'ARS',
        method: PaymentMethod.Transferencia,
        paidAt: new Date('2026-03-05'),
      },
    });

    // Create commission config (5% FixedPercent + $5000 admin fee)
    const commission = await prisma.baseClient.contractCommission.create({
      data: {
        tenantId,
        contractId: contract.id,
        type: CommissionType.FixedPercent,
        percentage: 5,
        fixedAmount: null,
        adminFee: 5000,
        currency: 'ARS',
      },
    });

    return {
      accessToken,
      user,
      tenantId,
      property,
      owner,
      inquilino,
      contract,
      liquidacion,
      payment,
      commission,
    };
  }

  /** Una rendición vieja, como las que quedaron de antes de la cuenta corriente. */
  async function seedHistoricalRendicion(chain: Awaited<ReturnType<typeof setupFullChain>>) {
    return prisma.baseClient.ownerRendicion.create({
      data: {
        tenantId: chain.tenantId,
        contractId: chain.contract.id,
        ownerId: chain.owner.id,
        period: new Date('2026-03-01'),
        status: RendicionStatus.Depositada,
        rentCollected: '150000.00',
        commissionAmount: '7500.00',
        adminFeeAmount: '5000.00',
        deductionTotal: '0.00',
        netDeposit: '137500.00',
        depositedAt: new Date('2026-03-15'),
        lineItems: {
          create: [
            { tenantId: chain.tenantId, type: 'Alquiler', description: 'Alquiler cobrado 03/2026', amount: '150000.00', isDebit: false, sortOrder: 1 },
            { tenantId: chain.tenantId, type: 'Comision', description: 'Comisión 5%', amount: '7500.00', isDebit: true, sortOrder: 2 },
            { tenantId: chain.tenantId, type: 'AdminFee', description: 'Honorarios de administración', amount: '5000.00', isDebit: true, sortOrder: 3 },
          ],
        },
      },
    });
  }

  // ─── 1. Commission CRUD ───────────────────────────────

  describe('Commission CRUD', () => {
    it('POST /contracts/:id/commission — creates commission config', async () => {
      const chain = await setupFullChain();

      // Delete existing commission so we can test creation via API
      await prisma.baseClient.contractCommission.deleteMany({
        where: { contractId: chain.contract.id },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/contracts/${chain.contract.id}/commission`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({
          type: CommissionType.FixedPercent,
          percentage: '5.00',
          adminFee: '5000.00',
        })
        .expect(201);

      expect(res.body.contractId).toBe(chain.contract.id);
      expect(res.body.type).toBe(CommissionType.FixedPercent);
      expect(Number(res.body.percentage)).toBe(5);
      expect(Number(res.body.adminFee)).toBe(5000);
      expect(res.body.repairMgmtFeePct).toBeNull();
    });

    it('POST /contracts/:id/commission — guarda el honorario por gestión de reparaciones', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .post(`/api/contracts/${chain.contract.id}/commission`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ type: CommissionType.FixedPercent, percentage: '5.00', repairMgmtFeePct: '10' })
        .expect(201);
      expect(Number(res.body.repairMgmtFeePct)).toBe(10);

      const read = await request(app.getHttpServer())
        .get(`/api/contracts/${chain.contract.id}/commission`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);
      expect(Number(read.body.repairMgmtFeePct)).toBe(10);

      await request(app.getHttpServer())
        .post(`/api/contracts/${chain.contract.id}/commission`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ type: CommissionType.FixedPercent, percentage: '5.00', repairMgmtFeePct: '120' })
        .expect(400);
    });

    it('POST /contracts/:id/commission — rejects a percentage above 100 (CP-134)', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .post(`/api/contracts/${chain.contract.id}/commission`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ type: CommissionType.FixedPercent, percentage: '150.00' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
      const stored = await prisma.baseClient.contractCommission.findFirst({
        where: { contractId: chain.contract.id },
      });
      expect(Number(stored?.percentage)).toBe(5);
    });

    it('GET /contracts/:id/commission — returns the config', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .get(`/api/contracts/${chain.contract.id}/commission`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.contractId).toBe(chain.contract.id);
      expect(res.body.type).toBe(CommissionType.FixedPercent);
    });

    it('POST /contracts/:id/commission — upserts existing', async () => {
      const chain = await setupFullChain();

      // Update from FixedPercent to Mixed
      const res = await request(app.getHttpServer())
        .post(`/api/contracts/${chain.contract.id}/commission`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({
          type: CommissionType.Mixed,
          percentage: '3.00',
          fixedAmount: '2000.00',
          adminFee: '1000.00',
        })
        .expect(201);

      expect(res.body.type).toBe(CommissionType.Mixed);
      expect(Number(res.body.percentage)).toBe(3);
      expect(Number(res.body.fixedAmount)).toBe(2000);

      // Verify only one commission exists (upsert, not duplicate)
      const count = await prisma.baseClient.contractCommission.count({
        where: { contractId: chain.contract.id },
      });
      expect(count).toBe(1);
    });

    it('DELETE /contracts/:id/commission — removes config', async () => {
      const chain = await setupFullChain();

      await request(app.getHttpServer())
        .delete(`/api/contracts/${chain.contract.id}/commission`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/contracts/${chain.contract.id}/commission`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body === null || (typeof res.body === 'object' && Object.keys(res.body).length === 0)).toBe(true);
    });
  });

  // ─── 2. Histórico de solo lectura ─────────────────────

  describe('Rendiciones históricas', () => {
    it('GET /renditions — lista las rendiciones viejas con contrato y locador', async () => {
      const chain = await setupFullChain();
      await seedHistoricalRendicion(chain);

      const res = await request(app.getHttpServer())
        .get('/api/renditions')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
      expect(res.body.items[0].contract).toBeDefined();
      expect(res.body.items[0].owner.id).toBe(chain.owner.id);
    });

    it('GET /renditions/:id — detalle con sus renglones', async () => {
      const chain = await setupFullChain();
      const rendicion = await seedHistoricalRendicion(chain);

      const res = await request(app.getHttpServer())
        .get(`/api/renditions/${rendicion.id}`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(rendicion.id);
      expect(res.body.status).toBe(RendicionStatus.Depositada);
      expect(res.body.lineItems).toHaveLength(3);
      expect(Number(res.body.netDeposit)).toBe(137500);
    });

    it('GET /renditions/:id/pdf — se sigue imprimiendo', async () => {
      const chain = await setupFullChain();
      const rendicion = await seedHistoricalRendicion(chain);

      const res = await request(app.getHttpServer())
        .get(`/api/renditions/${rendicion.id}/pdf`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('rendicion-');
      expect(mockPdfService.generateRenditionPdf).toHaveBeenCalledTimes(1);
    });

    it('GET /renditions/:id — 404 si no existe', async () => {
      const chain = await setupFullChain();

      await request(app.getHttpServer())
        .get('/api/renditions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(404);
    });

    it('ya no se generan, no cambian de estado, no se editan ni se envían: las rutas no existen', async () => {
      const chain = await setupFullChain();
      const rendicion = await seedHistoricalRendicion(chain);
      const server = app.getHttpServer();
      const auth = `Bearer ${chain.accessToken}`;

      await request(server).post('/api/renditions/generate').set('Authorization', auth)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 }).expect(404);
      await request(server).patch(`/api/renditions/${rendicion.id}/transition`).set('Authorization', auth)
        .send({ status: RendicionStatus.Borrador }).expect(404);
      await request(server).patch(`/api/renditions/${rendicion.id}/notes`).set('Authorization', auth)
        .send({ notes: 'x' }).expect(404);
      await request(server).post(`/api/renditions/${rendicion.id}/line-items`).set('Authorization', auth)
        .send({ type: 'Deduccion', description: 'x', amount: '1.00' }).expect(404);
      const item = await prisma.baseClient.rendicionLineItem.findFirst({ where: { rendicionId: rendicion.id } });
      await request(server).delete(`/api/renditions/${rendicion.id}/line-items/${item!.id}`).set('Authorization', auth).expect(404);
      await request(server).post(`/api/renditions/${rendicion.id}/send`).set('Authorization', auth).expect(404);

      const after = await prisma.baseClient.ownerRendicion.findUnique({ where: { id: rendicion.id }, include: { lineItems: true } });
      expect(after!.status).toBe(RendicionStatus.Depositada);
      expect(after!.lineItems).toHaveLength(3);
      expect(after!.sentAt).toBeNull();
    });
  });

  // ─── 3. Permisos ──────────────────────────────────────

  describe('RBAC', () => {
    it('Lectura no configura comisiones — 403', async () => {
      const chain = await setupFullChain();

      const lecturaUser = await createUserDirect(prisma, chain.tenantId, {
        email: `lectura-rend-${Date.now()}@test.com`,
        role: UserRole.Lectura,
        password: 'Test1234!',
      });
      const { accessToken: lecturaToken } = await loginUser(app, lecturaUser.email, 'Test1234!');

      await request(app.getHttpServer())
        .post(`/api/contracts/${chain.contract.id}/commission`)
        .set('Authorization', `Bearer ${lecturaToken}`)
        .send({ type: CommissionType.FixedPercent, percentage: '10.00' })
        .expect(403);
    });
  });

  // ─── 4. Aislamiento entre inmobiliarias ───────────────

  describe('Tenant Isolation', () => {
    it('Tenant B cannot see Tenant A renditions — 404', async () => {
      const chainA = await setupFullChain();
      const rendicionA = await seedHistoricalRendicion(chainA);

      const { accessToken: tokenB } = await createTestUser(app, {
        email: `tenant-b-${Date.now()}@test.com`,
        password: 'Test1234!',
        firstName: 'TenantB',
        lastName: 'Admin',
      });

      await request(app.getHttpServer())
        .get(`/api/renditions/${rendicionA.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      const listRes = await request(app.getHttpServer())
        .get('/api/renditions')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(listRes.body.items).toHaveLength(0);
      expect(listRes.body.total).toBe(0);
    });
  });
});
