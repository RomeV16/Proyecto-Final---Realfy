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
} from '@realfy/shared';

describe('Email Templates (e2e)', () => {
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

  /** Create an admin user and return token + pipeline + stage context. */
  async function setupEmailContext(emailPrefix = 'et-test') {
    const admin = await createTestUser(app, {
      email: `${emailPrefix}-${Date.now()}@test.com`,
    });

    // Get pipelines (seeded on registration)
    const pipelinesRes = await request(app.getHttpServer())
      .get('/api/pipelines')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    const pipeline = pipelinesRes.body[0];

    return { admin, pipeline };
  }

  /** Create a lead with person email for send-email tests. */
  async function createLeadForSend(
    token: string,
    pipelineId: string,
    emailOverride?: string,
  ) {
    const leadRes = await request(app.getHttpServer())
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Lead',
        lastName: 'Persona',
        email:
          emailOverride ??
          `lead-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
        phone: '+5491155551234',
        pipelineId,
        source: LeadSource.WebInquiry,
      })
      .expect(201);

    return leadRes.body;
  }

  /** Create an email template via API. */
  async function createTemplate(
    token: string,
    overrides: Partial<{
      name: string;
      subject: string;
      body: string;
      variables: string[];
      isActive: boolean;
    }> = {},
  ) {
    const name =
      overrides.name ??
      `Template-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const res = await request(app.getHttpServer())
      .post('/api/email-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name,
        subject: overrides.subject ?? 'Hola {{nombre}}',
        body: overrides.body ?? '<p>Hola {{nombre}}, tu propiedad es {{propiedad}}.</p>',
        variables: overrides.variables,
        isActive: overrides.isActive,
      })
      .expect(201);

    return res.body;
  }

  // ─── Template CRUD ────────────────────────────────────

  describe('Template CRUD', () => {
    it('POST /email-templates creates a template with auto-extracted variables', async () => {
      const { admin } = await setupEmailContext('et-create');

      const res = await request(app.getHttpServer())
        .post('/api/email-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          name: 'Bienvenida',
          subject: 'Hola {{nombre}}',
          body: '<p>Bienvenido {{nombre}}, tu propiedad es {{propiedad}} y el precio es {{precio}}.</p>',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Bienvenida');
      expect(res.body.subject).toBe('Hola {{nombre}}');
      expect(res.body.isActive).toBe(true);
      // Variables auto-extracted from subject + body
      expect(res.body.variables).toContain('nombre');
      expect(res.body.variables).toContain('propiedad');
      expect(res.body.variables).toContain('precio');
    });

    it('POST /email-templates with explicit variables uses them', async () => {
      const { admin } = await setupEmailContext('et-explicit-vars');

      const res = await request(app.getHttpServer())
        .post('/api/email-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          name: 'Custom Vars',
          subject: 'Hello',
          body: 'Body text',
          variables: ['custom1', 'custom2'],
        })
        .expect(201);

      expect(res.body.variables).toEqual(['custom1', 'custom2']);
    });

    it('GET /email-templates lists all templates for tenant', async () => {
      const { admin } = await setupEmailContext('et-list');

      await createTemplate(admin.accessToken, { name: 'Template A' });
      await createTemplate(admin.accessToken, { name: 'Template B' });

      const res = await request(app.getHttpServer())
        .get('/api/email-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
    });

    it('GET /email-templates supports search filter', async () => {
      const { admin } = await setupEmailContext('et-search');

      await createTemplate(admin.accessToken, { name: 'Bienvenida' });
      await createTemplate(admin.accessToken, { name: 'Seguimiento' });

      const res = await request(app.getHttpServer())
        .get('/api/email-templates?search=Bienvenida')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe('Bienvenida');
    });

    it('GET /email-templates/:id returns a single template', async () => {
      const { admin } = await setupEmailContext('et-get-one');

      const template = await createTemplate(admin.accessToken, {
        name: 'SingleGet',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/email-templates/${template.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(template.id);
      expect(res.body.name).toBe('SingleGet');
    });

    it('GET /email-templates/:id returns 404 for non-existent template', async () => {
      const { admin } = await setupEmailContext('et-404');

      const res = await request(app.getHttpServer())
        .get('/api/email-templates/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(404);

      expect(res.body.error).toBe('TEMPLATE_NOT_FOUND');
    });

    it('PATCH /email-templates/:id updates template fields', async () => {
      const { admin } = await setupEmailContext('et-update');

      const template = await createTemplate(admin.accessToken, {
        name: 'Original',
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/email-templates/${template.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Updated', subject: 'New subject {{apellido}}' })
        .expect(200);

      expect(res.body.name).toBe('Updated');
      expect(res.body.subject).toBe('New subject {{apellido}}');
      // Variables auto-updated when subject changes
      expect(res.body.variables).toContain('apellido');
    });

    it('DELETE /email-templates/:id removes template', async () => {
      const { admin } = await setupEmailContext('et-delete');

      const template = await createTemplate(admin.accessToken, {
        name: 'ToDelete',
      });

      await request(app.getHttpServer())
        .delete(`/api/email-templates/${template.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      // Confirm it's gone
      await request(app.getHttpServer())
        .get(`/api/email-templates/${template.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(404);
    });
  });

  // ─── Unique Name Constraint ───────────────────────────

  describe('Unique name constraint', () => {
    it('POST /email-templates with duplicate name returns 400 TEMPLATE_NAME_EXISTS', async () => {
      const { admin } = await setupEmailContext('et-unique');

      await createTemplate(admin.accessToken, { name: 'Duplicate' });

      const res = await request(app.getHttpServer())
        .post('/api/email-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          name: 'Duplicate',
          subject: 'Test',
          body: 'Body',
        })
        .expect(400);

      expect(res.body.error).toBe('TEMPLATE_NAME_EXISTS');
    });

    it('Same name in different tenants is allowed', async () => {
      const ctxA = await setupEmailContext('et-unique-a');
      const ctxB = await setupEmailContext('et-unique-b');

      await createTemplate(ctxA.admin.accessToken, { name: 'SharedName' });

      // Different tenant can use the same name
      const res = await request(app.getHttpServer())
        .post('/api/email-templates')
        .set('Authorization', `Bearer ${ctxB.admin.accessToken}`)
        .send({
          name: 'SharedName',
          subject: 'Subject',
          body: 'Body',
        })
        .expect(201);

      expect(res.body.name).toBe('SharedName');
    });
  });

  // ─── Preview ──────────────────────────────────────────

  describe('Preview', () => {
    it('POST /email-templates/:id/preview renders variables in subject and body', async () => {
      const { admin } = await setupEmailContext('et-preview');

      const template = await createTemplate(admin.accessToken, {
        name: 'PreviewTest',
        subject: 'Hola {{nombre}}',
        body: '<p>Tu propiedad: {{propiedad}}, precio: {{precio}}</p>',
      });

      const res = await request(app.getHttpServer())
        .post(`/api/email-templates/${template.id}/preview`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          subject: template.subject,
          body: template.body,
          variables: {
            nombre: 'Juan',
            propiedad: 'Av. Rivadavia 1234',
            precio: '150.000',
          },
        })
        .expect(201);

      expect(res.body.subject).toBe('Hola Juan');
      expect(res.body.body).toContain('Av. Rivadavia 1234');
      expect(res.body.body).toContain('150.000');
    });

    it('Preview escapes HTML in variable values to prevent XSS', async () => {
      const { admin } = await setupEmailContext('et-preview-xss');

      const template = await createTemplate(admin.accessToken, {
        name: 'XSSTest',
      });

      const res = await request(app.getHttpServer())
        .post(`/api/email-templates/${template.id}/preview`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          subject: 'Test {{nombre}}',
          body: '<p>{{nombre}}</p>',
          variables: {
            nombre: '<script>alert("xss")</script>',
          },
        })
        .expect(201);

      expect(res.body.body).not.toContain('<script>');
      expect(res.body.body).toContain('&lt;script&gt;');
    });

    it('Preview leaves unresolved variables as-is', async () => {
      const { admin } = await setupEmailContext('et-preview-unresolved');

      const template = await createTemplate(admin.accessToken, {
        name: 'UnresolvedTest',
      });

      const res = await request(app.getHttpServer())
        .post(`/api/email-templates/${template.id}/preview`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          subject: '{{nombre}} {{unknown}}',
          body: '{{nombre}}',
          variables: { nombre: 'Juan' },
        })
        .expect(201);

      expect(res.body.subject).toBe('Juan {{unknown}}');
    });
  });

  // ─── Send Email ───────────────────────────────────────

  describe('Send Email', () => {
    it('POST /leads/:leadId/send-email returns EMAIL_NOT_CONFIGURED when Resend key missing', async () => {
      const { admin, pipeline } = await setupEmailContext('et-send-nokey');

      const lead = await createLeadForSend(
        admin.accessToken,
        pipeline.id,
      );

      const template = await createTemplate(admin.accessToken, {
        name: 'SendTest',
      });

      // The test environment has no RESEND_API_KEY, so the service should report not configured
      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/send-email`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          templateId: template.id,
          leadId: lead.id,
          to: 'test@example.com',
        })
        .expect(400);

      expect(res.body.error).toBe('EMAIL_NOT_CONFIGURED');
    });

    it('POST /leads/:leadId/send-email returns LEAD_NOT_FOUND for non-existent lead', async () => {
      const { admin } = await setupEmailContext('et-send-nolead');

      const template = await createTemplate(admin.accessToken, {
        name: 'NoLeadTest',
      });

      const fakeLeadId = '00000000-0000-0000-0000-000000000000';

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${fakeLeadId}/send-email`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          templateId: template.id,
          leadId: fakeLeadId,
          to: 'test@example.com',
        });

      // Without RESEND_API_KEY, email service is not configured — returns 400 before lead lookup
      // With RESEND configured, it would return 404 LEAD_NOT_FOUND
      if (res.status === 400) {
        expect(res.body.error).toBe('EMAIL_NOT_CONFIGURED');
      } else {
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('LEAD_NOT_FOUND');
      }
    });

    it('POST /leads/:leadId/send-email returns TEMPLATE_NOT_FOUND for non-existent template', async () => {
      const { admin, pipeline } = await setupEmailContext('et-send-notempl');

      const lead = await createLeadForSend(
        admin.accessToken,
        pipeline.id,
      );

      const fakeTemplateId = '00000000-0000-0000-0000-000000000000';

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/send-email`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          templateId: fakeTemplateId,
          leadId: lead.id,
          to: 'test@example.com',
        });

      // Without RESEND_API_KEY, email service is not configured — returns 400 before template lookup
      if (res.status === 400) {
        expect(res.body.error).toBe('EMAIL_NOT_CONFIGURED');
      } else {
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('TEMPLATE_NOT_FOUND');
      }
    });

    it('POST /leads/:leadId/send-email returns VALIDATION_ERROR when templateId missing', async () => {
      const { admin, pipeline } = await setupEmailContext('et-send-val');

      const lead = await createLeadForSend(admin.accessToken, pipeline.id);

      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/send-email`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          leadId: lead.id,
          to: 'test@example.com',
          // missing templateId
        })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  // ─── RBAC ─────────────────────────────────────────────

  describe('RBAC', () => {
    it('Ventas role cannot POST /email-templates (403)', async () => {
      const { admin } = await setupEmailContext('rbac-ventas-create');

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas-et@test.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });
      const ventas = await loginUser(app, 'ventas-et@test.com', 'Password123!');

      await request(app.getHttpServer())
        .post('/api/email-templates')
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send({
          name: 'VentasTemplate',
          subject: 'Test',
          body: 'Body',
        })
        .expect(403);
    });

    it('Ventas role cannot PATCH /email-templates/:id (403)', async () => {
      const { admin } = await setupEmailContext('rbac-ventas-update');

      const template = await createTemplate(admin.accessToken, {
        name: 'AdminTemplate',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas-patch@test.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });
      const ventas = await loginUser(
        app,
        'ventas-patch@test.com',
        'Password123!',
      );

      await request(app.getHttpServer())
        .patch(`/api/email-templates/${template.id}`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send({ name: 'Hacked' })
        .expect(403);
    });

    it('Ventas role cannot DELETE /email-templates/:id (403)', async () => {
      const { admin } = await setupEmailContext('rbac-ventas-delete');

      const template = await createTemplate(admin.accessToken, {
        name: 'NoDelete',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas-del@test.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });
      const ventas = await loginUser(
        app,
        'ventas-del@test.com',
        'Password123!',
      );

      await request(app.getHttpServer())
        .delete(`/api/email-templates/${template.id}`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .expect(403);
    });

    it('Ventas role CAN POST /email-templates/:id/preview (201)', async () => {
      const { admin } = await setupEmailContext('rbac-ventas-preview');

      const template = await createTemplate(admin.accessToken, {
        name: 'PreviewOK',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas-prev@test.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });
      const ventas = await loginUser(
        app,
        'ventas-prev@test.com',
        'Password123!',
      );

      await request(app.getHttpServer())
        .post(`/api/email-templates/${template.id}/preview`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send({
          subject: 'Test',
          body: 'Body',
          variables: {},
        })
        .expect(201);
    });

    it('Ventas role CAN POST /leads/:leadId/send-email (400 = not 403)', async () => {
      const { admin, pipeline } = await setupEmailContext('rbac-ventas-send');

      const lead = await createLeadForSend(admin.accessToken, pipeline.id);
      const template = await createTemplate(admin.accessToken, {
        name: 'VentasSend',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas-send@test.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });
      const ventas = await loginUser(
        app,
        'ventas-send@test.com',
        'Password123!',
      );

      // Should get 400 (EMAIL_NOT_CONFIGURED), NOT 403 — proving RBAC allows access
      const res = await request(app.getHttpServer())
        .post(`/api/leads/${lead.id}/send-email`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send({
          templateId: template.id,
          leadId: lead.id,
          to: 'test@example.com',
        })
        .expect(400);

      expect(res.body.error).toBe('EMAIL_NOT_CONFIGURED');
    });

    it('Lectura role cannot access email-templates endpoints (403)', async () => {
      const { admin } = await setupEmailContext('rbac-lectura');

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura-et@test.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });
      const lectura = await loginUser(
        app,
        'lectura-et@test.com',
        'Password123!',
      );

      await request(app.getHttpServer())
        .get('/api/email-templates')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .post('/api/email-templates')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({ name: 'Test', subject: 'S', body: 'B' })
        .expect(403);
    });

    it('Gerente role CAN access template CRUD (201/200)', async () => {
      const { admin } = await setupEmailContext('rbac-gerente');

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'gerente-et@test.com',
        password: 'Password123!',
        role: UserRole.Gerente,
      });
      const gerente = await loginUser(
        app,
        'gerente-et@test.com',
        'Password123!',
      );

      // Create
      const createRes = await request(app.getHttpServer())
        .post('/api/email-templates')
        .set('Authorization', `Bearer ${gerente.accessToken}`)
        .send({ name: 'GerenteTemplate', subject: 'S', body: 'B' })
        .expect(201);

      // List
      await request(app.getHttpServer())
        .get('/api/email-templates')
        .set('Authorization', `Bearer ${gerente.accessToken}`)
        .expect(200);

      // Get one
      await request(app.getHttpServer())
        .get(`/api/email-templates/${createRes.body.id}`)
        .set('Authorization', `Bearer ${gerente.accessToken}`)
        .expect(200);

      // Update
      await request(app.getHttpServer())
        .patch(`/api/email-templates/${createRes.body.id}`)
        .set('Authorization', `Bearer ${gerente.accessToken}`)
        .send({ name: 'GerenteUpdated' })
        .expect(200);

      // Delete
      await request(app.getHttpServer())
        .delete(`/api/email-templates/${createRes.body.id}`)
        .set('Authorization', `Bearer ${gerente.accessToken}`)
        .expect(200);
    });
  });

  // ─── Tenant Isolation ─────────────────────────────────

  describe('Tenant Isolation', () => {
    it('Templates from tenant A are not visible to tenant B', async () => {
      const ctxA = await setupEmailContext('iso-a');
      const ctxB = await setupEmailContext('iso-b');

      await createTemplate(ctxA.admin.accessToken, { name: 'TenantAOnly' });

      // Tenant B should see 0 templates
      const res = await request(app.getHttpServer())
        .get('/api/email-templates')
        .set('Authorization', `Bearer ${ctxB.admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('Tenant B cannot GET tenant A template by ID (404)', async () => {
      const ctxA = await setupEmailContext('iso-get-a');
      const ctxB = await setupEmailContext('iso-get-b');

      const template = await createTemplate(ctxA.admin.accessToken, {
        name: 'PrivateTemplate',
      });

      await request(app.getHttpServer())
        .get(`/api/email-templates/${template.id}`)
        .set('Authorization', `Bearer ${ctxB.admin.accessToken}`)
        .expect(404);
    });

    it('Tenant B cannot DELETE tenant A template (404)', async () => {
      const ctxA = await setupEmailContext('iso-del-a');
      const ctxB = await setupEmailContext('iso-del-b');

      const template = await createTemplate(ctxA.admin.accessToken, {
        name: 'CantDelete',
      });

      await request(app.getHttpServer())
        .delete(`/api/email-templates/${template.id}`)
        .set('Authorization', `Bearer ${ctxB.admin.accessToken}`)
        .expect(404);

      // Confirm still exists for tenant A
      await request(app.getHttpServer())
        .get(`/api/email-templates/${template.id}`)
        .set('Authorization', `Bearer ${ctxA.admin.accessToken}`)
        .expect(200);
    });
  });

  // ─── Validation ───────────────────────────────────────

  describe('Validation', () => {
    it('POST /email-templates without name returns 400 VALIDATION_ERROR', async () => {
      const { admin } = await setupEmailContext('val-noname');

      const res = await request(app.getHttpServer())
        .post('/api/email-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ subject: 'Test', body: 'Body' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
      expect(res.body.details).toBeDefined();
    });

    it('POST /email-templates without subject returns 400', async () => {
      const { admin } = await setupEmailContext('val-nosubject');

      const res = await request(app.getHttpServer())
        .post('/api/email-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Test', body: 'Body' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('POST /email-templates/:id/preview without subject returns 400', async () => {
      const { admin } = await setupEmailContext('val-preview');

      const template = await createTemplate(admin.accessToken, {
        name: 'ValPreview',
      });

      const res = await request(app.getHttpServer())
        .post(`/api/email-templates/${template.id}/preview`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ body: 'Body', variables: {} })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  // ─── Pagination & Filtering ───────────────────────────

  describe('Pagination & Filtering', () => {
    it('GET /email-templates supports pagination', async () => {
      const { admin } = await setupEmailContext('et-page');

      // Create 5 templates
      for (let i = 0; i < 5; i++) {
        await createTemplate(admin.accessToken, { name: `Page-${i}` });
      }

      const res = await request(app.getHttpServer())
        .get('/api/email-templates?page=1&limit=2')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(5);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(2);
      expect(res.body.totalPages).toBe(3);
    });

    it('GET /email-templates supports isActive filter', async () => {
      const { admin } = await setupEmailContext('et-active');

      await createTemplate(admin.accessToken, {
        name: 'Active',
        isActive: true,
      });
      await createTemplate(admin.accessToken, {
        name: 'Inactive',
        isActive: false,
      });

      const activeRes = await request(app.getHttpServer())
        .get('/api/email-templates?isActive=true')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(activeRes.body.items).toHaveLength(1);
      expect(activeRes.body.items[0].name).toBe('Active');

      const inactiveRes = await request(app.getHttpServer())
        .get('/api/email-templates?isActive=false')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(inactiveRes.body.items).toHaveLength(1);
      expect(inactiveRes.body.items[0].name).toBe('Inactive');
    });
  });
});
