import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { UserRole, TenantTier } from '@realfy/shared';

/**
 * E2E test utilities — provides a real NestJS app + PostgreSQL test database
 * for integration testing the full HTTP → auth → tenant → Prisma → DB chain.
 */

let app: INestApplication;
let prisma: PrismaService;

/**
 * Bootstrap the NestJS test app once.
 * Reuses the same app instance across tests in a file.
 */
export async function setupTestApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  if (app) {
    return { app, prisma };
  }

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();

  prisma = moduleFixture.get(PrismaService);

  return { app, prisma };
}

/**
 * Clean up test data between tests.
 * Truncates all tables in dependency order.
 */
export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  // Order matters — delete children before parents

  // Ticket tables (delete attachments → comments → tickets → categories before other FK targets)
  await prisma.baseClient.ticketAttachment.deleteMany();
  await prisma.baseClient.ticketComment.deleteMany();
  await prisma.baseClient.ticket.deleteMany();
  await prisma.baseClient.ticketCategory.deleteMany();

  // S06 tables (Notification → ServicePayment → Service, before other FK targets)
  await prisma.baseClient.notification.deleteMany();
  await prisma.baseClient.servicePayment.deleteMany();
  await prisma.baseClient.service.deleteMany();

  // Rendition tables (delete before contracts/persons because of FK references)
  await prisma.baseClient.rendicionLineItem.deleteMany();
  await prisma.baseClient.ownerRendicion.deleteMany();
  await prisma.baseClient.contractCommission.deleteMany();

  // Fiscal tables (delete before comprobantes/issuers/tenants because of FK references)
  await prisma.baseClient.libroIvaExport.deleteMany();
  await prisma.baseClient.arcaRequestLog.deleteMany();
  await prisma.baseClient.arcaCertificateAccessLog.deleteMany();

  // Liquidacion tables (delete before contracts because of FK references)
  await prisma.baseClient.comprobante.deleteMany();
  await prisma.baseClient.payment.deleteMany();
  await prisma.baseClient.liquidacionLineItem.deleteMany();
  await prisma.baseClient.penalty.deleteMany();
  await prisma.baseClient.liquidacion.deleteMany();

  // Contract tables (delete before persons/properties because of FK references)
  await prisma.baseClient.contractClosureSummary.deleteMany();
  await prisma.baseClient.adjustmentSchedule.deleteMany();
  await prisma.baseClient.contractAdjustment.deleteMany();
  await prisma.baseClient.contractGuarantee.deleteMany();
  await prisma.baseClient.contractPerson.deleteMany();
  await prisma.baseClient.contract.deleteMany();
  await prisma.baseClient.indexData.deleteMany();

  // Property tables
  await prisma.baseClient.priceHistory.deleteMany();
  await prisma.baseClient.propertyMedia.deleteMany();
  await prisma.baseClient.propertyOperation.deleteMany();

  // Valuation tables (delete before properties because of FK references)
  await prisma.baseClient.propertyValuation.deleteMany();

  // Lead interaction/visit tables (delete before leads because of FK references)
  await prisma.baseClient.leadInteraction.deleteMany();
  await prisma.baseClient.leadVisit.deleteMany();

  // Email template tables (no FK dependencies)
  await prisma.baseClient.emailTemplate.deleteMany();

  // Contract template tables (no FK dependencies)
  await prisma.baseClient.contractTemplate.deleteMany();

  // Lead tables (delete before persons, properties, pipelines, pipeline stages, users)
  await prisma.baseClient.lead.deleteMany();

  await prisma.baseClient.property.deleteMany();

  // Scoring tables (delete before persons and users because of FK references)
  await prisma.baseClient.tenantScore.deleteMany();
  await prisma.baseClient.tenantScoreConfig.deleteMany();

  // Portal tables (delete before persons because of FK references)
  await prisma.baseClient.portalRefreshToken.deleteMany();
  await prisma.baseClient.portalInvitation.deleteMany();
  await prisma.baseClient.inquilinoCredential.deleteMany();

  // Person tables
  await prisma.baseClient.personDocument.deleteMany();
  await prisma.baseClient.personRoleAssignment.deleteMany();
  await prisma.baseClient.providerProfile.deleteMany();
  await prisma.baseClient.person.deleteMany();

  // Pipeline tables (delete stages before pipelines)
  await prisma.baseClient.pipelineStage.deleteMany();
  await prisma.baseClient.pipeline.deleteMany();

  await prisma.baseClient.arcaPuntoDeVenta.deleteMany();
  await prisma.baseClient.arcaIssuer.deleteMany();
  await prisma.baseClient.arcaCertificate.deleteMany();
  await prisma.baseClient.reportSchedule.deleteMany();
  await prisma.baseClient.auditLog.deleteMany();
  await prisma.baseClient.userInvitation.deleteMany();
  await prisma.baseClient.refreshToken.deleteMany();
  await prisma.baseClient.user.deleteMany();
  await prisma.baseClient.tenant.deleteMany();
}

/**
 * Tear down the test app.
 */
export async function teardownTestApp(): Promise<void> {
  if (app) {
    await app.close();
    app = undefined as any;
    prisma = undefined as any;
  }
}

/**
 * Register a new user + tenant via the auth endpoint.
 * Returns the JWT tokens and user/tenant data.
 */
export async function registerUser(
  app: INestApplication,
  data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  },
): Promise<{
  accessToken: string;
  refreshToken: string;
  user: any;
}> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send(data)
    .expect(201);

  return {
    accessToken: res.body.tokens.accessToken,
    refreshToken: res.body.tokens.refreshToken,
    user: res.body.user,
  };
}

/**
 * Login an existing user via the auth endpoint.
 */
export async function loginUser(
  app: INestApplication,
  email: string,
  password: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  user: any;
}> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);

  return {
    accessToken: res.body.tokens.accessToken,
    refreshToken: res.body.tokens.refreshToken,
    user: res.body.user,
  };
}

/**
 * Create a tenant directly in the database for test setup.
 * Useful when you need a tenant without going through the auth flow.
 */
export async function createTenantDirect(
  prisma: PrismaService,
  overrides: Partial<{
    name: string;
    cuit: string;
    province: string;
    timezone: string;
    currency: string;
    tier: string;
  }> = {},
) {
  return prisma.baseClient.tenant.create({
    data: {
      name: overrides.name ?? 'Test Inmobiliaria',
      cuit: overrides.cuit ?? `20-${String(Date.now()).slice(-8)}-5`,
      province: overrides.province ?? 'CABA',
      timezone: overrides.timezone ?? 'America/Buenos_Aires',
      currency: (overrides.currency ?? 'ARS') as any,
      tier: (overrides.tier ?? TenantTier.Professional) as any,
    },
  });
}

/**
 * Create a user directly in the database for test setup.
 * Returns the user record (no JWT).
 */
export async function createUserDirect(
  prisma: PrismaService,
  tenantId: string,
  overrides: Partial<{
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    isActive: boolean;
  }> = {},
) {
  const bcrypt = await import('bcrypt');
  const passwordHash = await bcrypt.hash(overrides.password ?? 'Test1234!', 12);

  return prisma.baseClient.user.create({
    data: {
      email: overrides.email ?? `user-${Date.now()}@test.com`,
      passwordHash,
      firstName: overrides.firstName ?? 'Test',
      lastName: overrides.lastName ?? 'User',
      role: overrides.role ?? UserRole.Admin,
      tenantId,
      isActive: overrides.isActive ?? true,
    },
  });
}

/**
 * Create a test user via register, then login to get JWT.
 * Shortcut for the common pattern of needing an authenticated user.
 */
export async function createTestUser(
  app: INestApplication,
  overrides: Partial<{
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }> = {},
): Promise<{
  accessToken: string;
  refreshToken: string;
  user: any;
}> {
  const email = overrides.email ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`;
  const password = overrides.password ?? 'Test1234!';

  return registerUser(app, {
    email,
    password,
    firstName: overrides.firstName ?? 'Test',
    lastName: overrides.lastName ?? 'User',
  });
}

/**
 * Create a portal invitation for a person via the staff API.
 * Returns the invitation data including the token.
 */
export async function createPortalInvitation(
  app: INestApplication,
  staffToken: string,
  personId: string,
): Promise<{ id: string; personId: string; token: string; expiresAt: string }> {
  const res = await request(app.getHttpServer())
    .post(`/api/persons/${personId}/portal-invite`)
    .set('Authorization', `Bearer ${staffToken}`)
    .expect(201);

  return res.body;
}

/**
 * Set a portal password using an invitation token.
 * Returns person data + tokens.
 */
export async function portalSetPassword(
  app: INestApplication,
  invitationToken: string,
  password: string,
): Promise<{ person: any; tokens: { accessToken: string; refreshToken: string } }> {
  const res = await request(app.getHttpServer())
    .post('/api/portal/auth/set-password')
    .send({ token: invitationToken, password })
    .expect(200);

  return res.body;
}

/**
 * Login as a portal user (inquilino).
 * Returns person data + tokens.
 */
export async function portalLogin(
  app: INestApplication,
  email: string,
  password: string,
): Promise<{ person: any; tokens: { accessToken: string; refreshToken: string } }> {
  const res = await request(app.getHttpServer())
    .post('/api/portal/auth/login')
    .send({ email, password })
    .expect(200);

  return res.body;
}

export { request };
