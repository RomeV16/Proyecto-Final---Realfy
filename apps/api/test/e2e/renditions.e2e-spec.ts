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
import { RenditionEmailService } from '../../src/modules/renditions/rendition-email.service';
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
  RendicionLineItemType,
} from '@realfy/shared';

describe('Renditions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Mock PDF service to avoid pdfmake dependency in e2e tests
  const mockPdfService = {
    generateRenditionPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
  };

  // Mock email service to avoid Resend calls
  const mockEmailService = {
    sendRendicionEmail: jest.fn().mockResolvedValue({ id: 'resend-mock-id' }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [(await import('../../src/app.module')).AppModule],
    })
      .overrideProvider(RenditionPdfService)
      .useValue(mockPdfService)
      .overrideProvider(RenditionEmailService)
      .useValue(mockEmailService)
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
    mockEmailService.sendRendicionEmail.mockResolvedValue({
      id: 'resend-mock-id',
    });
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
            data: [
              { tenantId, personId: owner.id, role: PersonRole.Propietario },
              { tenantId, personId: inquilino.id, role: PersonRole.Inquilino },
            ],
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

  // ─── 2. Rendition Generation ──────────────────────────

  describe('Rendition Generation', () => {
    it('POST /renditions/generate — happy path with correct amounts', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({
          contractId: chain.contract.id,
          month: 3,
          year: 2026,
        })
        .expect(201);

      expect(res.body.contractId).toBe(chain.contract.id);
      expect(res.body.ownerId).toBe(chain.owner.id);
      expect(res.body.status).toBe(RendicionStatus.Borrador);
      // 150000 rent, 5% commission = 7500, admin fee = 5000, net = 137500
      expect(Number(res.body.rentCollected)).toBe(150000);
      expect(Number(res.body.commissionAmount)).toBe(7500);
      expect(Number(res.body.adminFeeAmount)).toBe(5000);
      expect(Number(res.body.netDeposit)).toBe(137500);
      expect(res.body.lineItems).toBeDefined();
      expect(res.body.lineItems.length).toBeGreaterThanOrEqual(2); // Rent + Commission (+ AdminFee)
    });

    it('POST /renditions/generate — duplicate returns existing (idempotent)', async () => {
      const chain = await setupFullChain();

      const res1 = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      const res2 = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      expect(res2.body.id).toBe(res1.body.id);
    });

    it('POST /renditions/generate — no commission configured returns 400', async () => {
      const chain = await setupFullChain();

      // Remove commission config
      await prisma.baseClient.contractCommission.deleteMany({
        where: { contractId: chain.contract.id },
      });

      const res = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(400);

      expect(res.body.error).toBe('COMMISSION_NOT_CONFIGURED');
    });

    it('POST /renditions/generate — no payments in period generates with zero amounts', async () => {
      const chain = await setupFullChain();

      // Generate for a month with no payments (April)
      const res = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 4, year: 2026 })
        .expect(201);

      expect(res.body.status).toBe(RendicionStatus.Borrador);
      expect(Number(res.body.rentCollected)).toBe(0);
      // Admin fee still applies even when no rent collected, so netDeposit may be negative
      expect(Number(res.body.netDeposit)).toBeLessThanOrEqual(0);
    });
  });

  // ─── 3. Rendition CRUD ───────────────────────────────

  describe('Rendition CRUD', () => {
    it('GET /renditions — list with pagination', async () => {
      const chain = await setupFullChain();

      // Generate a rendition
      await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/renditions')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
      expect(res.body.items[0].contract).toBeDefined();
      expect(res.body.items[0].owner).toBeDefined();
    });

    it('GET /renditions/:id — detail with line items', async () => {
      const chain = await setupFullChain();

      const genRes = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/renditions/${genRes.body.id}`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(genRes.body.id);
      expect(res.body.lineItems).toBeDefined();
      expect(res.body.lineItems.length).toBeGreaterThan(0);
      expect(res.body.contract).toBeDefined();
      expect(res.body.owner).toBeDefined();
    });

    it('PATCH /renditions/:id/notes — update notes', async () => {
      const chain = await setupFullChain();

      const genRes = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/renditions/${genRes.body.id}/notes`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ notes: 'Propietario confirmó recepción' })
        .expect(200);

      expect(res.body.notes).toBe('Propietario confirmó recepción');
    });
  });

  // ─── 4. State Transitions ────────────────────────────

  describe('State Transitions', () => {
    it('full flow: Borrador→Aprobada→Enviada→Depositada', async () => {
      const chain = await setupFullChain();

      const genRes = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      const rendicionId = genRes.body.id;

      // Borrador → Aprobada
      const r1 = await request(app.getHttpServer())
        .patch(`/api/renditions/${rendicionId}/transition`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ status: RendicionStatus.Aprobada })
        .expect(200);
      expect(r1.body.status).toBe(RendicionStatus.Aprobada);

      // Aprobada → Enviada
      const r2 = await request(app.getHttpServer())
        .patch(`/api/renditions/${rendicionId}/transition`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ status: RendicionStatus.Enviada })
        .expect(200);
      expect(r2.body.status).toBe(RendicionStatus.Enviada);
      expect(r2.body.sentAt).toBeTruthy();

      // Enviada → Depositada
      const r3 = await request(app.getHttpServer())
        .patch(`/api/renditions/${rendicionId}/transition`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ status: RendicionStatus.Depositada })
        .expect(200);
      expect(r3.body.status).toBe(RendicionStatus.Depositada);
      expect(r3.body.depositedAt).toBeTruthy();
    });

    it('backward: Aprobada→Borrador', async () => {
      const chain = await setupFullChain();

      const genRes = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      const rendicionId = genRes.body.id;

      // Borrador → Aprobada
      await request(app.getHttpServer())
        .patch(`/api/renditions/${rendicionId}/transition`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ status: RendicionStatus.Aprobada })
        .expect(200);

      // Aprobada → Borrador (backward)
      const res = await request(app.getHttpServer())
        .patch(`/api/renditions/${rendicionId}/transition`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ status: RendicionStatus.Borrador })
        .expect(200);

      expect(res.body.status).toBe(RendicionStatus.Borrador);
    });

    it('invalid: Borrador→Enviada returns 400', async () => {
      const chain = await setupFullChain();

      const genRes = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/renditions/${genRes.body.id}/transition`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ status: RendicionStatus.Enviada })
        .expect(400);

      expect(res.body.error).toBe('INVALID_TRANSITION');
    });

    it('terminal: Depositada→anything returns 400', async () => {
      const chain = await setupFullChain();

      const genRes = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      const rendicionId = genRes.body.id;

      // Walk to Depositada
      await request(app.getHttpServer())
        .patch(`/api/renditions/${rendicionId}/transition`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ status: RendicionStatus.Aprobada })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/renditions/${rendicionId}/transition`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ status: RendicionStatus.Enviada })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/renditions/${rendicionId}/transition`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ status: RendicionStatus.Depositada })
        .expect(200);

      // Depositada → Borrador should fail
      const res = await request(app.getHttpServer())
        .patch(`/api/renditions/${rendicionId}/transition`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ status: RendicionStatus.Borrador })
        .expect(400);

      expect(res.body.error).toBe('INVALID_TRANSITION');
    });
  });

  // ─── 5. PDF Download ─────────────────────────────────

  describe('PDF Download', () => {
    it('GET /renditions/:id/pdf — returns PDF buffer with correct Content-Type', async () => {
      const chain = await setupFullChain();

      const genRes = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/renditions/${genRes.body.id}/pdf`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('rendicion-');
      expect(res.body).toBeDefined();
      expect(mockPdfService.generateRenditionPdf).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 6. Line Item Management ─────────────────────────

  describe('Line Item Management', () => {
    it('POST /renditions/:id/line-items — add custom deduction', async () => {
      const chain = await setupFullChain();

      const genRes = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      const originalLineItemCount = genRes.body.lineItems.length;
      const originalNetDeposit = Number(genRes.body.netDeposit);

      const res = await request(app.getHttpServer())
        .post(`/api/renditions/${genRes.body.id}/line-items`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({
          type: RendicionLineItemType.Deduccion,
          description: 'Expensas marzo 2026',
          amount: '2000.00',
          isDebit: true,
        })
        .expect(201);

      // Should have one more line item
      expect(res.body.lineItems.length).toBe(originalLineItemCount + 1);
      // Net deposit should be recalculated (deduction reduces it by 2000)
      expect(Number(res.body.netDeposit)).toBe(originalNetDeposit - 2000);
    });

    it('DELETE /renditions/:id/line-items/:itemId — remove line item', async () => {
      const chain = await setupFullChain();

      const genRes = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      // Add a deduction first
      const addRes = await request(app.getHttpServer())
        .post(`/api/renditions/${genRes.body.id}/line-items`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({
          type: RendicionLineItemType.Deduccion,
          description: 'To remove',
          amount: '1000.00',
          isDebit: true,
        })
        .expect(201);

      const addedItem = addRes.body.lineItems.find(
        (li: any) => li.description === 'To remove',
      );
      const countBefore = addRes.body.lineItems.length;

      // Remove it
      const res = await request(app.getHttpServer())
        .delete(
          `/api/renditions/${genRes.body.id}/line-items/${addedItem.id}`,
        )
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.lineItems.length).toBe(countBefore - 1);
    });
  });

  // ─── 7. RBAC ──────────────────────────────────────────

  describe('RBAC', () => {
    it('Admin can perform transitions — 200', async () => {
      const chain = await setupFullChain();

      const genRes = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      // Admin transitions Borrador → Aprobada
      const res = await request(app.getHttpServer())
        .patch(`/api/renditions/${genRes.body.id}/transition`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ status: RendicionStatus.Aprobada })
        .expect(200);

      expect(res.body.status).toBe(RendicionStatus.Aprobada);
    });

    it('Lectura cannot perform mutations — 403', async () => {
      const chain = await setupFullChain();

      // Create Lectura user in the same tenant
      const lecturaUser = await createUserDirect(prisma, chain.tenantId, {
        email: `lectura-rend-${Date.now()}@test.com`,
        role: UserRole.Lectura,
        password: 'Test1234!',
      });

      const { accessToken: lecturaToken } = await loginUser(
        app,
        lecturaUser.email,
        'Test1234!',
      );

      // Lectura cannot generate renditions
      await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${lecturaToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(403);

      // Lectura cannot create commissions
      await request(app.getHttpServer())
        .post(`/api/contracts/${chain.contract.id}/commission`)
        .set('Authorization', `Bearer ${lecturaToken}`)
        .send({
          type: CommissionType.FixedPercent,
          percentage: '10.00',
        })
        .expect(403);
    });
  });

  // ─── 8. Tenant Isolation ─────────────────────────────

  describe('Tenant Isolation', () => {
    it('Tenant B cannot see Tenant A renditions — 404', async () => {
      // Setup Tenant A with a rendition
      const chainA = await setupFullChain();

      const genRes = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chainA.accessToken}`)
        .send({ contractId: chainA.contract.id, month: 3, year: 2026 })
        .expect(201);

      const rendicionIdA = genRes.body.id;

      // Setup Tenant B (separate user registration creates separate tenant)
      const { accessToken: tokenB } = await createTestUser(app, {
        email: `tenant-b-${Date.now()}@test.com`,
        password: 'Test1234!',
        firstName: 'TenantB',
        lastName: 'Admin',
      });

      // Tenant B tries to access Tenant A's rendition
      await request(app.getHttpServer())
        .get(`/api/renditions/${rendicionIdA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      // Tenant B list should be empty
      const listRes = await request(app.getHttpServer())
        .get('/api/renditions')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(listRes.body.items).toHaveLength(0);
      expect(listRes.body.total).toBe(0);
    });
  });

  // ─── 9. Edge Cases ───────────────────────────────────

  describe('Edge Cases', () => {
    it('GET /renditions/:id — 404 for non-existent rendition', async () => {
      const chain = await setupFullChain();

      await request(app.getHttpServer())
        .get('/api/renditions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(404);
    });

    it('Line items cannot be added when rendition is not Borrador', async () => {
      const chain = await setupFullChain();

      const genRes = await request(app.getHttpServer())
        .post('/api/renditions/generate')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ contractId: chain.contract.id, month: 3, year: 2026 })
        .expect(201);

      // Transition to Aprobada
      await request(app.getHttpServer())
        .patch(`/api/renditions/${genRes.body.id}/transition`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ status: RendicionStatus.Aprobada })
        .expect(200);

      // Try to add line item — should fail
      const res = await request(app.getHttpServer())
        .post(`/api/renditions/${genRes.body.id}/line-items`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({
          type: RendicionLineItemType.Deduccion,
          description: 'Should fail',
          amount: '500.00',
        })
        .expect(400);

      expect(res.body.error).toBe('NOT_EDITABLE');
    });
  });
});
