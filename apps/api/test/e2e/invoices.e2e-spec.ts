import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  createTestUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { resetAfipMock } from '../../src/modules/invoices/arca/__mocks__/afip-mock';
import {
  PersonRole,
  ContractType,
  ContractStatus,
  PropertyType,
  AdjustmentType,
  AdjustmentPeriod,
  LiquidacionStatus,
  PaymentMethod,
  FiscalCondition,
} from '@realfy/shared';

/**
 * Facturacion electronica — end-to-end con ARCA simulado
 *
 * Recorre la cadena completa HTTP → servicio → cliente de ARCA → base, con el
 * cliente simulado de ARCA_MOCK=1 en lugar del organismo. Cubre:
 *  1. Emision de una factura C con el emisor y punto de venta configurados
 *  2. Numeracion correlativa del mismo emisor
 *  3. Dos emisores de la misma inmobiliaria con el mismo punto de venta, tipo y
 *     numero (ARCA numera por CUIT, asi que es un caso valido)
 *  4. Idempotencia por clientRequestId
 *  5. Aislamiento: una inmobiliaria no puede emitir con el emisor de otra
 */

const FACTURA_C = 11;

describe('Invoices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const previousArcaMock = process.env['ARCA_MOCK'];

  beforeAll(async () => {
    process.env['ARCA_MOCK'] = '1';
    const setup = await setupTestApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await teardownTestApp();
    if (previousArcaMock === undefined) delete process.env['ARCA_MOCK'];
    else process.env['ARCA_MOCK'] = previousArcaMock;
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    resetAfipMock();
  });

  // ─── Helpers ──────────────────────────────────────────

  /** Inmobiliaria con un contrato, una liquidacion pagada y su pago. */
  async function setupTenantWithPayment() {
    const { accessToken, user } = await createTestUser(app);
    const tenantId = user.tenantId;

    const property = await prisma.baseClient.property.create({
      data: {
        tenantId,
        title: 'Depto Nueva Cordoba',
        type: PropertyType.Departamento,
        street: 'Obispo Trejo',
        number: '450',
        city: 'Cordoba',
        province: 'Cordoba',
        price: 350000,
        currency: 'ARS',
      },
    });

    const inquilino = await prisma.baseClient.person.create({
      data: {
        tenantId,
        firstName: 'Lucia',
        lastName: 'Inquilina',
        email: `lucia-${randomUUID()}@test.com`,
        fiscalCondition: FiscalCondition.ConsumidorFinal,
      },
    });

    const contract = await prisma.baseClient.contract.create({
      data: {
        tenantId,
        propertyId: property.id,
        contractType: ContractType.Alquiler,
        status: ContractStatus.Activo,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2028-01-01'),
        rentAmount: '350000.00',
        rentCurrency: 'ARS',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        isActive: true,
        persons: {
          create: { tenantId, personId: inquilino.id, role: PersonRole.Inquilino },
        },
      },
    });

    const liquidacion = await prisma.baseClient.liquidacion.create({
      data: {
        tenantId,
        contractId: contract.id,
        period: new Date('2026-09-01'),
        dueDate: new Date('2026-09-10'),
        status: LiquidacionStatus.Pagada,
        subtotal: '350000.00',
        total: '350000.00',
        currency: 'ARS',
      },
    });

    const payment = await prisma.baseClient.payment.create({
      data: {
        tenantId,
        liquidacionId: liquidacion.id,
        amount: '350000.00',
        currency: 'ARS',
        method: PaymentMethod.Transferencia,
        paidAt: new Date('2026-09-05'),
      },
    });

    return { accessToken, tenantId, payment };
  }

  /** Crea un emisor monotributista con el punto de venta 1. */
  async function createIssuer(token: string, cuit: string, businessName: string) {
    const issuerRes = await request(app.getHttpServer())
      .post('/api/invoices/issuers')
      .set('Authorization', `Bearer ${token}`)
      .send({ cuit, businessName, fiscalCondition: FiscalCondition.Monotributista })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/invoices/issuers/${issuerRes.body.id}/pdv`)
      .set('Authorization', `Bearer ${token}`)
      .send({ number: 1 })
      .expect(201);

    return issuerRes.body.id as string;
  }

  function emit(token: string, issuerId: string, paymentId: string, clientRequestId?: string) {
    return request(app.getHttpServer())
      .post('/api/invoices/emit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        issuerId,
        ptoVta: 1,
        cbteTipo: FACTURA_C,
        concepto: 2,
        cbteFch: '2026-09-28',
        receptor: {
          docTipo: 99,
          docNro: '0',
          businessName: 'Lucia Inquilina',
          fiscalCondition: FiscalCondition.ConsumidorFinal,
          condicionIVAReceptorId: 5,
        },
        impTotal: '350000.00',
        impNeto: '350000.00',
        fchServDesde: '2026-09-01',
        fchServHasta: '2026-09-30',
        fchVtoPago: '2026-10-10',
        paymentId,
        description: 'Alquiler 09/2026',
        ...(clientRequestId ? { clientRequestId } : {}),
      });
  }

  // ─── 1. Emision ───────────────────────────────────────

  it('POST /invoices/emit — emite la factura y la registra con CAE y numero', async () => {
    const { accessToken, payment } = await setupTenantWithPayment();
    const issuerId = await createIssuer(accessToken, '20-30111222-0', 'Emisor Uno');

    const res = await emit(accessToken, issuerId, payment.id).expect(201);

    expect(res.body.issuerId).toBe(issuerId);
    expect(res.body.puntoDeVenta).toBe(1);
    expect(res.body.cbteTipo).toBe(FACTURA_C);
    expect(res.body.numero).toBe(1);
    expect(res.body.cae).toMatch(/^\d{14}$/);

    const list = await request(app.getHttpServer())
      .get('/api/invoices')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(res.body.id);
  });

  // ─── 2. Numeracion correlativa ────────────────────────

  it('numera en forma correlativa las emisiones del mismo emisor', async () => {
    const { accessToken, payment } = await setupTenantWithPayment();
    const issuerId = await createIssuer(accessToken, '20-30111222-0', 'Emisor Uno');

    const first = await emit(accessToken, issuerId, payment.id).expect(201);
    const second = await emit(accessToken, issuerId, payment.id).expect(201);

    expect(first.body.numero).toBe(1);
    expect(second.body.numero).toBe(2);
  });

  // ─── 3. Varios emisores ───────────────────────────────

  it('registra el mismo numero para dos emisores con el mismo punto de venta y tipo', async () => {
    const { accessToken, tenantId, payment } = await setupTenantWithPayment();
    const issuerA = await createIssuer(accessToken, '20-30111222-0', 'Emisor Uno');
    const issuerB = await createIssuer(accessToken, '27-29333444-2', 'Emisor Dos');

    const fromA = await emit(accessToken, issuerA, payment.id).expect(201);
    const fromB = await emit(accessToken, issuerB, payment.id).expect(201);

    expect(fromA.body.numero).toBe(1);
    expect(fromB.body.numero).toBe(1);

    const stored = await prisma.baseClient.comprobante.count({
      where: { tenantId, puntoDeVenta: 1, cbteTipo: FACTURA_C, numero: 1 },
    });
    expect(stored).toBe(2);
  });

  // ─── 4. Idempotencia ──────────────────────────────────

  it('devuelve el mismo comprobante al repetir el clientRequestId', async () => {
    const { accessToken, tenantId, payment } = await setupTenantWithPayment();
    const issuerId = await createIssuer(accessToken, '20-30111222-0', 'Emisor Uno');
    const clientRequestId = randomUUID();

    const first = await emit(accessToken, issuerId, payment.id, clientRequestId).expect(201);
    const replay = await emit(accessToken, issuerId, payment.id, clientRequestId).expect(201);

    expect(replay.headers['x-idempotent-replay']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);
    expect(await prisma.baseClient.comprobante.count({ where: { tenantId } })).toBe(1);
  });

  // ─── 5. Aislamiento ───────────────────────────────────

  it('no permite emitir con el emisor de otra inmobiliaria', async () => {
    const tenantA = await setupTenantWithPayment();
    const issuerA = await createIssuer(tenantA.accessToken, '20-30111222-0', 'Emisor Uno');
    const tenantB = await setupTenantWithPayment();

    await emit(tenantB.accessToken, issuerA, tenantB.payment.id).expect(404);

    expect(await prisma.baseClient.comprobante.count()).toBe(0);
  });

  // ─── 6. Emisor obligatorio ────────────────────────────

  it('la base no admite un comprobante sin emisor', async () => {
    const { accessToken, payment } = await setupTenantWithPayment();
    const issuerId = await createIssuer(accessToken, '20-30111222-0', 'Emisor Uno');
    const res = await emit(accessToken, issuerId, payment.id).expect(201);

    // Con el emisor en nulo la fila quedaria fuera de la restriccion de
    // numeracion, porque en PostgreSQL dos nulos no chocan entre si.
    await expect(
      prisma.baseClient.$executeRawUnsafe(
        'UPDATE comprobantes SET "issuerId" = NULL WHERE id = $1',
        res.body.id,
      ),
    ).rejects.toThrow();
  });
});
