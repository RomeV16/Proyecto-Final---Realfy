import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
  createPortalInvitation,
  portalSetPassword,
  portalLogin,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  PersonRole,
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
  PropertyType,
  TicketStatus,
} from '@realfy/shared';

describe('Portal Tickets (e2e)', () => {
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

  async function createProperty(token: string) {
    const res = await request(app.getHttpServer())
      .post('/api/properties')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Depto Palermo',
        type: PropertyType.Departamento,
        street: 'Av. Santa Fe',
        number: '1234',
        city: 'Buenos Aires',
        province: 'CABA',
        area: 65,
        rooms: 2,
        bedrooms: 1,
        bathrooms: 1,
        price: 100000,
        currency: 'USD',
      })
      .expect(201);
    return res.body;
  }

  async function createPersonWithRole(
    token: string,
    overrides: { firstName: string; lastName: string; role: PersonRole; email?: string },
  ) {
    const personRes = await request(app.getHttpServer())
      .post('/api/persons')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: overrides.firstName,
        lastName: overrides.lastName,
        email: overrides.email ?? `${overrides.firstName.toLowerCase()}@test.com`,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/persons/${personRes.body.id}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: overrides.role })
      .expect(201);

    return personRes.body;
  }

  /**
   * Full setup: register staff, create property, propietario, inquilino,
   * contract, portal credential, login, and a ticket category.
   */
  async function setupPortalWithContract(emailPrefix: string) {
    const staff = await registerUser(app, {
      email: `${emailPrefix}-staff@test.com`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Staff',
    });

    const property = await createProperty(staff.accessToken);

    const propietario = await createPersonWithRole(staff.accessToken, {
      firstName: 'Carlos',
      lastName: 'Propietario',
      role: PersonRole.Propietario,
      email: `${emailPrefix}-prop@test.com`,
    });

    const inquilino = await createPersonWithRole(staff.accessToken, {
      firstName: 'Ana',
      lastName: 'Inquilina',
      role: PersonRole.Inquilino,
      email: `${emailPrefix}-inq@test.com`,
    });

    const contractRes = await request(app.getHttpServer())
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({
        propertyId: property.id,
        contractType: ContractType.Alquiler,
        status: ContractStatus.Activo,
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
        rentAmount: '150000.00',
        rentCurrency: 'ARS',
        depositAmount: '300000.00',
        depositCurrency: 'ARS',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        notes: 'Contrato test',
        persons: [
          { personId: propietario.id, role: PersonRole.Propietario },
          { personId: inquilino.id, role: PersonRole.Inquilino },
        ],
        guarantees: [],
      })
      .expect(201);

    // Create portal invitation and set password
    const invitation = await createPortalInvitation(
      app,
      staff.accessToken,
      inquilino.id,
    );

    await portalSetPassword(app, invitation.token, 'PortalPass123!');

    const loginResult = await portalLogin(
      app,
      `${emailPrefix}-inq@test.com`,
      'PortalPass123!',
    );

    // Create a ticket category
    const tenantId = staff.user.tenantId;
    const category = await prisma.baseClient.ticketCategory.create({
      data: {
        tenantId,
        name: 'Plomería',
        icon: '🔧',
        color: '#3b82f6',
        isActive: true,
        sortOrder: 1,
      },
    });

    return {
      staff,
      property,
      propietario,
      inquilino,
      contract: contractRes.body,
      portalTokens: loginResult.tokens,
      inquilinoEmail: `${emailPrefix}-inq@test.com`,
      category,
      tenantId,
    };
  }

  // ─── Ticket Creation ──────────────────────────────────

  describe('Ticket creation', () => {
    it('inquilino creates ticket for own property → 201 with createdByPersonId set', async () => {
      const setup = await setupPortalWithContract('tc-create');

      const res = await request(app.getHttpServer())
        .post('/api/portal/tickets')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .send({
          propertyId: setup.property.id,
          title: 'Pérdida de agua en baño',
          description: 'Sale agua del caño debajo del lavatorio.',
          categoryId: setup.category.id,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe('Pérdida de agua en baño');
      expect(res.body.description).toBe('Sale agua del caño debajo del lavatorio.');
      expect(res.body.status).toBe(TicketStatus.Abierto);
      expect(res.body.createdByPersonId).toBe(setup.inquilino.id);
      expect(res.body.createdByPerson).toBeDefined();
      expect(res.body.createdByPerson.firstName).toBe('Ana');
    });

    it('inquilino creates ticket with valid category → category association persisted', async () => {
      const setup = await setupPortalWithContract('tc-cat');

      const res = await request(app.getHttpServer())
        .post('/api/portal/tickets')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .send({
          propertyId: setup.property.id,
          title: 'Canilla rota',
          categoryId: setup.category.id,
        })
        .expect(201);

      expect(res.body.categoryId).toBe(setup.category.id);
      expect(res.body.category).toBeDefined();
      expect(res.body.category.name).toBe('Plomería');
    });

    it('inquilino creates ticket for property NOT in their contracts → 403', async () => {
      const setup = await setupPortalWithContract('tc-403');

      // Create another property not linked to the inquilino
      const otherProperty = await createProperty(setup.staff.accessToken);

      const res = await request(app.getHttpServer())
        .post('/api/portal/tickets')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .send({
          propertyId: otherProperty.id,
          title: 'Should not work',
        })
        .expect(403);

      expect(res.body.error).toBe('PORTAL_ACCESS_DENIED');
    });

    it('inquilino creates ticket without auth → 401', async () => {
      const setup = await setupPortalWithContract('tc-noauth');

      await request(app.getHttpServer())
        .post('/api/portal/tickets')
        .send({
          propertyId: setup.property.id,
          title: 'No auth',
        })
        .expect(401);
    });
  });

  // ─── Ticket Listing ───────────────────────────────────

  describe('Ticket listing', () => {
    it('inquilino lists tickets → sees only tickets on their properties', async () => {
      const setup = await setupPortalWithContract('tl-list');

      // Create a ticket via portal
      await request(app.getHttpServer())
        .post('/api/portal/tickets')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .send({
          propertyId: setup.property.id,
          title: 'Reclamo inquilino',
        })
        .expect(201);

      // Create a ticket on a different property via staff (not linked to this inquilino)
      const otherProperty = await createProperty(setup.staff.accessToken);
      await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${setup.staff.accessToken}`)
        .send({
          propertyId: otherProperty.id,
          title: 'Reclamo en otra propiedad',
          priority: 'Media',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/portal/tickets')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('Reclamo inquilino');
      expect(res.body.meta.total).toBe(1);
    });
  });

  // ─── Ticket Detail ────────────────────────────────────

  describe('Ticket detail', () => {
    it('inquilino views ticket detail → sees full data with timeline', async () => {
      const setup = await setupPortalWithContract('td-detail');

      const createRes = await request(app.getHttpServer())
        .post('/api/portal/tickets')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .send({
          propertyId: setup.property.id,
          title: 'Humedad en techo',
          description: 'Mancha de humedad en dormitorio.',
        })
        .expect(201);

      const ticketId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .get(`/api/portal/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(ticketId);
      expect(res.body.title).toBe('Humedad en techo');
      expect(res.body.property).toBeDefined();
      expect(res.body.createdByPerson).toBeDefined();
      expect(res.body.comments).toBeInstanceOf(Array);
    });

    it('inquilino can\'t access ticket on property not in their contracts → 403', async () => {
      const setup = await setupPortalWithContract('td-403');

      // Create a ticket on a different property via staff
      const otherProperty = await createProperty(setup.staff.accessToken);
      const staffTicketRes = await request(app.getHttpServer())
        .post('/api/tickets')
        .set('Authorization', `Bearer ${setup.staff.accessToken}`)
        .send({
          propertyId: otherProperty.id,
          title: 'Staff ticket on other property',
          priority: 'Media',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/portal/tickets/${staffTicketRes.body.id}`)
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(403);

      expect(res.body.error).toBe('PORTAL_ACCESS_DENIED');
    });
  });

  // ─── Comments ─────────────────────────────────────────

  describe('Comments', () => {
    it('inquilino adds comment → 201, comment has personId set', async () => {
      const setup = await setupPortalWithContract('tc-comment');

      const ticketRes = await request(app.getHttpServer())
        .post('/api/portal/tickets')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .send({
          propertyId: setup.property.id,
          title: 'Problema eléctrico',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/portal/tickets/${ticketRes.body.id}/comments`)
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .send({ content: 'Se cortó la luz en la cocina' })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.content).toBe('Se cortó la luz en la cocina');
      expect(res.body.personId).toBe(setup.inquilino.id);
      expect(res.body.person).toBeDefined();
      expect(res.body.person.firstName).toBe('Ana');
    });

    it('inquilino comment appears in ticket detail', async () => {
      const setup = await setupPortalWithContract('tc-comment-timeline');

      const ticketRes = await request(app.getHttpServer())
        .post('/api/portal/tickets')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .send({
          propertyId: setup.property.id,
          title: 'Puerta trabada',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/portal/tickets/${ticketRes.body.id}/comments`)
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .send({ content: 'No puedo cerrar la puerta del balcón' })
        .expect(201);

      const detailRes = await request(app.getHttpServer())
        .get(`/api/portal/tickets/${ticketRes.body.id}`)
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(200);

      const portalComments = detailRes.body.comments.filter(
        (c: any) => c.personId === setup.inquilino.id,
      );
      expect(portalComments.length).toBeGreaterThanOrEqual(1);
      expect(portalComments.some((c: any) => c.content === 'No puedo cerrar la puerta del balcón')).toBe(true);
    });
  });

  // ─── Staff Transitions Visible to Inquilino ──────────

  describe('Staff transitions visible to inquilino', () => {
    it('staff transitions ticket → inquilino sees updated status', async () => {
      const setup = await setupPortalWithContract('tt-transition');

      const ticketRes = await request(app.getHttpServer())
        .post('/api/portal/tickets')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .send({
          propertyId: setup.property.id,
          title: 'Fuga de gas',
        })
        .expect(201);

      const ticketId = ticketRes.body.id;

      // Staff transitions to Asignado
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticketId}/transition`)
        .set('Authorization', `Bearer ${setup.staff.accessToken}`)
        .send({ status: TicketStatus.Asignado })
        .expect(200);

      // Inquilino fetches detail → should see Asignado
      const detailRes = await request(app.getHttpServer())
        .get(`/api/portal/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(200);

      expect(detailRes.body.status).toBe(TicketStatus.Asignado);
    });
  });

  // ─── Cross-Tenant Isolation ───────────────────────────

  describe('Cross-tenant isolation', () => {
    it('inquilino can\'t see tickets from other tenants', async () => {
      const setupA = await setupPortalWithContract('xt-a');

      // Create a ticket for tenant A
      await request(app.getHttpServer())
        .post('/api/portal/tickets')
        .set('Authorization', `Bearer ${setupA.portalTokens.accessToken}`)
        .send({
          propertyId: setupA.property.id,
          title: 'Ticket Tenant A',
        })
        .expect(201);

      // Setup tenant B with its own portal user + contract
      const setupB = await setupPortalWithContract('xt-b');

      // Create a ticket for tenant B
      await request(app.getHttpServer())
        .post('/api/portal/tickets')
        .set('Authorization', `Bearer ${setupB.portalTokens.accessToken}`)
        .send({
          propertyId: setupB.property.id,
          title: 'Ticket Tenant B',
        })
        .expect(201);

      // Tenant A's inquilino should only see their own ticket
      const resA = await request(app.getHttpServer())
        .get('/api/portal/tickets')
        .set('Authorization', `Bearer ${setupA.portalTokens.accessToken}`)
        .expect(200);

      expect(resA.body.data).toHaveLength(1);
      expect(resA.body.data[0].title).toBe('Ticket Tenant A');

      // Tenant B's inquilino should only see their own ticket
      const resB = await request(app.getHttpServer())
        .get('/api/portal/tickets')
        .set('Authorization', `Bearer ${setupB.portalTokens.accessToken}`)
        .expect(200);

      expect(resB.body.data).toHaveLength(1);
      expect(resB.body.data[0].title).toBe('Ticket Tenant B');
    });
  });

  // ─── Categories ───────────────────────────────────────

  describe('Categories', () => {
    it('GET /portal/categories returns active categories for tenant', async () => {
      const setup = await setupPortalWithContract('tc-categories');

      const res = await request(app.getHttpServer())
        .get('/api/portal/categories')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(200);

      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBeGreaterThanOrEqual(1);

      const cat = res.body.find((c: any) => c.name === 'Plomería');
      expect(cat).toBeDefined();
      expect(cat.id).toBe(setup.category.id);
      expect(cat.icon).toBe('🔧');
    });
  });
});
