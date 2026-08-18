import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
  createTestUser,
  createUserDirect,
  loginUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { UserRole, PipelineType } from '@realfy/shared';

describe('Pipelines (e2e)', () => {
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

  // ─── Default Seeding ─────────────────────────────────

  describe('Default Pipeline Seeding', () => {
    it('registration seeds 2 default pipelines with 11 stages each', async () => {
      const user = await createTestUser(app);

      const res = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body).toHaveLength(2);

      const alquiler = res.body.find((p: any) => p.type === PipelineType.Alquiler);
      const venta = res.body.find((p: any) => p.type === PipelineType.Venta);

      expect(alquiler).toBeDefined();
      expect(alquiler.stages).toHaveLength(11);
      expect(alquiler.name).toBe('Pipeline Alquiler');
      expect(alquiler.isActive).toBe(true);
      // Stages should be ordered by sortOrder
      expect(alquiler.stages[0].name).toBe('Consulta nueva');
      expect(alquiler.stages[0].sortOrder).toBe(0);
      expect(alquiler.stages[10].name).toBe('Alquilado');
      expect(alquiler.stages[10].sortOrder).toBe(10);

      expect(venta).toBeDefined();
      expect(venta.stages).toHaveLength(11);
      expect(venta.name).toBe('Pipeline Venta');
      expect(venta.stages[0].name).toBe('Consulta nueva');
      expect(venta.stages[10].name).toBe('Vendido');
    });

    it('seeded stages have correct staleDays values', async () => {
      const user = await createTestUser(app);

      const res = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const alquiler = res.body.find((p: any) => p.type === PipelineType.Alquiler);

      // First stage: Consulta nueva → staleDays=2
      expect(alquiler.stages[0].staleDays).toBe(2);
      // Terminal stage: Alquilado → staleDays=null
      expect(alquiler.stages[10].staleDays).toBeNull();
      // All stages should be marked as default
      expect(alquiler.stages.every((s: any) => s.isDefault === true)).toBe(true);
    });
  });

  // ─── Pipeline CRUD ────────────────────────────────────

  describe('Pipeline CRUD', () => {
    it('GET /pipelines/:id returns a single pipeline with stages', async () => {
      const user = await createTestUser(app);

      const listRes = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const pipelineId = listRes.body[0].id;

      const res = await request(app.getHttpServer())
        .get(`/api/pipelines/${pipelineId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(pipelineId);
      expect(res.body.stages).toBeDefined();
      expect(res.body.stages.length).toBeGreaterThan(0);
    });

    it('PATCH /pipelines/:id renames a pipeline', async () => {
      const user = await createTestUser(app);

      const listRes = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const pipelineId = listRes.body[0].id;

      const res = await request(app.getHttpServer())
        .patch(`/api/pipelines/${pipelineId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Mi Pipeline Personalizado' })
        .expect(200);

      expect(res.body.name).toBe('Mi Pipeline Personalizado');
    });

    it('DELETE /pipelines/:id removes a pipeline and its stages', async () => {
      const user = await createTestUser(app);

      const listRes = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const pipelineId = listRes.body[0].id;

      await request(app.getHttpServer())
        .delete(`/api/pipelines/${pipelineId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      // Should be gone
      await request(app.getHttpServer())
        .get(`/api/pipelines/${pipelineId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });

    it('GET /pipelines/:id returns 404 for non-existent pipeline', async () => {
      const user = await createTestUser(app);

      await request(app.getHttpServer())
        .get('/api/pipelines/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });
  });

  // ─── Stage CRUD ───────────────────────────────────────

  describe('Stage CRUD', () => {
    it('POST /pipelines/:id/stages adds a custom stage', async () => {
      const user = await createTestUser(app);

      const listRes = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const pipelineId = listRes.body[0].id;

      const res = await request(app.getHttpServer())
        .post(`/api/pipelines/${pipelineId}/stages`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Custom Stage', sortOrder: 5, staleDays: 14 })
        .expect(201);

      expect(res.body.name).toBe('Custom Stage');
      expect(res.body.sortOrder).toBe(5);
      expect(res.body.staleDays).toBe(14);
      expect(res.body.isDefault).toBe(false);

      // Pipeline should now have 12 stages
      const pipelineRes = await request(app.getHttpServer())
        .get(`/api/pipelines/${pipelineId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(pipelineRes.body.stages).toHaveLength(12);
    });

    it('PATCH /pipelines/:pipelineId/stages/:stageId updates stage name and staleDays', async () => {
      const user = await createTestUser(app);

      const listRes = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const pipeline = listRes.body[0];
      const stageId = pipeline.stages[0].id;

      const res = await request(app.getHttpServer())
        .patch(`/api/pipelines/${pipeline.id}/stages/${stageId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Renamed Stage', staleDays: 99 })
        .expect(200);

      expect(res.body.name).toBe('Renamed Stage');
      expect(res.body.staleDays).toBe(99);
    });

    it('DELETE /pipelines/:pipelineId/stages/:stageId removes a stage and re-compacts order', async () => {
      const user = await createTestUser(app);

      const listRes = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const pipeline = listRes.body[0];
      const stageToDelete = pipeline.stages[1]; // delete second stage (sortOrder=1)

      await request(app.getHttpServer())
        .delete(`/api/pipelines/${pipeline.id}/stages/${stageToDelete.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      // Verify re-compaction: pipeline should have 10 stages with contiguous sortOrders
      const pipelineRes = await request(app.getHttpServer())
        .get(`/api/pipelines/${pipeline.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(pipelineRes.body.stages).toHaveLength(10);
      pipelineRes.body.stages.forEach((s: any, i: number) => {
        expect(s.sortOrder).toBe(i);
      });
    });

    it('staleDays configuration persists across reload', async () => {
      const user = await createTestUser(app);

      const listRes = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const pipeline = listRes.body[0];
      const stageId = pipeline.stages[2].id;

      // Update staleDays
      await request(app.getHttpServer())
        .patch(`/api/pipelines/${pipeline.id}/stages/${stageId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ staleDays: 42 })
        .expect(200);

      // Re-fetch and verify persistence
      const reloadRes = await request(app.getHttpServer())
        .get(`/api/pipelines/${pipeline.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const updatedStage = reloadRes.body.stages.find((s: any) => s.id === stageId);
      expect(updatedStage.staleDays).toBe(42);
    });
  });

  // ─── Reorder ──────────────────────────────────────────

  describe('Stage Reorder', () => {
    it('PATCH /pipelines/:id/stages/reorder changes sort order correctly', async () => {
      const user = await createTestUser(app);

      const listRes = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const pipeline = listRes.body[0];
      const stageIds = pipeline.stages.map((s: any) => s.id);

      // Reverse the order
      const reversedIds = [...stageIds].reverse();

      const res = await request(app.getHttpServer())
        .patch(`/api/pipelines/${pipeline.id}/stages/reorder`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ stageIds: reversedIds })
        .expect(200);

      // Verify the new order matches
      expect(res.body.stages).toHaveLength(11);
      res.body.stages.forEach((s: any, i: number) => {
        expect(s.id).toBe(reversedIds[i]);
        expect(s.sortOrder).toBe(i);
      });
    });

    it('reorder rejects invalid stage IDs', async () => {
      const user = await createTestUser(app);

      const listRes = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const pipelineId = listRes.body[0].id;

      const res = await request(app.getHttpServer())
        .patch(`/api/pipelines/${pipelineId}/stages/reorder`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ stageIds: ['00000000-0000-0000-0000-000000000000'] })
        .expect(400);

      expect(res.body.error).toBe('INVALID_STAGE_ID');
    });
  });

  // ─── Tenant Isolation ─────────────────────────────────

  describe('Tenant Isolation', () => {
    it('pipelines from tenant A are not visible to tenant B', async () => {
      const userA = await createTestUser(app, { email: 'tenanta@test.com' });
      const userB = await createTestUser(app, { email: 'tenantb@test.com' });

      // Tenant A should see their own pipelines
      const resA = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(resA.body).toHaveLength(2);

      // Tenant B should see their own pipelines (different IDs)
      const resB = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(resB.body).toHaveLength(2);

      // IDs should be different
      const idsA = resA.body.map((p: any) => p.id).sort();
      const idsB = resB.body.map((p: any) => p.id).sort();
      expect(idsA).not.toEqual(idsB);

      // Tenant B cannot access Tenant A's pipeline by ID
      await request(app.getHttpServer())
        .get(`/api/pipelines/${resA.body[0].id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });
  });

  // ─── RBAC ─────────────────────────────────────────────

  describe('RBAC', () => {
    it('Ventas role can read pipelines', async () => {
      const admin = await createTestUser(app, { email: 'admin@rbac-pipeline.com' });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas@rbac-pipeline.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });

      const ventas = await loginUser(app, 'ventas@rbac-pipeline.com', 'Password123!');

      const res = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .expect(200);

      expect(res.body).toHaveLength(2);
    });

    it('Ventas role cannot create pipelines (403)', async () => {
      const admin = await createTestUser(app, { email: 'admin@rbac-pipeline-create.com' });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas@rbac-pipeline-create.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });

      const ventas = await loginUser(app, 'ventas@rbac-pipeline-create.com', 'Password123!');

      await request(app.getHttpServer())
        .post('/api/pipelines')
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send({ type: PipelineType.Alquiler, name: 'Hacked Pipeline' })
        .expect(403);
    });

    it('Ventas role cannot delete pipelines (403)', async () => {
      const admin = await createTestUser(app, { email: 'admin@rbac-pipeline-delete.com' });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas@rbac-pipeline-delete.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });

      const ventas = await loginUser(app, 'ventas@rbac-pipeline-delete.com', 'Password123!');

      // Get pipeline ID
      const listRes = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/pipelines/${listRes.body[0].id}`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .expect(403);
    });

    it('Ventas role cannot add stages (403)', async () => {
      const admin = await createTestUser(app, { email: 'admin@rbac-stage-add.com' });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas@rbac-stage-add.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });

      const ventas = await loginUser(app, 'ventas@rbac-stage-add.com', 'Password123!');

      const listRes = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/pipelines/${listRes.body[0].id}/stages`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send({ name: 'Hacked Stage', sortOrder: 99 })
        .expect(403);
    });
  });

  // ─── Validation ───────────────────────────────────────

  describe('Validation', () => {
    it('POST /pipelines with invalid data returns 400 with details', async () => {
      const user = await createTestUser(app);

      const res = await request(app.getHttpServer())
        .post('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ type: 'InvalidType', name: '' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.details).toBeDefined();
    });

    it('POST /pipelines/:id/stages with invalid data returns 400', async () => {
      const user = await createTestUser(app);

      const listRes = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/api/pipelines/${listRes.body[0].id}/stages`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: '', sortOrder: -1 })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('PATCH /pipelines/:id/stages/reorder with empty array returns 400', async () => {
      const user = await createTestUser(app);

      const listRes = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/api/pipelines/${listRes.body[0].id}/stages/reorder`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ stageIds: [] })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });
});
