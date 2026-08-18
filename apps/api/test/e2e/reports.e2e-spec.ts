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
import { ReportExcelService } from '../../src/modules/reports/report-excel.service';
import { ReportPdfService } from '../../src/modules/reports/report-pdf.service';
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
  PipelineType,
  LeadSource,
  LeadStatus,
} from '@realfy/shared';

describe('Reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Mock Excel & PDF services to avoid heavy dependencies in e2e tests
  const mockExcelService = {
    generateExcel: jest.fn().mockResolvedValue(
      Buffer.from('PK\x03\x04 mock xlsx'),
    ),
  };

  const mockPdfService = {
    generatePdf: jest.fn().mockResolvedValue(
      Buffer.from('%PDF-1.4 mock report'),
    ),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [(await import('../../src/app.module')).AppModule],
    })
      .overrideProvider(ReportExcelService)
      .useValue(mockExcelService)
      .overrideProvider(ReportPdfService)
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
    mockExcelService.generateExcel.mockResolvedValue(
      Buffer.from('PK\x03\x04 mock xlsx'),
    );
    mockPdfService.generatePdf.mockResolvedValue(
      Buffer.from('%PDF-1.4 mock report'),
    );
  });

  // ─── Helpers ──────────────────────────────────────────

  /**
   * Creates full chain: tenant → user → property → owner → inquilino →
   * contract → commission → liquidación (Pagada) → payment → comprobante →
   * ownerRendición with line items.
   */
  async function setupFullChain(role: UserRole = UserRole.Admin) {
    const { accessToken, user } = await createTestUser(app, {
      email: `report-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
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

    // Create owner person
    const owner = await prisma.baseClient.person.create({
      data: {
        tenantId,
        firstName: 'Carlos',
        lastName: 'Propietario',
        email: `carlos-${Date.now()}@test.com`,
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
        email: `juan-${Date.now()}@test.com`,
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

    // Create commission config
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

    // Create liquidación (Pagada)
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

    // Create comprobante for the payment
    const comprobante = await prisma.baseClient.comprobante.create({
      data: {
        tenantId,
        paymentId: payment.id,
        type: 'FacturaB',
        status: 'Emitido',
        cbteTipo: 6,
        puntoDeVenta: 1,
        numero: 1,
        concepto: 2,
        docTipo: 96,
        docNro: '20123456780',
        receptorName: 'Juan Inquilino',
        receptorFiscalCondition: FiscalCondition.ConsumidorFinal,
        impTotal: '181500.00',
        impNeto: '150000.00',
        impIva: '31500.00',
        impExento: '0.00',
        currency: 'ARS',
        cae: '71234567890123',
        caeFchVto: new Date('2026-04-05'),
        emittedAt: new Date('2026-03-05'),
      },
    });

    // Create owner rendición with line items
    const rendicion = await prisma.baseClient.ownerRendicion.create({
      data: {
        tenantId,
        contractId: contract.id,
        ownerId: owner.id,
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
            {
              tenantId,
              type: 'Alquiler',
              description: 'Alquiler cobrado 03/2026',
              amount: '150000.00',
              isDebit: false,
              sortOrder: 1,
            },
            {
              tenantId,
              type: 'Comision',
              description: 'Comisión 5%',
              amount: '7500.00',
              isDebit: true,
              sortOrder: 2,
            },
            {
              tenantId,
              type: 'AdminFee',
              description: 'Honorarios de administración',
              amount: '5000.00',
              isDebit: true,
              sortOrder: 3,
            },
          ],
        },
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
      commission,
      liquidacion,
      payment,
      comprobante,
      rendicion,
    };
  }

  // ─── 1. Owner Statement JSON ──────────────────────────

  describe('Owner Statement', () => {
    it('GET /reports/ownerStatement — returns JSON with correct data', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .get('/api/reports/ownerStatement')
        .query({ ownerId: chain.owner.id })
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.type).toBe('ownerStatement');
      expect(res.body.title).toBe('Estado de Cuenta del Propietario');
      expect(res.body.rows.length).toBeGreaterThanOrEqual(1);
      expect(res.body.columns).toContain('Cobrado');
      expect(res.body.summary).toBeDefined();
      expect(res.body.generatedAt).toBeDefined();
    });

    it('GET /reports/ownerStatement — 400 without ownerId', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .get('/api/reports/ownerStatement')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  // ─── 2. Property Profitability JSON ───────────────────

  describe('Property Profitability', () => {
    it('GET /reports/propertyProfitability — returns JSON data', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .get('/api/reports/propertyProfitability')
        .query({ from: '2026-01-01', to: '2026-12-31' })
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.type).toBe('propertyProfitability');
      expect(res.body.rows.length).toBeGreaterThanOrEqual(1);
      expect(res.body.summary).toBeDefined();
    });
  });

  // ─── 3. Cash Flow JSON ───────────────────────────────

  describe('Cash Flow', () => {
    it('GET /reports/cashFlow — returns monthly rows', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .get('/api/reports/cashFlow')
        .query({ from: '2026-03-01', to: '2026-03-31' })
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.type).toBe('cashFlow');
      expect(res.body.rows.length).toBeGreaterThanOrEqual(1);
      expect(res.body.summary).toBeDefined();
    });
  });

  // ─── 4. Commission Summary JSON ──────────────────────

  describe('Commission Summary', () => {
    it('GET /reports/commissionSummary — returns commission data', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .get('/api/reports/commissionSummary')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.type).toBe('commissionSummary');
      expect(res.body.rows.length).toBeGreaterThanOrEqual(1);
      expect(res.body.summary).toBeDefined();
    });
  });

  // ─── 5. Excel Download ───────────────────────────────

  describe('Excel Download', () => {
    it('GET /reports/ownerStatement/excel — returns xlsx with correct Content-Type', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .get('/api/reports/ownerStatement/excel')
        .query({ ownerId: chain.owner.id })
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(res.headers['content-disposition']).toContain('.xlsx');
      expect(res.body).toBeDefined();
      expect(mockExcelService.generateExcel).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 6. PDF Download ─────────────────────────────────

  describe('PDF Download', () => {
    it('GET /reports/cashFlow/pdf — returns PDF with correct Content-Type', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .get('/api/reports/cashFlow/pdf')
        .query({ from: '2026-01-01', to: '2026-12-31' })
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('.pdf');
      expect(res.body).toBeDefined();
      expect(mockPdfService.generatePdf).toHaveBeenCalledTimes(1);
    });
  });

  // ─── 7. Invalid Report Type ──────────────────────────

  describe('Invalid Report Type', () => {
    it('GET /reports/invalidType — returns 400', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .get('/api/reports/invalidType')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(400);

      expect(res.body.error).toBe('INVALID_REPORT_TYPE');
    });
  });

  // ─── 8. RBAC ─────────────────────────────────────────

  describe('RBAC', () => {
    it('Lectura role gets 403 on report JSON endpoint', async () => {
      const chain = await setupFullChain();

      // Create Lectura user in the same tenant
      const lecturaUser = await createUserDirect(prisma, chain.tenantId, {
        email: `lectura-report-${Date.now()}@test.com`,
        role: UserRole.Lectura,
        password: 'Test1234!',
      });

      const { accessToken: lecturaToken } = await loginUser(
        app,
        lecturaUser.email,
        'Test1234!',
      );

      await request(app.getHttpServer())
        .get('/api/reports/cashFlow')
        .set('Authorization', `Bearer ${lecturaToken}`)
        .expect(403);
    });

    it('Lectura role gets 403 on Excel download', async () => {
      const chain = await setupFullChain();

      const lecturaUser = await createUserDirect(prisma, chain.tenantId, {
        email: `lectura-excel-${Date.now()}@test.com`,
        role: UserRole.Lectura,
        password: 'Test1234!',
      });

      const { accessToken: lecturaToken } = await loginUser(
        app,
        lecturaUser.email,
        'Test1234!',
      );

      await request(app.getHttpServer())
        .get('/api/reports/cashFlow/excel')
        .set('Authorization', `Bearer ${lecturaToken}`)
        .expect(403);
    });

    it('Lectura role gets 403 on PDF download', async () => {
      const chain = await setupFullChain();

      const lecturaUser = await createUserDirect(prisma, chain.tenantId, {
        email: `lectura-pdf-${Date.now()}@test.com`,
        role: UserRole.Lectura,
        password: 'Test1234!',
      });

      const { accessToken: lecturaToken } = await loginUser(
        app,
        lecturaUser.email,
        'Test1234!',
      );

      await request(app.getHttpServer())
        .get('/api/reports/cashFlow/pdf')
        .set('Authorization', `Bearer ${lecturaToken}`)
        .expect(403);
    });
  });

  // ─── 9. Empty Results ────────────────────────────────

  describe('Empty Results', () => {
    it('valid filters with no matching data returns empty items array', async () => {
      const chain = await setupFullChain();

      // Use a different owner ID that doesn't have data
      // Create a new person with no renditions
      const emptyOwner = await prisma.baseClient.person.create({
        data: {
          tenantId: chain.tenantId,
          firstName: 'Empty',
          lastName: 'Owner',
          email: `empty-${Date.now()}@test.com`,
          cuit: '20-99999999-0',
          fiscalCondition: FiscalCondition.ConsumidorFinal,
        },
      });

      const res = await request(app.getHttpServer())
        .get('/api/reports/ownerStatement')
        .query({ ownerId: emptyOwner.id })
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.rows).toEqual([]);
      expect(res.body.type).toBe('ownerStatement');
    });

    it('propertyProfitability with date range having no payments returns empty rows', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .get('/api/reports/propertyProfitability')
        .query({ from: '2020-01-01', to: '2020-12-31' })
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.rows).toEqual([]);
    });
  });

  // ─── 10. Pipeline Analytics ──────────────────────────

  describe('Pipeline Analytics', () => {
    /**
     * Helper: Finds the existing Alquiler pipeline (seeded on registration)
     * and creates leads in its stages for pipeline analytics testing.
     */
    async function setupPipelineData(tenantId: string) {
      // Create a person for leads
      const person = await prisma.baseClient.person.create({
        data: {
          tenantId,
          firstName: 'Lead',
          lastName: 'Person',
          email: `lead-person-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
          cuit: '20-55555555-0',
          fiscalCondition: FiscalCondition.ConsumidorFinal,
        },
      });

      // Find the existing seeded Alquiler pipeline
      const pipeline = await prisma.baseClient.pipeline.findFirstOrThrow({
        where: { tenantId, type: PipelineType.Alquiler },
        include: { stages: { orderBy: { sortOrder: 'asc' } } },
      });

      const stages = pipeline.stages;
      // Use the first 3 stages (seeded pipeline should have them)
      const stage0 = stages[0];
      const stage1 = stages[1] ?? stages[0];
      const stage2 = stages[2] ?? stages[0];

      // Lead 1: Convertido in first stage (created 10 days ago, converted 5 days ago)
      const now = new Date();
      await prisma.baseClient.lead.create({
        data: {
          tenantId,
          personId: person.id,
          pipelineId: pipeline.id,
          currentStageId: stage0.id,
          source: LeadSource.WebInquiry,
          status: LeadStatus.Convertido,
          convertedAt: new Date(now.getTime() - 5 * 86400000),
          createdAt: new Date(now.getTime() - 10 * 86400000),
        },
      });

      // Lead 2: Perdido in second stage
      await prisma.baseClient.lead.create({
        data: {
          tenantId,
          personId: person.id,
          pipelineId: pipeline.id,
          currentStageId: stage1.id,
          source: LeadSource.PhoneCall,
          status: LeadStatus.Perdido,
          lostAt: new Date(now.getTime() - 2 * 86400000),
          createdAt: new Date(now.getTime() - 8 * 86400000),
        },
      });

      // Lead 3: Nuevo in third stage
      await prisma.baseClient.lead.create({
        data: {
          tenantId,
          personId: person.id,
          pipelineId: pipeline.id,
          currentStageId: stage2.id,
          source: LeadSource.Email,
          status: LeadStatus.Nuevo,
          createdAt: new Date(now.getTime() - 3 * 86400000),
        },
      });

      return { pipeline, stages, person };
    }

    it('GET /reports/pipelineAnalytics — returns correct shape', async () => {
      const chain = await setupFullChain();
      await setupPipelineData(chain.tenantId);

      const res = await request(app.getHttpServer())
        .get('/api/reports/pipelineAnalytics')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.type).toBe('pipelineAnalytics');
      expect(res.body.title).toBe('Analítica de Pipeline');
      expect(res.body.columns).toEqual(
        expect.arrayContaining(['Etapa', 'Leads Actuales', 'Convertidos', 'Perdidos', 'Tasa Conversión']),
      );
      expect(Array.isArray(res.body.rows)).toBe(true);
      expect(res.body.rows.length).toBeGreaterThanOrEqual(3);
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.totalLeads).toBeDefined();
      expect(res.body.summary.totalConvertidos).toBeDefined();
      expect(res.body.summary.tasaConversionGeneral).toBeDefined();
      expect(res.body.generatedAt).toBeDefined();
    });

    it('GET /reports/pipelineAnalytics — per-stage data is correct', async () => {
      const chain = await setupFullChain();
      const { pipeline } = await setupPipelineData(chain.tenantId);

      const res = await request(app.getHttpServer())
        .get('/api/reports/pipelineAnalytics')
        .query({ pipelineId: pipeline.id })
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      // We created leads in the first 3 stages
      expect(res.body.rows.length).toBeGreaterThanOrEqual(3);

      // First stage has the converted lead
      const firstStageRow = res.body.rows.find((r: any) => r.etapa.includes('Consulta nueva'));
      expect(firstStageRow).toBeDefined();
      expect(firstStageRow.convertidos).toBe('1');

      // Second stage has the lost lead
      const secondStageRow = res.body.rows.find((r: any) => r.etapa.includes('Contactado'));
      expect(secondStageRow).toBeDefined();
      expect(secondStageRow.perdidos).toBe('1');
    });

    it('GET /reports/pipelineAnalytics/excel — returns xlsx', async () => {
      const chain = await setupFullChain();
      await setupPipelineData(chain.tenantId);

      const res = await request(app.getHttpServer())
        .get('/api/reports/pipelineAnalytics/excel')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(res.headers['content-disposition']).toContain('analitica-pipeline');
      expect(mockExcelService.generateExcel).toHaveBeenCalledTimes(1);
    });

    it('Lectura role gets 403 on pipelineAnalytics', async () => {
      const chain = await setupFullChain();

      const lecturaUser = await createUserDirect(prisma, chain.tenantId, {
        email: `lectura-pipeline-${Date.now()}@test.com`,
        role: UserRole.Lectura,
        password: 'Test1234!',
      });

      const { accessToken: lecturaToken } = await loginUser(
        app,
        lecturaUser.email,
        'Test1234!',
      );

      await request(app.getHttpServer())
        .get('/api/reports/pipelineAnalytics')
        .set('Authorization', `Bearer ${lecturaToken}`)
        .expect(403);
    });
  });

  // ─── 11. Morosidad ──────────────────────────────────

  describe('Morosidad', () => {
    /**
     * Helper: Creates overdue liquidaciones for morosidad testing.
     */
    async function setupOverdueLiquidaciones(
      tenantId: string,
      contractId: string,
    ) {
      const now = new Date();
      // Overdue Enviada (due 20 days ago)
      const liq1 = await prisma.baseClient.liquidacion.create({
        data: {
          tenantId,
          contractId,
          period: new Date('2026-02-01'),
          dueDate: new Date(now.getTime() - 20 * 86400000),
          status: LiquidacionStatus.Enviada,
          subtotal: '150000.00',
          total: '150000.00',
          currency: 'ARS',
        },
      });

      // Overdue Vencida (due 35 days ago)
      const liq2 = await prisma.baseClient.liquidacion.create({
        data: {
          tenantId,
          contractId,
          period: new Date('2026-01-01'),
          dueDate: new Date(now.getTime() - 35 * 86400000),
          status: LiquidacionStatus.Vencida,
          subtotal: '150000.00',
          total: '150000.00',
          currency: 'ARS',
        },
      });

      return { liq1, liq2 };
    }

    it('GET /reports/morosidad — returns correct shape', async () => {
      const chain = await setupFullChain();
      await setupOverdueLiquidaciones(chain.tenantId, chain.contract.id);

      const res = await request(app.getHttpServer())
        .get('/api/reports/morosidad')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.body.type).toBe('morosidad');
      expect(res.body.title).toBe('Reporte de Morosidad');
      expect(res.body.columns).toEqual(
        expect.arrayContaining(['Propiedad', 'Inquilino', 'Días Vencidos', 'Monto', 'Moneda']),
      );
      expect(Array.isArray(res.body.rows)).toBe(true);
      expect(res.body.rows.length).toBeGreaterThanOrEqual(2);
      expect(res.body.summary).toBeDefined();
      expect(res.body.summary.totalVencido).toBeDefined();
      expect(res.body.summary.cantidadVencidas).toBeDefined();
      expect(res.body.generatedAt).toBeDefined();
    });

    it('GET /reports/morosidad — rows contain correct overdue data', async () => {
      const chain = await setupFullChain();
      await setupOverdueLiquidaciones(chain.tenantId, chain.contract.id);

      const res = await request(app.getHttpServer())
        .get('/api/reports/morosidad')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      // Each row should have numeric diasVencidos > 0
      for (const row of res.body.rows) {
        expect(Number(row.diasVencidos)).toBeGreaterThan(0);
        expect(Number(row.monto)).toBeGreaterThan(0);
        expect(row.moneda).toBe('ARS');
        expect(row.propiedad).toBeTruthy();
        expect(row.inquilino).toBeTruthy();
      }

      // Summary totalVencido should be sum of montos
      expect(Number(res.body.summary.totalVencido)).toBeGreaterThan(0);
      expect(Number(res.body.summary.cantidadVencidas)).toBeGreaterThanOrEqual(2);
    });

    it('GET /reports/morosidad/excel — returns xlsx', async () => {
      const chain = await setupFullChain();
      await setupOverdueLiquidaciones(chain.tenantId, chain.contract.id);

      const res = await request(app.getHttpServer())
        .get('/api/reports/morosidad/excel')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.headers['content-type']).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(res.headers['content-disposition']).toContain('morosidad');
      expect(mockExcelService.generateExcel).toHaveBeenCalledTimes(1);
    });

    it('GET /reports/morosidad/pdf — returns PDF', async () => {
      const chain = await setupFullChain();
      await setupOverdueLiquidaciones(chain.tenantId, chain.contract.id);

      const res = await request(app.getHttpServer())
        .get('/api/reports/morosidad/pdf')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('morosidad');
      expect(mockPdfService.generatePdf).toHaveBeenCalledTimes(1);
    });

    it('Lectura role gets 403 on morosidad', async () => {
      const chain = await setupFullChain();

      const lecturaUser = await createUserDirect(prisma, chain.tenantId, {
        email: `lectura-morosidad-${Date.now()}@test.com`,
        role: UserRole.Lectura,
        password: 'Test1234!',
      });

      const { accessToken: lecturaToken } = await loginUser(
        app,
        lecturaUser.email,
        'Test1234!',
      );

      await request(app.getHttpServer())
        .get('/api/reports/morosidad')
        .set('Authorization', `Bearer ${lecturaToken}`)
        .expect(403);
    });
  });

  // ─── 12. Report Schedule CRUD ─────────────────────────

  describe('Report Schedules', () => {
    it('POST /report-schedules — creates a schedule with nextRunAt', async () => {
      const chain = await setupFullChain();

      const res = await request(app.getHttpServer())
        .post('/api/report-schedules')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({
          reportType: 'morosidad',
          frequency: 'monthly',
          recipients: ['admin@test.com'],
          format: 'excel',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.reportType).toBe('morosidad');
      expect(res.body.frequency).toBe('monthly');
      expect(res.body.recipients).toEqual(['admin@test.com']);
      expect(res.body.format).toBe('excel');
      expect(res.body.isActive).toBe(true);
      expect(res.body.nextRunAt).toBeDefined();
      // nextRunAt should be 1st of next month at 12:00 UTC for monthly
      const nextRun = new Date(res.body.nextRunAt);
      expect(nextRun.getUTCDate()).toBe(1);
      expect(nextRun.getUTCHours()).toBe(12);
    });

    it('GET /report-schedules — returns list including created schedule', async () => {
      const chain = await setupFullChain();

      // Create a schedule first
      await request(app.getHttpServer())
        .post('/api/report-schedules')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({
          reportType: 'cashFlow',
          frequency: 'weekly',
          recipients: ['weekly@test.com'],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/report-schedules')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].reportType).toBe('cashFlow');
    });

    it('PATCH /report-schedules/:id — updates frequency', async () => {
      const chain = await setupFullChain();

      const created = await request(app.getHttpServer())
        .post('/api/report-schedules')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({
          reportType: 'morosidad',
          frequency: 'weekly',
          recipients: ['update@test.com'],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/report-schedules/${created.body.id}`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({ frequency: 'daily' })
        .expect(200);

      expect(res.body.frequency).toBe('daily');
      // nextRunAt should be recomputed for daily (tomorrow at 12:00 UTC)
      const nextRun = new Date(res.body.nextRunAt);
      expect(nextRun.getUTCHours()).toBe(12);
    });

    it('DELETE /report-schedules/:id — removes schedule', async () => {
      const chain = await setupFullChain();

      const created = await request(app.getHttpServer())
        .post('/api/report-schedules')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .send({
          reportType: 'cashFlow',
          frequency: 'daily',
          recipients: ['delete@test.com'],
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/report-schedules/${created.body.id}`)
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      // Verify it's gone
      const list = await request(app.getHttpServer())
        .get('/api/report-schedules')
        .set('Authorization', `Bearer ${chain.accessToken}`)
        .expect(200);

      const found = list.body.find((s: any) => s.id === created.body.id);
      expect(found).toBeUndefined();
    });

    it('Tenant isolation — schedule from tenant A not visible to tenant B', async () => {
      // Tenant A
      const chainA = await setupFullChain();
      const createdA = await request(app.getHttpServer())
        .post('/api/report-schedules')
        .set('Authorization', `Bearer ${chainA.accessToken}`)
        .send({
          reportType: 'morosidad',
          frequency: 'monthly',
          recipients: ['tenantA@test.com'],
        })
        .expect(201);

      // Tenant B
      const chainB = await setupFullChain();
      const listB = await request(app.getHttpServer())
        .get('/api/report-schedules')
        .set('Authorization', `Bearer ${chainB.accessToken}`)
        .expect(200);

      const foundInB = listB.body.find((s: any) => s.id === createdA.body.id);
      expect(foundInB).toBeUndefined();
    });

    it('RBAC — Lectura role cannot create schedules', async () => {
      const chain = await setupFullChain();

      const lecturaUser = await createUserDirect(prisma, chain.tenantId, {
        email: `lectura-sched-${Date.now()}@test.com`,
        role: UserRole.Lectura,
        password: 'Test1234!',
      });

      const { accessToken: lecturaToken } = await loginUser(
        app,
        lecturaUser.email,
        'Test1234!',
      );

      await request(app.getHttpServer())
        .post('/api/report-schedules')
        .set('Authorization', `Bearer ${lecturaToken}`)
        .send({
          reportType: 'cashFlow',
          frequency: 'daily',
          recipients: ['lectura@test.com'],
        })
        .expect(403);
    });
  });
});
