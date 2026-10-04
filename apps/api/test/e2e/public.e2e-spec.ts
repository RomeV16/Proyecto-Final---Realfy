import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  LeadSource,
  PropertyOperationType,
  PropertyState,
  PropertyType,
} from '@realfy/shared';

/**
 * Micrositio publico: se recorre sin sesion, resuelto por el slug de la
 * inmobiliaria, y la consulta del formulario entra como interesado.
 */
describe('Public microsite (e2e)', () => {
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

  async function setupAgency(prefix: string) {
    const user = await registerUser(app, {
      email: `admin@${prefix}.com`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'User',
    });
    // El registro no asigna slug: el micrositio se habilita al configurarlo.
    const slug = `inmobiliaria-${prefix}`;
    await request(app.getHttpServer())
      .patch(`/api/tenants/${user.user.tenantId}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ slug })
      .expect(200);
    return { token: user.accessToken, slug };
  }

  async function createProperty(token: string, title: string, available: boolean) {
    const auth = { Authorization: `Bearer ${token}` };
    const property = await request(app.getHttpServer())
      .post('/api/properties')
      .set(auth)
      .send({
        title,
        type: PropertyType.Departamento,
        street: 'Av. Santa Fe',
        number: '1234',
        city: 'Buenos Aires',
        province: 'CABA',
        area: 65,
        rooms: 2,
        price: 450000,
        currency: 'ARS',
      })
      .expect(201);

    const operation = await request(app.getHttpServer())
      .post(`/api/properties/${property.body.id}/operations`)
      .set(auth)
      .send({ operationType: PropertyOperationType.Alquiler, price: 450000, currency: 'ARS' })
      .expect(201);

    if (available) {
      await request(app.getHttpServer())
        .patch(`/api/properties/${property.body.id}/operations/${operation.body.id}/state`)
        .set(auth)
        .send({ toState: PropertyState.Disponible })
        .expect(200);
    }
    return property.body;
  }

  // ─── Perfil ───────────────────────────────────────────

  it('GET /public/:slug — devuelve el perfil de la inmobiliaria sin sesion', async () => {
    const { slug } = await setupAgency('perfil');

    const res = await request(app.getHttpServer()).get(`/api/public/${slug}`).expect(200);

    expect(res.body.slug).toBe(slug);
    expect(res.body.name).toBeDefined();
  });

  it('GET /public/:slug — responde 404 ante un slug inexistente', async () => {
    const res = await request(app.getHttpServer()).get('/api/public/no-existe').expect(404);
    expect(res.body.error).toBe('TENANT_NOT_FOUND');
  });

  // ─── Catalogo ─────────────────────────────────────────

  it('lista solo las propiedades disponibles de esa inmobiliaria', async () => {
    const agency = await setupAgency('catalogo');
    const other = await setupAgency('catalogo-otra');
    const published = await createProperty(agency.token, 'Dos ambientes en Palermo', true);
    await createProperty(agency.token, 'Borrador sin publicar', false);
    await createProperty(other.token, 'Propiedad de otra inmobiliaria', true);

    const res = await request(app.getHttpServer())
      .get(`/api/public/${agency.slug}/properties`)
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.items[0].id).toBe(published.id);
    expect(res.body.items[0].operationType).toBe(PropertyOperationType.Alquiler);
  });

  it('no muestra la ficha de una propiedad que no esta disponible', async () => {
    const agency = await setupAgency('ficha');
    const draft = await createProperty(agency.token, 'Borrador', false);

    await request(app.getHttpServer())
      .get(`/api/public/${agency.slug}/properties/${draft.id}`)
      .expect(404);
  });

  // ─── Consulta ─────────────────────────────────────────

  it('POST /public/:slug/inquiries — la consulta entra como interesado de la inmobiliaria', async () => {
    const agency = await setupAgency('consulta');
    const property = await createProperty(agency.token, 'Dos ambientes en Palermo', true);

    const inquiry = await request(app.getHttpServer())
      .post(`/api/public/${agency.slug}/inquiries`)
      .send({
        firstName: 'Lucia',
        lastName: 'Gomez',
        email: 'lucia.gomez@correo.com.ar',
        message: 'Quisiera coordinar una visita.',
        propertyId: property.id,
      })
      .expect(201);

    const leads = await request(app.getHttpServer())
      .get('/api/leads')
      .set('Authorization', `Bearer ${agency.token}`)
      .expect(200);

    expect(leads.body.total).toBe(1);
    const lead = leads.body.items[0];
    expect(lead.id).toBe(inquiry.body.id);
    expect(lead.source).toBe(LeadSource.WebInquiry);
    expect(lead.propertyId).toBe(property.id);
  });

  it('rechaza una consulta sin correo ni telefono (400)', async () => {
    const agency = await setupAgency('consulta-invalida');

    const res = await request(app.getHttpServer())
      .post(`/api/public/${agency.slug}/inquiries`)
      .send({ firstName: 'Lucia', lastName: 'Gomez', message: 'Hola' })
      .expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});
