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
  Currency,
} from '@realfy/shared';

describe('Providers (e2e)', () => {
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
    description: 'Propiedad de test para proveedores',
    street: 'Av. Corrientes',
    number: '5678',
    city: 'Buenos Aires',
    province: 'CABA',
    area: 65,
    rooms: 2,
    bedrooms: 1,
    bathrooms: 1,
    price: 100000,
    currency: 'USD',
  };

  /** Register admin, create property, return token + propertyId + tenantId */
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

  /** Create a provider through the API */
  async function createProvider(
    token: string,
    overrides: Record<string, any> = {},
  ) {
    const res = await request(app.getHttpServer())
      .post('/api/providers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Carlos',
        lastName: 'Plomero',
        rubros: ['Plomería'],
        coverageZones: ['Buenos Aires'],
        ...overrides,
      })
      .expect(201);
    return res.body;
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

  // ─── Provider CRUD ────────────────────────────────

  describe('Provider CRUD', () => {
    it('POST /providers — creates provider with person + profile in transaction', async () => {
      const { admin } = await setupAdminWithProperty('prov-create');

      const provider = await createProvider(admin.accessToken, {
        firstName: 'Juan',
        lastName: 'Electricista',
        rubros: ['Electricidad', 'Plomería'],
        coverageZones: ['Buenos Aires', 'La Plata'],
        notes: 'Disponible fines de semana',
      });

      expect(provider.id).toBeDefined();
      expect(provider.firstName).toBe('Juan');
      expect(provider.lastName).toBe('Electricista');
      expect(provider.providerProfile).toBeDefined();
      expect(provider.providerProfile.rubros).toEqual(['Electricidad', 'Plomería']);
      expect(provider.providerProfile.coverageZones).toEqual(['Buenos Aires', 'La Plata']);
      expect(provider.providerProfile.notes).toBe('Disponible fines de semana');
      expect(provider.providerProfile.isActive).toBe(true);
      expect(provider.roles).toHaveLength(1);
      expect(provider.roles[0].role).toBe('Proveedor');
    });

    it('GET /providers — lists providers with pagination', async () => {
      const { admin } = await setupAdminWithProperty('prov-list');

      await createProvider(admin.accessToken, { firstName: 'Prov1', lastName: 'Uno' });
      await createProvider(admin.accessToken, { firstName: 'Prov2', lastName: 'Dos' });
      await createProvider(admin.accessToken, { firstName: 'Prov3', lastName: 'Tres' });

      const res = await request(app.getHttpServer())
        .get('/api/providers')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(3);
      expect(res.body.meta.total).toBe(3);
      expect(res.body.meta.page).toBe(1);
    });

    it('GET /providers/:id — returns full provider detail', async () => {
      const { admin } = await setupAdminWithProperty('prov-detail');
      const provider = await createProvider(admin.accessToken);

      const res = await request(app.getHttpServer())
        .get(`/api/providers/${provider.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(provider.id);
      expect(res.body.firstName).toBe('Carlos');
      expect(res.body.providerProfile).toBeDefined();
      expect(res.body.providerProfile.rubros).toEqual(['Plomería']);
      expect(res.body.roles).toBeDefined();
    });

    it('PATCH /providers/:id — updates person and profile fields', async () => {
      const { admin } = await setupAdminWithProperty('prov-update');
      const provider = await createProvider(admin.accessToken);

      const res = await request(app.getHttpServer())
        .patch(`/api/providers/${provider.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          firstName: 'Carlos Updated',
          rubros: ['Plomería', 'Gas'],
          coverageZones: ['Buenos Aires', 'Rosario'],
          notes: 'Actualizado',
        })
        .expect(200);

      expect(res.body.firstName).toBe('Carlos Updated');
      expect(res.body.providerProfile.rubros).toEqual(['Plomería', 'Gas']);
      expect(res.body.providerProfile.coverageZones).toEqual(['Buenos Aires', 'Rosario']);
      expect(res.body.providerProfile.notes).toBe('Actualizado');
    });

    it('DELETE /providers/:id — soft deletes provider (deactivates person + profile)', async () => {
      const { admin } = await setupAdminWithProperty('prov-delete');
      const provider = await createProvider(admin.accessToken);

      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/providers/${provider.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(deleteRes.body.deleted).toBe(true);

      // Verify profile is deactivated by checking the list with isActive filter
      const activeList = await request(app.getHttpServer())
        .get('/api/providers')
        .query({ isActive: 'true' })
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(activeList.body.data).toHaveLength(0);
    });

    it('GET /providers/:id — returns 404 for non-existent provider', async () => {
      const { admin } = await setupAdminWithProperty('prov-404');

      await request(app.getHttpServer())
        .get('/api/providers/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(404);
    });
  });

  // ─── Provider Filtering ───────────────────────────

  describe('Provider filtering', () => {
    it('filters by rubro', async () => {
      const { admin } = await setupAdminWithProperty('prov-filter-rubro');

      await createProvider(admin.accessToken, {
        firstName: 'Plomero',
        lastName: 'A',
        rubros: ['Plomería'],
        coverageZones: ['Buenos Aires'],
      });
      await createProvider(admin.accessToken, {
        firstName: 'Electricista',
        lastName: 'B',
        rubros: ['Electricidad'],
        coverageZones: ['Buenos Aires'],
      });

      const res = await request(app.getHttpServer())
        .get('/api/providers')
        .query({ rubro: 'Plomería' })
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].firstName).toBe('Plomero');
    });

    it('filters by coverageZone', async () => {
      const { admin } = await setupAdminWithProperty('prov-filter-zone');

      await createProvider(admin.accessToken, {
        firstName: 'BA',
        lastName: 'Provider',
        rubros: ['Plomería'],
        coverageZones: ['Buenos Aires'],
      });
      await createProvider(admin.accessToken, {
        firstName: 'Rosario',
        lastName: 'Provider',
        rubros: ['Plomería'],
        coverageZones: ['Rosario'],
      });

      const res = await request(app.getHttpServer())
        .get('/api/providers')
        .query({ zone: 'Rosario' })
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].firstName).toBe('Rosario');
    });

    it('GET /providers/for-ticket/:ticketId — returns providers matching ticket rubro and zone', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('prov-for-ticket');

      // Create category matching the rubro
      const category = await createCategory(admin.accessToken, 'Plomería');

      // Create ticket with this category (property city is 'Buenos Aires' from payload)
      const ticket = await createTicket(admin.accessToken, propertyId, {
        categoryId: category.id,
      });

      // Create matching provider (rubro='Plomería', zone='Buenos Aires')
      await createProvider(admin.accessToken, {
        firstName: 'Matching',
        lastName: 'Plomero',
        rubros: ['Plomería'],
        coverageZones: ['Buenos Aires'],
      });

      // Create non-matching provider (different rubro)
      await createProvider(admin.accessToken, {
        firstName: 'Wrong',
        lastName: 'Electricista',
        rubros: ['Electricidad'],
        coverageZones: ['Buenos Aires'],
      });

      // Create non-matching provider (different zone)
      await createProvider(admin.accessToken, {
        firstName: 'Wrong',
        lastName: 'Zone',
        rubros: ['Plomería'],
        coverageZones: ['Rosario'],
      });

      const res = await request(app.getHttpServer())
        .get(`/api/providers/for-ticket/${ticket.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      // El rubro y la zona ordenan la lista, no la recortan: el que coincide en
      // los dos va primero, pero los demás siguen disponibles para asignar.
      expect(res.body).toHaveLength(3);
      expect(res.body[0].firstName).toBe('Matching');
      expect(res.body[0].providerProfile.rubros).toContain('Plomería');
      expect(res.body[0].providerProfile.coverageZones).toContain('Buenos Aires');
    });
  });

  // ─── Ticket Provider Assignment ───────────────────

  describe('Ticket provider assignment', () => {
    it('POST /tickets/:id/assign-provider — assigns provider and transitions to ProveedorAsignado', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('prov-assign');

      const provider = await createProvider(admin.accessToken);

      // Create ticket and move to EnProgreso (required for provider assignment)
      const ticket = await createTicket(admin.accessToken, propertyId);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.Asignado);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.EnProgreso);

      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/assign-provider`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          providerId: provider.id,
          providerNotes: 'Urgente — revisar caño principal',
        })
        .expect(200);

      expect(res.body.status).toBe(TicketStatus.ProveedorAsignado);
      expect(res.body.provider).toBeDefined();
      expect(res.body.provider.id).toBe(provider.id);
      expect(res.body.provider.firstName).toBe('Carlos');
    });

    it('assign-provider sets providerId on ticket', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('prov-assign-set');

      const provider = await createProvider(admin.accessToken);

      const ticket = await createTicket(admin.accessToken, propertyId);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.Asignado);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.EnProgreso);

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/assign-provider`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ providerId: provider.id })
        .expect(200);

      // Verify via ticket detail
      const detail = await request(app.getHttpServer())
        .get(`/api/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(detail.body.provider).toBeDefined();
      expect(detail.body.provider.id).toBe(provider.id);
      expect(detail.body.status).toBe(TicketStatus.ProveedorAsignado);
    });

    it('rejects assign-provider for non-existent provider', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('prov-assign-bad');

      const ticket = await createTicket(admin.accessToken, propertyId);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.Asignado);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.EnProgreso);

      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/assign-provider`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ providerId: '00000000-0000-0000-0000-000000000000' })
        .expect(404);

      expect(res.body.error).toBe('PROVIDER_NOT_FOUND');
    });

    it('allows assign-provider straight from Abierto', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('prov-assign-abierto');

      const provider = await createProvider(admin.accessToken);

      // Asignar el proveedor es justamente lo que saca al ticket de Abierto:
      // exigir un paso intermedio dejaba al operador sin forma de avanzarlo.
      const ticket = await createTicket(admin.accessToken, propertyId);

      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/assign-provider`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ providerId: provider.id })
        .expect(200);

      expect(res.body.status).toBe(TicketStatus.ProveedorAsignado);
      expect(res.body.provider.id).toBe(provider.id);
    });

    it('rejects assign-provider from a terminal status', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('prov-assign-invalid');

      const provider = await createProvider(admin.accessToken);

      const ticket = await createTicket(admin.accessToken, propertyId);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.Cancelado);

      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/assign-provider`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ providerId: provider.id })
        .expect(400);

      expect(res.body.error).toBe('INVALID_TRANSITION');
    });
  });

  // ─── Provider State Transitions ───────────────────

  describe('Provider state transitions', () => {
    it('full provider flow: EnProgreso → ProveedorAsignado → ProveedorEnCamino → TrabajoRealizado → Resuelto', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('prov-flow');

      const provider = await createProvider(admin.accessToken);

      const ticket = await createTicket(admin.accessToken, propertyId);
      // Abierto → Asignado → EnProgreso
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.Asignado);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.EnProgreso);

      // EnProgreso → ProveedorAsignado (via assign-provider)
      const assigned = await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/assign-provider`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ providerId: provider.id })
        .expect(200);
      expect(assigned.body.status).toBe(TicketStatus.ProveedorAsignado);

      // ProveedorAsignado → ProveedorEnCamino
      const enCamino = await transitionTicket(
        admin.accessToken,
        ticket.id,
        TicketStatus.ProveedorEnCamino,
      );
      expect(enCamino.status).toBe(TicketStatus.ProveedorEnCamino);

      // ProveedorEnCamino → TrabajoRealizado
      const trabajoRealizado = await transitionTicket(
        admin.accessToken,
        ticket.id,
        TicketStatus.TrabajoRealizado,
      );
      expect(trabajoRealizado.status).toBe(TicketStatus.TrabajoRealizado);

      // TrabajoRealizado → Resuelto
      const resuelto = await transitionTicket(
        admin.accessToken,
        ticket.id,
        TicketStatus.Resuelto,
      );
      expect(resuelto.status).toBe(TicketStatus.Resuelto);
      expect(resuelto.resolvedAt).toBeDefined();
    });

    it('rejects invalid provider transition (ProveedorAsignado → Resuelto)', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('prov-invalid-trans');

      const provider = await createProvider(admin.accessToken);

      const ticket = await createTicket(admin.accessToken, propertyId);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.Asignado);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.EnProgreso);

      // Assign provider
      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/assign-provider`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ providerId: provider.id })
        .expect(200);

      // ProveedorAsignado → Resuelto should fail
      const res = await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/transition`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ status: TicketStatus.Resuelto })
        .expect(400);

      expect(res.body.error).toBe('INVALID_TRANSITION');
      expect(res.body.validTransitions).toContain(TicketStatus.ProveedorEnCamino);
      expect(res.body.validTransitions).toContain(TicketStatus.EnProgreso);
      expect(res.body.validTransitions).toContain(TicketStatus.Cancelado);
    });

    it('cancel from ProveedorAsignado state', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('prov-cancel');

      const provider = await createProvider(admin.accessToken);

      const ticket = await createTicket(admin.accessToken, propertyId);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.Asignado);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.EnProgreso);

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/assign-provider`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ providerId: provider.id })
        .expect(200);

      // ProveedorAsignado → Cancelado should succeed
      const cancelled = await transitionTicket(
        admin.accessToken,
        ticket.id,
        TicketStatus.Cancelado,
      );
      expect(cancelled.status).toBe(TicketStatus.Cancelado);
    });

    it('return to EnProgreso from ProveedorAsignado (reassign flow)', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('prov-reassign');

      const provider = await createProvider(admin.accessToken);

      const ticket = await createTicket(admin.accessToken, propertyId);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.Asignado);
      await transitionTicket(admin.accessToken, ticket.id, TicketStatus.EnProgreso);

      await request(app.getHttpServer())
        .post(`/api/tickets/${ticket.id}/assign-provider`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ providerId: provider.id })
        .expect(200);

      // ProveedorAsignado → EnProgreso (e.g. to reassign a different provider)
      const backToProgress = await transitionTicket(
        admin.accessToken,
        ticket.id,
        TicketStatus.EnProgreso,
      );
      expect(backToProgress.status).toBe(TicketStatus.EnProgreso);
    });
  });

  // ─── Cost Tracking ────────────────────────────────

  describe('Cost tracking', () => {
    it('PATCH /tickets/:id/cost — sets cost fields on ticket', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('cost-set');

      const ticket = await createTicket(admin.accessToken, propertyId);

      const res = await request(app.getHttpServer())
        .patch(`/api/tickets/${ticket.id}/cost`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          costAmount: 15000.50,
          costCurrency: Currency.ARS,
          costPayer: 'Propietario',
        })
        .expect(200);

      expect(parseFloat(res.body.costAmount)).toBeCloseTo(15000.50, 1);
      expect(res.body.costCurrency).toBe(Currency.ARS);
      expect(res.body.costPayer).toBe('Propietario');
    });

    it('PATCH /tickets/:id/cost — updates existing cost fields', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('cost-update');

      const ticket = await createTicket(admin.accessToken, propertyId);

      // Set initial cost
      await request(app.getHttpServer())
        .patch(`/api/tickets/${ticket.id}/cost`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          costAmount: 5000,
          costCurrency: Currency.ARS,
          costPayer: 'Inquilino',
        })
        .expect(200);

      // Update cost
      const updated = await request(app.getHttpServer())
        .patch(`/api/tickets/${ticket.id}/cost`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          costAmount: 7500,
          costPayer: 'Propietario',
        })
        .expect(200);

      expect(parseFloat(updated.body.costAmount)).toBeCloseTo(7500, 1);
      expect(updated.body.costPayer).toBe('Propietario');
    });

    it('PATCH /tickets/:id/cost — clears cost fields with null', async () => {
      const { admin, propertyId } = await setupAdminWithProperty('cost-clear');

      const ticket = await createTicket(admin.accessToken, propertyId);

      // Set cost
      await request(app.getHttpServer())
        .patch(`/api/tickets/${ticket.id}/cost`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          costAmount: 10000,
          costCurrency: Currency.USD,
          costPayer: 'Consorcio',
        })
        .expect(200);

      // Clear cost
      const cleared = await request(app.getHttpServer())
        .patch(`/api/tickets/${ticket.id}/cost`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          costAmount: null,
          costCurrency: null,
          costPayer: null,
        })
        .expect(200);

      expect(cleared.body.costAmount).toBeNull();
      expect(cleared.body.costCurrency).toBeNull();
      expect(cleared.body.costPayer).toBeNull();
    });
  });

  // ─── Tenant Isolation ─────────────────────────────

  describe('Tenant isolation', () => {
    it('tenant A providers not visible to tenant B', async () => {
      // Tenant A
      const tenantA = await registerUser(app, {
        email: 'admin@tenant-a-prov.com',
        password: 'Password123!',
        firstName: 'TenantA',
        lastName: 'Admin',
      });

      await createProvider(tenantA.accessToken, {
        firstName: 'ProvA',
        lastName: 'TenantA',
        rubros: ['Plomería'],
        coverageZones: ['Buenos Aires'],
      });

      // Tenant B
      const tenantB = await registerUser(app, {
        email: 'admin@tenant-b-prov.com',
        password: 'Password123!',
        firstName: 'TenantB',
        lastName: 'Admin',
      });

      await createProvider(tenantB.accessToken, {
        firstName: 'ProvB',
        lastName: 'TenantB',
        rubros: ['Electricidad'],
        coverageZones: ['Rosario'],
      });

      // Tenant B lists — should only see their own
      const listB = await request(app.getHttpServer())
        .get('/api/providers')
        .set('Authorization', `Bearer ${tenantB.accessToken}`)
        .expect(200);

      expect(listB.body.data).toHaveLength(1);
      expect(listB.body.data[0].firstName).toBe('ProvB');

      // Tenant A lists — should only see their own
      const listA = await request(app.getHttpServer())
        .get('/api/providers')
        .set('Authorization', `Bearer ${tenantA.accessToken}`)
        .expect(200);

      expect(listA.body.data).toHaveLength(1);
      expect(listA.body.data[0].firstName).toBe('ProvA');
    });

    it('tenant A cannot access tenant B provider by ID', async () => {
      // Tenant A
      const tenantA = await registerUser(app, {
        email: 'admin@iso-a-detail.com',
        password: 'Password123!',
        firstName: 'TenantA',
        lastName: 'Admin',
      });

      // Tenant B
      const tenantB = await registerUser(app, {
        email: 'admin@iso-b-detail.com',
        password: 'Password123!',
        firstName: 'TenantB',
        lastName: 'Admin',
      });

      const provB = await createProvider(tenantB.accessToken, {
        firstName: 'Secret',
        lastName: 'ProviderB',
      });

      // Tenant A tries to access Tenant B's provider
      await request(app.getHttpServer())
        .get(`/api/providers/${provB.id}`)
        .set('Authorization', `Bearer ${tenantA.accessToken}`)
        .expect(404);
    });
  });

  // ─── RBAC ─────────────────────────────────────────

  describe('RBAC enforcement', () => {
    it('Lectura role cannot create providers', async () => {
      const { admin, tenantId } = await setupAdminWithProperty('rbac-prov-lectura');

      await createUserDirect(prisma, tenantId, {
        email: 'lectura@rbac-prov.com',
        password: 'Password123!',
        firstName: 'Lectura',
        lastName: 'User',
        role: UserRole.Lectura,
      });
      const lectura = await loginUser(app, 'lectura@rbac-prov.com', 'Password123!');

      await request(app.getHttpServer())
        .post('/api/providers')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({
          firstName: 'Should',
          lastName: 'Fail',
          rubros: ['Plomería'],
          coverageZones: ['Buenos Aires'],
        })
        .expect(403);
    });

    it('Lectura role can list providers but cannot delete', async () => {
      const { admin, tenantId } = await setupAdminWithProperty('rbac-prov-read');

      const provider = await createProvider(admin.accessToken);

      await createUserDirect(prisma, tenantId, {
        email: 'lectura@rbac-prov-read.com',
        password: 'Password123!',
        firstName: 'Lectura',
        lastName: 'User',
        role: UserRole.Lectura,
      });
      const lectura = await loginUser(app, 'lectura@rbac-prov-read.com', 'Password123!');

      // Lectura CAN list providers
      const list = await request(app.getHttpServer())
        .get('/api/providers')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(200);

      expect(list.body.data).toHaveLength(1);

      // Lectura CANNOT delete providers
      await request(app.getHttpServer())
        .delete(`/api/providers/${provider.id}`)
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(403);
    });
  });
});
