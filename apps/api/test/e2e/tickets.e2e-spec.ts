import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
  createUserDirect,
  loginUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  UserRole,
  PropertyType,
  TicketStatus,
  TicketPriority,
} from '@realfy/shared';

describe('Tickets (e2e)', () => {
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

  // ─── Helpers ──────────────────────────────────────

  const createPropertyPayload = {
    title: 'Departamento Test',
    type: PropertyType.Departamento,
    description: 'Propiedad de test para tickets',
    street: 'Av. Santa Fe',
    number: '1234',
    city: 'Buenos Aires',
    province: 'CABA',
    area: 85,
    rooms: 3,
    bedrooms: 2,
    bathrooms: 1,
    price: 150000,
    currency: 'USD',
  };

  /** Register admin, create property, return token + propertyId */
  async function setupAdminWithProperty(emailSuffix: string) {
    const admin = await registerUser(app, {
      email: `admin@${emailSuffix}.com`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'User',
    });

    const propRes = await request(app.getHttpServer())
      .post('/api/properties')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send(createPropertyPayload)
      .expect(201);

    return {
      admin,
      propertyId: propRes.body.id as string,
      tenantId: admin.user.tenantId as string,
    };
  }

  /** Create a category for the tenant */
  async function createCategory(token: string, name: string) {
    const res = await request(app.getHttpServer())
      .post('/api/ticket-categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, icon: '🔧', color: '#FF5733' })
      .expect(201);
    return res.body;
  }

  /** Create a ticket */
  async function createTicket(
    token: string,
    propertyId: string,
    overrides: Record<string, any> = {},
  ) {
    const res = await request(app.getHttpServer())
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        propertyId,
        title: 'Fuga de agua en baño',
        description: 'Hay una fuga en el baño principal',
        priority: TicketPriority.Alta,
        ...overrides,
      })
      .expect(201);
    return res.body;
  }

  /** Transition a ticket */
  async function transitionTicket(
    token: string,
    ticketId: string,
    status: TicketStatus,
    expectedCode = 200,
  ) {
    const res = await request(app.getHttpServer())
      .post(`/api/tickets/${ticketId}/transition`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status })
      .expect(expectedCode);
    return res.body;
  }

  // ─── Ticket Lifecycle ─────────────────────────────

  describe('Ticket lifecycle', () => {
    it('full lifecycle: Abierto → Asignado → EnProgreso → Resuelto → Cerrado', async () => {
      const { admin, propertyId, tenantId } = await setupAdminWithProperty('lifecycle');

      // Create another user to assign to
      const assignee = await createUserDirect(prisma, tenantId, {
        email: 'tech@lifecycle.com',
        password: 'Password123!',
        firstName: 'Tech',
        lastName: 'Support',
        role: UserRole.Soporte,
      });

      // Create category
      const category = await createCategory(admin.accessToken, 'Plomería');

      // Create ticket (no assignee → Abierto)
      const ticket = await createTicket(admin.accessToken, propertyId, {
        categoryId: category.id,
        priority: TicketPriority.Alta,
      });

      expect(ticket.status).toBe(TicketStatus.Abierto);
      expect(ticket.slaDeadline).toBeDefined();
      expect(ticket.category.name).toBe('Plomería');

      // Transition: Abierto → Asignado
      const assigned = await transitionTicket(
        admin.accessToken,
        ticket.id,
        TicketStatus.Asignado,
      );
      expect(assigned.status).toBe(TicketStatus.Asignado);

      // Transition: Asignado → EnProgreso
      const inProgress = await transitionTicket(
        admin.accessToken,
        ticket.id,
        TicketStatus.EnProgreso,
      );
      expect(inProgress.status).toBe(TicketStatus.EnProgreso);

      // Transition: EnProgreso → Resuelto (should set resolvedAt)
      const resolved = await transitionTicket(
        admin.accessToken,
        ticket.id,
        TicketStatus.Resuelto,
      );
      expect(resolved.status).toBe(TicketStatus.Resuelto);
      expect(resolved.resolvedAt).toBeDefined();

      // Transition: Resuelto → Cerrado (should set closedAt)
      const closed = await transitionTicket(
        admin.accessToken,
        ticket.id,
        TicketStatus.Cerrado,
      );
      expect(closed.status).toBe(TicketStatus.Cerrado);
      expect(closed.closedAt).toBeDefined();
    });

    it('auto-assigns to Asignado when created with assignedToUserId', async () => {
      const { admin, propertyId, tenantId } = await setupAdminWithProperty('auto-assign');

      const assignee = await createUserDirect(prisma, tenantId, {
        email: 'tech@auto-assign.com',
        password: 'Password123!',
        role: UserRole.Soporte,
      });

      const ticket = await createTicket(admin.accessToken, propertyId, {
        assignedToUserId: assignee.id,
      });

      expect(ticket.status).toBe(TicketStatus.Asignado);
      expect(ticket.assignedTo.id).toBe(assignee.id);
    });

    it('SLA deadline is computed for Alta priority (24 hours)', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('sla-check');

      const before = new Date();
      const ticket = await createTicket(admin.accessToken, propertyId, {
        priority: TicketPriority.Alta,
      });
      const after = new Date();

      expect(ticket.slaDeadline).toBeDefined();
      const deadline = new Date(ticket.slaDeadline);
      // Alta = 24 hours — deadline should be ~24 hours from now
      const expectedMin = new Date(before.getTime() + 24 * 60 * 60 * 1000 - 5000);
      const expectedMax = new Date(after.getTime() + 24 * 60 * 60 * 1000 + 5000);
      expect(deadline.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
      expect(deadline.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
    });

    it('SLA deadline is null for Baja priority', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('sla-baja');

      const ticket = await createTicket(admin.accessToken, propertyId, {
        priority: TicketPriority.Baja,
      });

      expect(ticket.slaDeadline).toBeNull();
    });
  });

  // ─── Invalid Transitions ──────────────────────────

  describe('Invalid state transitions', () => {
    it('rejects Abierto → Resuelto with 400 and valid transitions', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('invalid-trans');

      const ticket = await createTicket(admin.accessToken, propertyId);
      expect(ticket.status).toBe(TicketStatus.Abierto);

      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/transition`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ status: TicketStatus.Resuelto })
        .expect(400);

      expect(res.body.error).toBe('INVALID_TRANSITION');
      expect(res.body.validTransitions).toContain(TicketStatus.Asignado);
      expect(res.body.validTransitions).toContain(TicketStatus.Cancelado);
      expect(res.body.validTransitions).not.toContain(TicketStatus.Resuelto);
    });

    it('rejects Abierto → Cerrado with 400', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('invalid-cerrado');

      const ticket = await createTicket(admin.accessToken, propertyId);

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/transition`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ status: TicketStatus.Cerrado })
        .expect(400);
    });

    it('Cancelado is terminal — no transitions allowed', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('cancelado-terminal');

      const ticket = await createTicket(admin.accessToken, propertyId);
      // Abierto → Cancelado
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.Cancelado);

      // Cancelado → Abierto should fail
      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/transition`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ status: TicketStatus.Abierto })
        .expect(400);

      expect(res.body.error).toBe('INVALID_TRANSITION');
      expect(res.body.validTransitions).toHaveLength(0);
    });
  });

  // ─── Ticket CRUD ──────────────────────────────────

  describe('Ticket CRUD', () => {
    it('POST /tickets — creates a ticket with all fields', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('crud-create');
      const category = await createCategory(admin.accessToken, 'Electricidad');

      const ticket = await createTicket(admin.accessToken, propertyId, {
        categoryId: category.id,
        title: 'Se cortó la luz',
        description: 'No funciona la luz del living',
        priority: TicketPriority.Urgente,
      });

      expect(ticket.id).toBeDefined();
      expect(ticket.title).toBe('Se cortó la luz');
      expect(ticket.priority).toBe(TicketPriority.Urgente);
      expect(ticket.property.id).toBe(propertyId);
      expect(ticket.category.name).toBe('Electricidad');
      expect(ticket.createdBy.email).toBe('admin@crud-create.com');
    });

    it('GET /tickets — lists tickets with pagination', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('crud-list');

      await createTicket(admin.accessToken, propertyId, { title: 'Ticket 1' });
      await createTicket(admin.accessToken, propertyId, { title: 'Ticket 2' });
      await createTicket(admin.accessToken, propertyId, { title: 'Ticket 3' });

      const res = await request(app.getHttpServer())
        .get('/api/tickets')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(3);
      expect(res.body.meta.total).toBe(3);
      expect(res.body.meta.page).toBe(1);
    });

    it('GET /tickets — filters by status', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('crud-filter-status');

      const ticket1 = await createTicket(admin.accessToken, propertyId, {
        title: 'Open ticket',
      });
      const ticket2 = await createTicket(admin.accessToken, propertyId, {
        title: 'Will be assigned',
      });
      // Transition ticket2 to Asignado
      await transitionTicket(admin.accessToken, ticket2.id, TicketStatus.Asignado);

      const res = await request(app.getHttpServer())
        .get('/api/tickets')
        .query({ status: TicketStatus.Abierto })
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe(TicketStatus.Abierto);
    });

    it('GET /tickets — filters by priority', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('crud-filter-prio');

      await createTicket(admin.accessToken, propertyId, {
        title: 'Urgent ticket',
        priority: TicketPriority.Urgente,
      });
      await createTicket(admin.accessToken, propertyId, {
        title: 'Low ticket',
        priority: TicketPriority.Baja,
      });

      const res = await request(app.getHttpServer())
        .get('/api/tickets')
        .query({ priority: TicketPriority.Urgente })
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].priority).toBe(TicketPriority.Urgente);
    });

    it('GET /tickets/:id — returns full detail with valid transitions', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('crud-detail');
      const ticket = await createTicket(admin.accessToken, propertyId);

      const res = await request(app.getHttpServer())
        .get(`/api/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(ticket.id);
      expect(res.body.property).toBeDefined();
      expect(res.body.createdBy).toBeDefined();
      expect(res.body.validTransitions).toContain(TicketStatus.Asignado);
      expect(res.body.validTransitions).toContain(TicketStatus.Cancelado);
    });

    it('PATCH /tickets/:id — updates ticket fields', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('crud-update');
      const ticket = await createTicket(admin.accessToken, propertyId);

      const res = await request(app.getHttpServer())
        .patch(`/api/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ title: 'Updated title', priority: TicketPriority.Urgente })
        .expect(200);

      expect(res.body.title).toBe('Updated title');
      expect(res.body.priority).toBe(TicketPriority.Urgente);
      // SLA should be recalculated for new priority
      expect(res.body.slaDeadline).toBeDefined();
    });
  });

  // ─── Comments ─────────────────────────────────────

  describe('Comments', () => {
    it('POST /tickets/:id/comments — adds a comment', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('comment-add');
      const ticket = await createTicket(admin.accessToken, propertyId);

      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/comments`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ content: 'Se contactó al plomero' })
        .expect(201);

      expect(res.body.content).toBe('Se contactó al plomero');
      expect(res.body.user).toBeDefined();
      expect(res.body.user.firstName).toBe('Admin');
    });

    it('GET /tickets/:id/comments — lists comments', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('comment-list');
      const ticket = await createTicket(admin.accessToken, propertyId);

      // Add two comments
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/comments`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ content: 'First comment' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/comments`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ content: 'Second comment' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/tickets/${ticket.id}/comments`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].content).toBe('First comment');
      expect(res.body[1].content).toBe('Second comment');
      expect(res.body[0].user).toBeDefined();
    });

    it('comments appear in ticket detail view', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('comment-detail');
      const ticket = await createTicket(admin.accessToken, propertyId);

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/comments`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ content: 'Visible in detail' })
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/api/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(detail.body.comments).toHaveLength(1);
      expect(detail.body.comments[0].content).toBe('Visible in detail');
    });
  });

  // ─── Categories ───────────────────────────────────

  describe('Categories', () => {
    it('POST /ticket-categories — creates a category', async () => {
      const { admin } = await setupAdminWithProperty('cat-create');

      const cat = await createCategory(admin.accessToken, 'Plomería');
      expect(cat.id).toBeDefined();
      expect(cat.name).toBe('Plomería');
      expect(cat.icon).toBe('🔧');
      expect(cat.color).toBe('#FF5733');
      expect(cat.isActive).toBe(true);
    });

    it('GET /ticket-categories — lists active categories', async () => {
      const { admin } = await setupAdminWithProperty('cat-list');

      await createCategory(admin.accessToken, 'Plomería');
      await createCategory(admin.accessToken, 'Electricidad');

      const res = await request(app.getHttpServer())
        .get('/api/ticket-categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body).toHaveLength(2);
    });

    it('PATCH /ticket-categories/:id — updates a category', async () => {
      const { admin } = await setupAdminWithProperty('cat-update');
      const cat = await createCategory(admin.accessToken, 'Old Name');

      const res = await request(app.getHttpServer())
        .patch(`/api/ticket-categories/${cat.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'New Name', color: '#00FF00' })
        .expect(200);

      expect(res.body.name).toBe('New Name');
      expect(res.body.color).toBe('#00FF00');
    });

    it('DELETE /ticket-categories/:id — soft deletes and filters from active list', async () => {
      const { admin } = await setupAdminWithProperty('cat-delete');
      const cat = await createCategory(admin.accessToken, 'To Delete');
      await createCategory(admin.accessToken, 'Keep Active');

      // Soft delete
      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/ticket-categories/${cat.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(deleteRes.body.isActive).toBe(false);

      // Active list should only have 1
      const list = await request(app.getHttpServer())
        .get('/api/ticket-categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(list.body).toHaveLength(1);
      expect(list.body[0].name).toBe('Keep Active');

      // With activeOnly=false, should see both
      const allList = await request(app.getHttpServer())
        .get('/api/ticket-categories')
        .query({ activeOnly: 'false' })
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(allList.body).toHaveLength(2);
    });

    it('rejects duplicate category name within tenant', async () => {
      const { admin } = await setupAdminWithProperty('cat-dup');
      await createCategory(admin.accessToken, 'Duplicada');

      await request(app.getHttpServer())
        .post('/api/ticket-categories')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Duplicada' })
        .expect(400);
    });
  });

  // ─── RBAC ─────────────────────────────────────────

  describe('RBAC enforcement', () => {
    it('Lectura role can GET tickets but cannot POST', async () => {
      const { admin, propertyId, tenantId } = await setupAdminWithProperty('rbac-lectura');

      // Create a ticket as admin
      await createTicket(admin.accessToken, propertyId);

      // Create Lectura user in same tenant
      await createUserDirect(prisma, tenantId, {
        email: 'lectura@rbac-lectura.com',
        password: 'Password123!',
        firstName: 'Lectura',
        lastName: 'User',
        role: UserRole.Lectura,
      });
      const lectura = await loginUser(app, 'lectura@rbac-lectura.com', 'Password123!');

      // Lectura CAN read tickets
      const listRes = await request(app.getHttpServer())
        .get('/api/tickets')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(200);

      expect(listRes.body.data).toHaveLength(1);

      // Lectura CANNOT create tickets
      await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({
          propertyId,
          title: 'Should fail',
          priority: TicketPriority.Media,
        })
        .expect(403);
    });

    it('Lectura role cannot transition tickets', async () => {
      const { admin, propertyId, tenantId } = await setupAdminWithProperty('rbac-trans');

      const ticket = await createTicket(admin.accessToken, propertyId);

      await createUserDirect(prisma, tenantId, {
        email: 'lectura@rbac-trans.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });
      const lectura = await loginUser(app, 'lectura@rbac-trans.com', 'Password123!');

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/transition`)
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({ status: TicketStatus.Asignado })
        .expect(403);
    });

    it('Lectura role cannot create categories', async () => {
      const { admin, tenantId } = await setupAdminWithProperty('rbac-cat');

      await createUserDirect(prisma, tenantId, {
        email: 'lectura@rbac-cat.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });
      const lectura = await loginUser(app, 'lectura@rbac-cat.com', 'Password123!');

      await request(app.getHttpServer())
        .post('/api/ticket-categories')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({ name: 'Should fail' })
        .expect(403);
    });

    it('Soporte role can create tickets and add comments', async () => {
      const { admin, propertyId, tenantId } = await setupAdminWithProperty('rbac-soporte');

      await createUserDirect(prisma, tenantId, {
        email: 'soporte@rbac-soporte.com',
        password: 'Password123!',
        role: UserRole.Soporte,
      });
      const soporte = await loginUser(app, 'soporte@rbac-soporte.com', 'Password123!');

      // Soporte can create tickets
      const ticket = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${soporte.accessToken}`)
        .send({
          propertyId,
          title: 'Soporte ticket',
          priority: TicketPriority.Media,
        })
        .expect(201);

      // Soporte can add comments
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.body.id}/comments`)
        .set('Authorization', `Bearer ${soporte.accessToken}`)
        .send({ content: 'Comment from soporte' })
        .expect(201);
    });
  });

  // ─── Tenant Isolation ─────────────────────────────

  describe('Tenant isolation', () => {
    it('tenant A tickets not visible to tenant B', async () => {
      // Tenant A
      const tenantA = await registerUser(app, {
        email: 'admin@tenant-a-ticket.com',
        password: 'Password123!',
        firstName: 'TenantA',
        lastName: 'Admin',
      });
      const propA = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${tenantA.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      await createTicket(tenantA.accessToken, propA.body.id, {
        title: 'Tenant A ticket',
      });

      // Tenant B
      const tenantB = await registerUser(app, {
        email: 'admin@tenant-b-ticket.com',
        password: 'Password123!',
        firstName: 'TenantB',
        lastName: 'Admin',
      });
      const propB = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${tenantB.accessToken}`)
        .send({ ...createPropertyPayload, title: 'Prop Tenant B' })
        .expect(201);

      await createTicket(tenantB.accessToken, propB.body.id, {
        title: 'Tenant B ticket',
      });

      // Tenant B lists — should only see their own
      const listB = await request(app.getHttpServer())
        .get('/api/tickets')
        .set('Authorization', `Bearer ${tenantB.accessToken}`)
        .expect(200);

      expect(listB.body.data).toHaveLength(1);
      expect(listB.body.data[0].title).toBe('Tenant B ticket');

      // Tenant A lists — should only see their own
      const listA = await request(app.getHttpServer())
        .get('/api/tickets')
        .set('Authorization', `Bearer ${tenantA.accessToken}`)
        .expect(200);

      expect(listA.body.data).toHaveLength(1);
      expect(listA.body.data[0].title).toBe('Tenant A ticket');
    });

    it('tenant A categories not visible to tenant B', async () => {
      const tenantA = await registerUser(app, {
        email: 'admin@cat-iso-a.com',
        password: 'Password123!',
        firstName: 'A',
        lastName: 'Admin',
      });

      const tenantB = await registerUser(app, {
        email: 'admin@cat-iso-b.com',
        password: 'Password123!',
        firstName: 'B',
        lastName: 'Admin',
      });

      // Tenant A creates a category
      await createCategory(tenantA.accessToken, 'Plomería A');

      // Tenant B creates a category
      await createCategory(tenantB.accessToken, 'Electricidad B');

      // Tenant B lists — should only see their own
      const listB = await request(app.getHttpServer())
        .get('/api/ticket-categories')
        .set('Authorization', `Bearer ${tenantB.accessToken}`)
        .expect(200);

      expect(listB.body).toHaveLength(1);
      expect(listB.body[0].name).toBe('Electricidad B');
    });
  });

  // ─── Reopen Flow ──────────────────────────────────

  describe('Reopen flow', () => {
    it('Cerrado → Reabierto clears resolvedAt and closedAt', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('reopen');
      const ticket = await createTicket(admin.accessToken, propertyId);

      // Progress through: Abierto → Asignado → EnProgreso → Resuelto → Cerrado
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.Asignado);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.EnProgreso);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.Resuelto);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.Cerrado);

      // Reopen
      const reopened = await transitionTicket(
        admin.accessToken,
        ticket.id,
        TicketStatus.Reabierto,
      );

      expect(reopened.status).toBe(TicketStatus.Reabierto);
      expect(reopened.resolvedAt).toBeNull();
      expect(reopened.closedAt).toBeNull();
      // Reabierto can go to Asignado or Cancelado
      expect(reopened.validTransitions).toContain(TicketStatus.Asignado);
      expect(reopened.validTransitions).toContain(TicketStatus.Cancelado);
    });
  });
});
