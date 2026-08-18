import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  createTestUser,
  createUserDirect,
  loginUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  UserRole,
  LeadSource,
  LeadStatus,
  PersonRole,
} from '@realfy/shared';

describe('Leads (e2e)', () => {
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

  // ─── Helpers ──────────────────────────────────────────

  /** Create an admin user and return token + the first pipeline + first stage. */
  async function setupLeadContext(emailPrefix = 'lead-test') {
    const admin = await createTestUser(app, { email: `${emailPrefix}-${Date.now()}@test.com` });

    // Get pipelines (seeded on registration)
    const pipelinesRes = await request(app.getHttpServer())
      .get('/api/pipelines')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    const pipeline = pipelinesRes.body[0];
    const firstStage = pipeline.stages[0];
    const secondStage = pipeline.stages[1];

    return { admin, pipeline, firstStage, secondStage };
  }

  /** Create a lead with person auto-creation via the API. */
  async function createLeadViaApi(
    token: string,
    pipelineId: string,
    overrides: Record<string, any> = {},
  ) {
    const payload = {
      firstName: 'Test',
      lastName: 'Lead',
      email: `lead-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
      pipelineId,
      source: LeadSource.WebInquiry,
      ...overrides,
    };

    const res = await request(app.getHttpServer())
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(201);

    return res.body;
  }

  // ─── CRUD Operations ─────────────────────────────────

  describe('Lead CRUD', () => {
    it('POST /leads creates a lead with person auto-creation', async () => {
      const { admin, pipeline, firstStage } = await setupLeadContext('crud-create');

      const res = await request(app.getHttpServer())
        .post('/api/leads')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          firstName: 'Juan',
          lastName: 'Pérez',
          email: 'juan@example.com',
          phone: '+5491155551234',
          pipelineId: pipeline.id,
          source: LeadSource.WebInquiry,
          notes: 'Interested in 2BR apartment',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.source).toBe(LeadSource.WebInquiry);
      expect(res.body.status).toBe(LeadStatus.Nuevo);
      expect(res.body.pipelineId).toBe(pipeline.id);
      expect(res.body.currentStageId).toBe(firstStage.id);
      expect(res.body.notes).toBe('Interested in 2BR apartment');
      // Person should be auto-created
      expect(res.body.person).toBeDefined();
      expect(res.body.person.firstName).toBe('Juan');
      expect(res.body.person.lastName).toBe('Pérez');
    });

    it('POST /leads links to existing person by personId', async () => {
      const { admin, pipeline } = await setupLeadContext('crud-personid');

      // Create a person first
      const personRes = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ firstName: 'Existing', lastName: 'Person', email: 'existing@test.com' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/leads')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          personId: personRes.body.id,
          pipelineId: pipeline.id,
          source: LeadSource.PhoneCall,
        })
        .expect(201);

      expect(res.body.personId).toBe(personRes.body.id);
    });

    it('POST /leads auto-links to existing person by matching email', async () => {
      const { admin, pipeline } = await setupLeadContext('crud-email-match');

      // Create a person with a known email
      await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ firstName: 'Matching', lastName: 'Email', email: 'match@test.com' })
        .expect(201);

      // Create lead with same email — should link, not create new person
      const res = await request(app.getHttpServer())
        .post('/api/leads')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          firstName: 'Matching',
          lastName: 'Email',
          email: 'match@test.com',
          pipelineId: pipeline.id,
          source: LeadSource.Email,
        })
        .expect(201);

      // Should have linked to the existing person (not created a new one)
      const persons = await prisma.baseClient.person.findMany({
        where: { email: 'match@test.com' },
      });
      expect(persons).toHaveLength(1);
      expect(res.body.personId).toBe(persons[0].id);
    });

    it('GET /leads/:id returns lead detail', async () => {
      const { admin, pipeline } = await setupLeadContext('crud-detail');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      const res = await request(app.getHttpServer())
        .get(`/api/leads/${lead.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(lead.id);
      expect(res.body.person).toBeDefined();
      expect(res.body.pipeline).toBeDefined();
      expect(res.body.currentStage).toBeDefined();
    });

    it('GET /leads/:id returns 404 for non-existent lead', async () => {
      const { admin } = await setupLeadContext('crud-404');

      const res = await request(app.getHttpServer())
        .get('/api/leads/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(404);

      expect(res.body.error).toBe('LEAD_NOT_FOUND');
    });

    it('PATCH /leads/:id updates lead notes', async () => {
      const { admin, pipeline } = await setupLeadContext('crud-update');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${lead.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ notes: 'Updated notes' })
        .expect(200);

      expect(res.body.notes).toBe('Updated notes');
    });

    it('DELETE /leads/:id soft-deletes lead', async () => {
      const { admin, pipeline } = await setupLeadContext('crud-delete');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      await request(app.getHttpServer())
        .delete(`/api/leads/${lead.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      // Lead should still exist but be inactive
      const raw = await prisma.baseClient.lead.findUnique({ where: { id: lead.id } });
      expect(raw).toBeDefined();
      expect(raw!.isActive).toBe(false);
    });
  });

  // ─── Filtering & Pagination ───────────────────────────

  describe('Filtering & Pagination', () => {
    it('GET /leads returns paginated list', async () => {
      const { admin, pipeline } = await setupLeadContext('filter-paginate');

      // Create 3 leads
      for (let i = 0; i < 3; i++) {
        await createLeadViaApi(admin.accessToken, pipeline.id);
      }

      const res = await request(app.getHttpServer())
        .get('/api/leads?page=1&limit=2')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(3);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(2);
      expect(res.body.totalPages).toBe(2);
    });

    it('filters by pipelineId', async () => {
      const { admin, pipeline } = await setupLeadContext('filter-pipeline');
      await createLeadViaApi(admin.accessToken, pipeline.id);

      // Get the other pipeline
      const pipelines = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      const otherPipeline = pipelines.body.find((p: any) => p.id !== pipeline.id);
      await createLeadViaApi(admin.accessToken, otherPipeline.id);

      const res = await request(app.getHttpServer())
        .get(`/api/leads?pipelineId=${pipeline.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].pipelineId).toBe(pipeline.id);
    });

    it('filters by source', async () => {
      const { admin, pipeline } = await setupLeadContext('filter-source');
      await createLeadViaApi(admin.accessToken, pipeline.id, { source: LeadSource.WebInquiry });
      await createLeadViaApi(admin.accessToken, pipeline.id, { source: LeadSource.PhoneCall });

      const res = await request(app.getHttpServer())
        .get(`/api/leads?source=${LeadSource.PhoneCall}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].source).toBe(LeadSource.PhoneCall);
    });

    it('filters by status', async () => {
      const { admin, pipeline } = await setupLeadContext('filter-status');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      // Mark one as lost
      await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/lose`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ lostReason: 'No budget' })
        .expect(200);

      // Create a second that stays Nuevo
      await createLeadViaApi(admin.accessToken, pipeline.id);

      const res = await request(app.getHttpServer())
        .get(`/api/leads?status=${LeadStatus.Perdido}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].status).toBe(LeadStatus.Perdido);
    });

    it('filters by search (person name)', async () => {
      const { admin, pipeline } = await setupLeadContext('filter-search');
      await createLeadViaApi(admin.accessToken, pipeline.id, {
        firstName: 'María',
        lastName: 'González',
        email: 'maria@test.com',
      });
      await createLeadViaApi(admin.accessToken, pipeline.id, {
        firstName: 'Carlos',
        lastName: 'López',
        email: 'carlos@test.com',
      });

      const res = await request(app.getHttpServer())
        .get('/api/leads?search=María')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].person.firstName).toBe('María');
    });

    it('filters by assignedToUserId', async () => {
      const { admin, pipeline } = await setupLeadContext('filter-assignee');

      // Create a ventas user to be an assignee
      const ventasUser = await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas-assignee@test.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });

      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      // Assign the lead
      await request(app.getHttpServer())
        .patch(`/api/leads/${lead.id}/assign`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ assignedToUserId: ventasUser.id })
        .expect(200);

      // Create another unassigned lead (created by admin who doesn't get round-robin)
      // Delete the ventas user first to prevent auto-assignment
      await prisma.baseClient.user.update({
        where: { id: ventasUser.id },
        data: { role: UserRole.Lectura },
      });
      await createLeadViaApi(admin.accessToken, pipeline.id);
      // Restore ventas role
      await prisma.baseClient.user.update({
        where: { id: ventasUser.id },
        data: { role: UserRole.Ventas },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/leads?assignedToUserId=${ventasUser.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].assignedToUserId).toBe(ventasUser.id);
    });
  });

  // ─── Round-Robin Assignment ───────────────────────────

  describe('Round-Robin Assignment', () => {
    it('auto-assigns to least-loaded Ventas user when no assignee specified', async () => {
      const { admin, pipeline } = await setupLeadContext('rr-assign');

      // Create 2 Ventas users
      const ventas1 = await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas1-rr@test.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });
      const ventas2 = await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas2-rr@test.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });

      // Create 2 leads — should distribute between ventas users
      const lead1 = await createLeadViaApi(admin.accessToken, pipeline.id);
      const lead2 = await createLeadViaApi(admin.accessToken, pipeline.id);

      const assignees = new Set([lead1.assignedToUserId, lead2.assignedToUserId]);
      // Both ventas users should have been assigned
      expect(assignees.size).toBe(2);
      expect(assignees).toContain(ventas1.id);
      expect(assignees).toContain(ventas2.id);
    });

    it('leaves unassigned when no Ventas users exist', async () => {
      const { admin, pipeline } = await setupLeadContext('rr-none');

      // Admin has no Ventas users in their tenant
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);
      expect(lead.assignedToUserId).toBeNull();
    });
  });

  // ─── Stage Movement ───────────────────────────────────

  describe('Stage Movement', () => {
    it('PATCH /leads/:id/stage moves lead to a new stage in same pipeline', async () => {
      const { admin, pipeline, firstStage, secondStage } = await setupLeadContext('stage-move');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      expect(lead.currentStageId).toBe(firstStage.id);

      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${lead.id}/stage`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ newStageId: secondStage.id })
        .expect(200);

      expect(res.body.currentStageId).toBe(secondStage.id);
    });

    it('rejects cross-pipeline stage move', async () => {
      const { admin, pipeline } = await setupLeadContext('stage-cross');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      // Get a stage from the other pipeline
      const pipelines = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      const otherPipeline = pipelines.body.find((p: any) => p.id !== pipeline.id);

      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${lead.id}/stage`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ newStageId: otherPipeline.stages[0].id })
        .expect(400);

      expect(res.body.error).toBe('STAGE_NOT_IN_PIPELINE');
    });
  });

  // ─── Manual Assignment ────────────────────────────────

  describe('Manual Assignment', () => {
    it('PATCH /leads/:id/assign reassigns to a specific user', async () => {
      const { admin, pipeline } = await setupLeadContext('manual-assign');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      const ventasUser = await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas-manual@test.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${lead.id}/assign`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ assignedToUserId: ventasUser.id })
        .expect(200);

      expect(res.body.assignedToUserId).toBe(ventasUser.id);
    });
  });

  // ─── Conversion ───────────────────────────────────────

  describe('Lead Conversion', () => {
    it('POST /leads/:id/convert converts to Inquilino', async () => {
      const { admin, pipeline } = await setupLeadContext('convert-ok');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/convert`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetRole: PersonRole.Inquilino })
        .expect(200);

      expect(res.body.status).toBe(LeadStatus.Convertido);
      expect(res.body.convertedAt).toBeDefined();

      // Person should now have Inquilino role
      const roles = await prisma.baseClient.personRoleAssignment.findMany({
        where: { personId: lead.personId },
      });
      const roleNames = roles.map((r: any) => r.role);
      expect(roleNames).toContain(PersonRole.Inquilino);
    });

    it('rejects converting an already-converted lead', async () => {
      const { admin, pipeline } = await setupLeadContext('convert-dup');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/convert`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetRole: PersonRole.Inquilino })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/convert`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetRole: PersonRole.Comprador })
        .expect(409);

      expect(res.body.error).toBe('LEAD_ALREADY_CONVERTED');
    });

    it('rejects converting a lost lead', async () => {
      const { admin, pipeline } = await setupLeadContext('convert-lost');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      // Mark as lost first
      await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/lose`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ lostReason: 'Not interested' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/convert`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetRole: PersonRole.Inquilino })
        .expect(409);

      expect(res.body.error).toBe('LEAD_ALREADY_LOST');
    });
  });

  // ─── Lost Lead ────────────────────────────────────────

  describe('Lead Lost', () => {
    it('POST /leads/:id/lose marks lead as lost with reason', async () => {
      const { admin, pipeline } = await setupLeadContext('lose-ok');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/lose`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ lostReason: 'Budget too low' })
        .expect(200);

      expect(res.body.status).toBe(LeadStatus.Perdido);
      expect(res.body.lostReason).toBe('Budget too low');
      expect(res.body.lostAt).toBeDefined();
    });

    it('rejects losing an already-lost lead', async () => {
      const { admin, pipeline } = await setupLeadContext('lose-dup');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/lose`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ lostReason: 'No budget' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/lose`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ lostReason: 'Changed mind' })
        .expect(409);

      expect(res.body.error).toBe('LEAD_ALREADY_LOST');
    });

    it('rejects losing without a reason', async () => {
      const { admin, pipeline } = await setupLeadContext('lose-noreason');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/lose`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({})
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('rejects losing a converted lead', async () => {
      const { admin, pipeline } = await setupLeadContext('lose-converted');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      // Convert first
      await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/convert`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetRole: PersonRole.Inquilino })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/lose`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ lostReason: 'Lost anyway' })
        .expect(409);

      expect(res.body.error).toBe('LEAD_ALREADY_CONVERTED');
    });
  });

  // ─── RBAC ─────────────────────────────────────────────

  describe('RBAC', () => {
    it('Ventas user can create and read leads', async () => {
      const admin = await createTestUser(app, { email: `rbac-ventas-${Date.now()}@test.com` });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas-rbac@test.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });
      const ventas = await loginUser(app, 'ventas-rbac@test.com', 'Password123!');

      // Get a pipeline for creating
      const pipelines = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .expect(200);

      // Create a lead
      const createRes = await request(app.getHttpServer())
        .post('/api/leads')
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send({
          firstName: 'Test',
          lastName: 'RbacLead',
          email: 'rbac-lead@test.com',
          pipelineId: pipelines.body[0].id,
          source: LeadSource.WalkIn,
        })
        .expect(201);

      // Read leads
      const listRes = await request(app.getHttpServer())
        .get('/api/leads')
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .expect(200);

      expect(listRes.body.items).toHaveLength(1);
    });

    it('Lectura user can read but cannot create leads (403)', async () => {
      const admin = await createTestUser(app, { email: `rbac-lectura-${Date.now()}@test.com` });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura-rbac@test.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });
      const lectura = await loginUser(app, 'lectura-rbac@test.com', 'Password123!');

      // Can read
      await request(app.getHttpServer())
        .get('/api/leads')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(200);

      // Get a pipeline
      const pipelines = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(200);

      // Cannot create
      await request(app.getHttpServer())
        .post('/api/leads')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({
          firstName: 'Hacked',
          lastName: 'Lead',
          email: 'hacked@test.com',
          pipelineId: pipelines.body[0].id,
          source: LeadSource.Other,
        })
        .expect(403);
    });
  });

  // ─── Tenant Isolation ─────────────────────────────────

  describe('Tenant Isolation', () => {
    it('leads from tenant A are not visible to tenant B', async () => {
      const adminA = await createTestUser(app, { email: `tenant-a-${Date.now()}@test.com` });
      const adminB = await createTestUser(app, { email: `tenant-b-${Date.now()}@test.com` });

      // Get pipeline for tenant A
      const pipelinesA = await request(app.getHttpServer())
        .get('/api/pipelines')
        .set('Authorization', `Bearer ${adminA.accessToken}`)
        .expect(200);

      // Create lead in tenant A
      const leadA = await createLeadViaApi(adminA.accessToken, pipelinesA.body[0].id);

      // Tenant B should not see tenant A's leads
      const resB = await request(app.getHttpServer())
        .get('/api/leads')
        .set('Authorization', `Bearer ${adminB.accessToken}`)
        .expect(200);

      expect(resB.body.items).toHaveLength(0);

      // Tenant B cannot access tenant A's lead by ID
      await request(app.getHttpServer())
        .get(`/api/leads/${leadA.id}`)
        .set('Authorization', `Bearer ${adminB.accessToken}`)
        .expect(404);
    });
  });

  // ─── Validation ───────────────────────────────────────

  describe('Validation', () => {
    it('POST /leads with neither personId nor contact info returns 400', async () => {
      const { admin, pipeline } = await setupLeadContext('val-noperson');

      const res = await request(app.getHttpServer())
        .post('/api/leads')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          pipelineId: pipeline.id,
          source: LeadSource.WebInquiry,
        })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('POST /leads with invalid source returns 400', async () => {
      const { admin, pipeline } = await setupLeadContext('val-badsource');

      const res = await request(app.getHttpServer())
        .post('/api/leads')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          firstName: 'Test',
          lastName: 'Lead',
          email: 'test@test.com',
          pipelineId: pipeline.id,
          source: 'InvalidSource',
        })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.details).toBeDefined();
    });

    it('POST /leads/:id/convert with invalid targetRole returns 400', async () => {
      const { admin, pipeline } = await setupLeadContext('val-badconvert');
      const lead = await createLeadViaApi(admin.accessToken, pipeline.id);

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/convert`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetRole: 'InvalidRole' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });
});
