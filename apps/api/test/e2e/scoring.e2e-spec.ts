import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
  createTestUser,
  createUserDirect,
  createTenantDirect,
  loginUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { UserRole } from '@realfy/shared';

describe('Scoring (e2e)', () => {
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

  // ─── Config Endpoints ────────────────────────────────

  describe('GET /scoring/config', () => {
    it('returns default config with all weights = 20', async () => {
      const admin = await createTestUser(app);

      const res = await request(app.getHttpServer())
        .get('/api/scoring/config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.guaranteeWeight).toBe(20);
      expect(res.body.jobStabilityWeight).toBe(20);
      expect(res.body.referencesWeight).toBe(20);
      expect(res.body.paymentHistoryWeight).toBe(20);
      expect(res.body.manualRatingWeight).toBe(20);
      expect(res.body.tenantId).toBe(admin.user.tenantId);
    });
  });

  describe('PATCH /scoring/config', () => {
    it('updates weights and returns updated config', async () => {
      const admin = await createTestUser(app);

      const res = await request(app.getHttpServer())
        .patch('/api/scoring/config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          guaranteeWeight: 30,
          jobStabilityWeight: 25,
          referencesWeight: 15,
          paymentHistoryWeight: 20,
          manualRatingWeight: 10,
        })
        .expect(200);

      expect(res.body.guaranteeWeight).toBe(30);
      expect(res.body.jobStabilityWeight).toBe(25);
      expect(res.body.referencesWeight).toBe(15);
      expect(res.body.paymentHistoryWeight).toBe(20);
      expect(res.body.manualRatingWeight).toBe(10);
    });

    it('partial update only changes provided weights', async () => {
      const admin = await createTestUser(app);

      // First get default config
      await request(app.getHttpServer())
        .get('/api/scoring/config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      // Partial update
      const res = await request(app.getHttpServer())
        .patch('/api/scoring/config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ guaranteeWeight: 50 })
        .expect(200);

      expect(res.body.guaranteeWeight).toBe(50);
      expect(res.body.jobStabilityWeight).toBe(20); // unchanged
    });
  });

  // ─── Person Score Endpoints ──────────────────────────

  describe('GET /scoring/persons/:personId', () => {
    it('returns 404 when no score exists', async () => {
      const admin = await createTestUser(app);

      // Create a person
      const personRes = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ firstName: 'Juan', lastName: 'Pérez' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/scoring/persons/${personRes.body.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(404);

      expect(res.body.error).toBe('SCORE_NOT_FOUND');
    });
  });

  describe('PUT /scoring/persons/:personId', () => {
    it('creates score and computes totalScore correctly', async () => {
      const admin = await createTestUser(app);

      // Create a person
      const personRes = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ firstName: 'Juan', lastName: 'Pérez' })
        .expect(201);

      const personId = personRes.body.id;

      // Upsert score — default weights all 20, so weighted avg = simple avg
      const res = await request(app.getHttpServer())
        .put(`/api/scoring/persons/${personId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          guaranteeScore: 80,
          jobStabilityScore: 60,
          referencesScore: 70,
          paymentHistoryScore: 90,
          manualRating: 50,
        })
        .expect(200);

      // With equal weights (20 each), totalScore = (80+60+70+90+50)/5 = 70
      expect(Number(res.body.totalScore)).toBeCloseTo(70, 1);
      expect(res.body.guaranteeScore).toBe(80);
      expect(res.body.jobStabilityScore).toBe(60);
      expect(res.body.referencesScore).toBe(70);
      expect(res.body.paymentHistoryScore).toBe(90);
      expect(res.body.manualRating).toBe(50);
      expect(res.body.scoredBy).toBeDefined();
      expect(res.body.scoredBy.firstName).toBeDefined();
    });

    it('updates score on second PUT (upsert behavior)', async () => {
      const admin = await createTestUser(app);

      const personRes = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ firstName: 'María', lastName: 'López' })
        .expect(201);

      const personId = personRes.body.id;

      // First score
      await request(app.getHttpServer())
        .put(`/api/scoring/persons/${personId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          guaranteeScore: 50,
          jobStabilityScore: 50,
          referencesScore: 50,
          paymentHistoryScore: 50,
          manualRating: 50,
        })
        .expect(200);

      // Update score
      const res = await request(app.getHttpServer())
        .put(`/api/scoring/persons/${personId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          guaranteeScore: 90,
          jobStabilityScore: 80,
          referencesScore: 70,
          paymentHistoryScore: 60,
          manualRating: 50,
          notes: 'Updated score',
        })
        .expect(200);

      // (90+80+70+60+50)/5 = 70
      expect(Number(res.body.totalScore)).toBeCloseTo(70, 1);
      expect(res.body.notes).toBe('Updated score');

      // Verify GET returns updated score
      const getRes = await request(app.getHttpServer())
        .get(`/api/scoring/persons/${personId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(Number(getRes.body.totalScore)).toBeCloseTo(70, 1);
      expect(getRes.body.notes).toBe('Updated score');
    });

    it('computes totalScore with custom weights', async () => {
      const admin = await createTestUser(app);

      // Set custom weights
      await request(app.getHttpServer())
        .patch('/api/scoring/config')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          guaranteeWeight: 40,
          jobStabilityWeight: 10,
          referencesWeight: 10,
          paymentHistoryWeight: 30,
          manualRatingWeight: 10,
        })
        .expect(200);

      const personRes = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ firstName: 'Carlos', lastName: 'García' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .put(`/api/scoring/persons/${personRes.body.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          guaranteeScore: 100,
          jobStabilityScore: 50,
          referencesScore: 50,
          paymentHistoryScore: 80,
          manualRating: 60,
        })
        .expect(200);

      // Weighted: (100*40 + 50*10 + 50*10 + 80*30 + 60*10) / (40+10+10+30+10)
      // = (4000 + 500 + 500 + 2400 + 600) / 100 = 8000 / 100 = 80
      expect(Number(res.body.totalScore)).toBeCloseTo(80, 1);
    });

    it('returns 404 for non-existent person', async () => {
      const admin = await createTestUser(app);

      const res = await request(app.getHttpServer())
        .put('/api/scoring/persons/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          guaranteeScore: 50,
          jobStabilityScore: 50,
          referencesScore: 50,
          paymentHistoryScore: 50,
          manualRating: 50,
        })
        .expect(404);

      expect(res.body.error).toBe('PERSON_NOT_FOUND');
    });
  });

  // ─── RBAC ────────────────────────────────────────────

  describe('RBAC', () => {
    it('Ventas user gets 403 on scoring endpoints', async () => {
      const admin = await createTestUser(app);

      // Create a Ventas user in the same tenant
      const ventasUser = await createUserDirect(prisma, admin.user.tenantId, {
        email: `ventas-${Date.now()}@test.com`,
        password: 'Test1234!',
        role: UserRole.Ventas,
      });

      const ventasLogin = await loginUser(app, ventasUser.email, 'Test1234!');

      // GET config → 403
      await request(app.getHttpServer())
        .get('/api/scoring/config')
        .set('Authorization', `Bearer ${ventasLogin.accessToken}`)
        .expect(403);

      // PATCH config → 403
      await request(app.getHttpServer())
        .patch('/api/scoring/config')
        .set('Authorization', `Bearer ${ventasLogin.accessToken}`)
        .send({ guaranteeWeight: 50 })
        .expect(403);

      // Create a person first (as admin)
      const personRes = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ firstName: 'Test', lastName: 'Person' })
        .expect(201);

      // GET person score → 403
      await request(app.getHttpServer())
        .get(`/api/scoring/persons/${personRes.body.id}`)
        .set('Authorization', `Bearer ${ventasLogin.accessToken}`)
        .expect(403);

      // PUT person score → 403
      await request(app.getHttpServer())
        .put(`/api/scoring/persons/${personRes.body.id}`)
        .set('Authorization', `Bearer ${ventasLogin.accessToken}`)
        .send({
          guaranteeScore: 50,
          jobStabilityScore: 50,
          referencesScore: 50,
          paymentHistoryScore: 50,
          manualRating: 50,
        })
        .expect(403);
    });

    it('Gerente user can access scoring endpoints', async () => {
      const admin = await createTestUser(app);

      const gerenteUser = await createUserDirect(prisma, admin.user.tenantId, {
        email: `gerente-${Date.now()}@test.com`,
        password: 'Test1234!',
        role: UserRole.Gerente,
      });

      const gerenteLogin = await loginUser(app, gerenteUser.email, 'Test1234!');

      // GET config → 200
      await request(app.getHttpServer())
        .get('/api/scoring/config')
        .set('Authorization', `Bearer ${gerenteLogin.accessToken}`)
        .expect(200);
    });
  });

  // ─── Tenant Isolation ────────────────────────────────

  describe('Tenant isolation', () => {
    it('second tenant cannot see first tenant scores', async () => {
      // Tenant 1
      const admin1 = await createTestUser(app, { email: `admin1-${Date.now()}@test.com` });

      const person1Res = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${admin1.accessToken}`)
        .send({ firstName: 'Tenant1', lastName: 'Person' })
        .expect(201);

      await request(app.getHttpServer())
        .put(`/api/scoring/persons/${person1Res.body.id}`)
        .set('Authorization', `Bearer ${admin1.accessToken}`)
        .send({
          guaranteeScore: 80,
          jobStabilityScore: 80,
          referencesScore: 80,
          paymentHistoryScore: 80,
          manualRating: 80,
        })
        .expect(200);

      // Tenant 2
      const admin2 = await createTestUser(app, { email: `admin2-${Date.now()}@test.com` });

      // Tenant 2 cannot access Tenant 1's person score (person doesn't exist in their tenant)
      await request(app.getHttpServer())
        .get(`/api/scoring/persons/${person1Res.body.id}`)
        .set('Authorization', `Bearer ${admin2.accessToken}`)
        .expect(404);

      // Tenant 2's config is separate
      const config2Res = await request(app.getHttpServer())
        .get('/api/scoring/config')
        .set('Authorization', `Bearer ${admin2.accessToken}`)
        .expect(200);

      // It should be a separate config with default weights
      expect(config2Res.body.guaranteeWeight).toBe(20);
      expect(config2Res.body.tenantId).toBe(admin2.user.tenantId);
      expect(config2Res.body.tenantId).not.toBe(admin1.user.tenantId);
    });
  });
});
