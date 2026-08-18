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
  InteractionType,
  VisitStatus,
  VisitOutcome,
} from '@realfy/shared';

describe('Interactions & Visits (e2e)', () => {
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

  /** Create an admin user and return token + pipeline + lead context. */
  async function setupInteractionContext(emailPrefix = 'int-test') {
    const admin = await createTestUser(app, { email: `${emailPrefix}-${Date.now()}@test.com` });

    // Get pipelines (seeded on registration)
    const pipelinesRes = await request(app.getHttpServer())
      .get('/api/pipelines')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    const pipeline = pipelinesRes.body[0];

    // Create a lead
    const leadRes = await request(app.getHttpServer())
      .post('/api/leads')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        firstName: 'Test',
        lastName: 'Lead',
        email: `lead-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
        pipelineId: pipeline.id,
        source: LeadSource.WebInquiry,
      })
      .expect(201);

    return { admin, pipeline, lead: leadRes.body };
  }

  // ─── Interaction CRUD ─────────────────────────────────

  describe('Interaction CRUD', () => {
    it('POST /leads/:leadId/interactions creates a Llamada interaction and updates lastContactAt', async () => {
      const { admin, lead } = await setupInteractionContext('int-create');

      // Record original lastContactAt (should be null for new lead)
      const leadBefore = await request(app.getHttpServer())
        .get(`/api/leads/${lead.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/interactions`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          type: InteractionType.Llamada,
          notes: 'Called about 2BR apartment',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.type).toBe(InteractionType.Llamada);
      expect(res.body.notes).toBe('Called about 2BR apartment');
      expect(res.body.leadId).toBe(lead.id);
      expect(res.body.occurredAt).toBeDefined();

      // Verify lastContactAt was updated on the lead
      const leadAfter = await request(app.getHttpServer())
        .get(`/api/leads/${lead.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(leadAfter.body.lastContactAt).toBeDefined();
      expect(new Date(leadAfter.body.lastContactAt).getTime()).toBeGreaterThan(
        Date.now() - 10000,
      ); // within last 10 seconds
    });

    it('POST /leads/:leadId/interactions creates a Nota with notes persisted', async () => {
      const { admin, lead } = await setupInteractionContext('int-nota');

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/interactions`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          type: InteractionType.Nota,
          notes: 'Client mentioned they want a balcony view',
        })
        .expect(201);

      expect(res.body.type).toBe(InteractionType.Nota);
      expect(res.body.notes).toBe('Client mentioned they want a balcony view');
    });

    it('GET /leads/:leadId/interactions returns chronological list with user info', async () => {
      const { admin, lead } = await setupInteractionContext('int-list');

      // Create two interactions with slight delay
      await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/interactions`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          type: InteractionType.Email,
          notes: 'First email',
          occurredAt: '2025-01-01T10:00:00Z',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/interactions`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          type: InteractionType.WhatsApp,
          notes: 'Follow-up WhatsApp',
          occurredAt: '2025-01-02T10:00:00Z',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/leads/${lead.id}/interactions`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
      // Ordered by occurredAt desc — WhatsApp should be first
      expect(res.body.items[0].type).toBe(InteractionType.WhatsApp);
      expect(res.body.items[1].type).toBe(InteractionType.Email);
    });
  });

  // ─── Visit CRUD ───────────────────────────────────────

  describe('Visit CRUD', () => {
    it('POST /leads/:leadId/visits creates a visit with status Programada', async () => {
      const { admin, lead } = await setupInteractionContext('visit-create');
      const scheduledAt = new Date(Date.now() + 86400000).toISOString(); // tomorrow

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/visits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          scheduledAt,
          notes: 'Visit to see 3BR apartment',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe(VisitStatus.Programada);
      expect(res.body.leadId).toBe(lead.id);
      expect(res.body.notes).toBe('Visit to see 3BR apartment');
    });

    it('GET /leads/:leadId/visits returns visits ordered by scheduledAt desc', async () => {
      const { admin, lead } = await setupInteractionContext('visit-list');

      const tomorrow = new Date(Date.now() + 86400000).toISOString();
      const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();

      await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/visits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ scheduledAt: tomorrow, notes: 'Tomorrow visit' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/visits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ scheduledAt: nextWeek, notes: 'Next week visit' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/leads/${lead.id}/visits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
      // Ordered by scheduledAt desc — next week should be first
      expect(res.body.items[0].notes).toBe('Next week visit');
      expect(res.body.items[1].notes).toBe('Tomorrow visit');
    });

    it('PATCH /leads/:leadId/visits/:visitId — status Completada auto-sets completedAt', async () => {
      const { admin, lead } = await setupInteractionContext('visit-complete');
      const scheduledAt = new Date(Date.now() + 86400000).toISOString();

      const createRes = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/visits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ scheduledAt })
        .expect(201);

      const visitId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${lead.id}/visits/${visitId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ status: VisitStatus.Completada })
        .expect(200);

      expect(res.body.status).toBe(VisitStatus.Completada);
      expect(res.body.completedAt).toBeDefined();
    });

    it('PATCH /leads/:leadId/visits/:visitId — set outcome to Interesado', async () => {
      const { admin, lead } = await setupInteractionContext('visit-outcome');
      const scheduledAt = new Date(Date.now() + 86400000).toISOString();

      const createRes = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/visits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ scheduledAt })
        .expect(201);

      const visitId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${lead.id}/visits/${visitId}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          status: VisitStatus.Completada,
          outcome: VisitOutcome.Interesado,
        })
        .expect(200);

      expect(res.body.outcome).toBe(VisitOutcome.Interesado);
      expect(res.body.status).toBe(VisitStatus.Completada);
    });
  });

  // ─── RBAC ─────────────────────────────────────────────

  describe('RBAC', () => {
    it('Lectura role cannot POST interaction (403)', async () => {
      const { admin, lead } = await setupInteractionContext('rbac-lectura');

      // Create Lectura user in same tenant
      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura-int@test.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });
      const lectura = await loginUser(app, 'lectura-int@test.com', 'Password123!');

      await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/interactions`)
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({ type: InteractionType.Llamada })
        .expect(403);
    });

    it('Lectura role can GET interactions (200)', async () => {
      const { admin, lead } = await setupInteractionContext('rbac-lectura-read');

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura-read@test.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });
      const lectura = await loginUser(app, 'lectura-read@test.com', 'Password123!');

      await request(app.getHttpServer())
        .get(`/api/leads/${lead.id}/interactions`)
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(200);
    });
  });

  // ─── Tenant Isolation ─────────────────────────────────

  describe('Tenant Isolation', () => {
    it('interaction from tenant A not visible to tenant B', async () => {
      const ctxA = await setupInteractionContext('tenant-a');
      const adminB = await createTestUser(app, { email: `tenant-b-${Date.now()}@test.com` });

      // Create interaction in tenant A
      await request(app.getHttpServer())
        .post(`/api/leads/${ctxA.lead.id}/interactions`)
        .set('Authorization', `Bearer ${ctxA.admin.accessToken}`)
        .send({ type: InteractionType.Llamada, notes: 'Tenant A call' })
        .expect(201);

      // Tenant B cannot access tenant A's lead interactions — lead not found (404)
      await request(app.getHttpServer())
        .get(`/api/leads/${ctxA.lead.id}/interactions`)
        .set('Authorization', `Bearer ${adminB.accessToken}`)
        .expect(404);
    });
  });

  // ─── Validation ───────────────────────────────────────

  describe('Validation', () => {
    it('POST interaction without type returns 400 with structured error', async () => {
      const { admin, lead } = await setupInteractionContext('val-notype');

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/interactions`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ notes: 'No type provided' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.details).toBeDefined();
    });

    it('POST interaction to non-existent lead returns 404', async () => {
      const { admin } = await setupInteractionContext('val-404');

      const res = await request(app.getHttpServer())
        .post('/api/leads/00000000-0000-0000-0000-000000000000/interactions')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ type: InteractionType.Llamada })
        .expect(404);

      expect(res.body.error).toBe('LEAD_NOT_FOUND');
    });

    it('PATCH visit with invalid visitId returns 404', async () => {
      const { admin, lead } = await setupInteractionContext('val-visit-404');

      const res = await request(app.getHttpServer())
        .patch(`/api/leads/${lead.id}/visits/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ status: VisitStatus.Completada })
        .expect(404);

      expect(res.body.error).toBe('VISIT_NOT_FOUND');
    });
  });

  // ─── lastContactAt Update ─────────────────────────────

  describe('lastContactAt auto-update', () => {
    it('lastContactAt updates on visit creation too', async () => {
      const { admin, lead } = await setupInteractionContext('last-contact');

      // Create a visit
      const scheduledAt = new Date(Date.now() + 86400000).toISOString();
      await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/visits`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ scheduledAt })
        .expect(201);

      // Check lastContactAt was updated
      const leadAfter = await request(app.getHttpServer())
        .get(`/api/leads/${lead.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(leadAfter.body.lastContactAt).toBeDefined();
      expect(new Date(leadAfter.body.lastContactAt).getTime()).toBeGreaterThan(
        Date.now() - 10000,
      );
    });
  });
});
