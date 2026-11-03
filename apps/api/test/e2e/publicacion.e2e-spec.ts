import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { PropertyOperationType, PropertyState, PropertyType } from '@realfy/shared';

/**
 * Publicación: estado por portal en la ficha, aviso para copiar, resumen de lo que falta
 * publicar y micrositio público (sólo lo marcado, sin datos privados, aislado por inmobiliaria).
 */
describe('Publicación (e2e)', () => {
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

  async function setupAgency(prefix: string) {
    const user = await registerUser(app, {
      email: `admin@${prefix}.com`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'User',
    });
    const slug = `inmobiliaria-${prefix}`;
    const auth = { Authorization: `Bearer ${user.accessToken}` };
    await request(app.getHttpServer())
      .patch(`/api/tenants/${user.user.tenantId}`)
      .set(auth)
      .send({ slug })
      .expect(200);
    return { auth, slug, tenantId: user.user.tenantId as string };
  }

  async function createProperty(
    auth: Record<string, string>,
    over: Record<string, unknown> = {},
    state: PropertyState | null = PropertyState.Disponible,
  ) {
    const property = await request(app.getHttpServer())
      .post('/api/properties')
      .set(auth)
      .send({
        title: 'Depto de Juan Pérez (dueño)',
        type: PropertyType.Departamento,
        street: 'Calle Falsa',
        number: '123',
        city: 'Córdoba',
        province: 'Córdoba',
        area: 50,
        rooms: 2,
        bedrooms: 1,
        bathrooms: 1,
        description: 'Luminoso. Llamar al 351 555-1234 o escribir a dueno@correo.test.',
        latitude: -31.4201234,
        longitude: -64.1887654,
        price: 450000,
        currency: 'ARS',
        ...over,
      })
      .expect(201);
    const operation = await request(app.getHttpServer())
      .post(`/api/properties/${property.body.id}/operations`)
      .set(auth)
      .send({ operationType: PropertyOperationType.Alquiler, price: 450000, currency: 'ARS' })
      .expect(201);
    if (state) {
      await request(app.getHttpServer())
        .patch(`/api/properties/${property.body.id}/operations/${operation.body.id}/state`)
        .set(auth)
        .send({ toState: state })
        .expect(200);
    }
    return { id: property.body.id as string, operationId: operation.body.id as string };
  }

  const listing = (portal: string, status: string, extra: Record<string, unknown> = {}) => ({
    operationType: 'Alquiler',
    portal,
    status,
    ...extra,
  });

  // ─── Estado por portal ────────────────────────────────

  it('CP-720 guarda y devuelve el estado de la propiedad en cada portal', async () => {
    const { auth } = await setupAgency('portales');
    const { id } = await createProperty(auth);

    const saved = await request(app.getHttpServer())
      .put(`/api/properties/${id}/listings`)
      .set(auth)
      .send({
        listings: [
          listing('zonaprop', 'Publicado', {
            externalUrl: 'https://www.zonaprop.test/aviso-1',
            externalCode: '1',
            expiresAt: '2099-01-01T00:00:00.000Z',
          }),
          listing('lavoz', 'Pausado'),
        ],
      })
      .expect(200);

    expect(saved.body.portals.map((p: { key: string }) => p.key)).toEqual([
      'micrositio',
      'zonaprop',
      'argenprop',
      'mercadolibre',
      'lavoz',
    ]);
    const zonaprop = saved.body.listings.find((l: { portal: string }) => l.portal === 'zonaprop');
    expect(zonaprop).toMatchObject({
      status: 'Publicado',
      effectiveStatus: 'Publicado',
      externalCode: '1',
      updatedBy: 'Admin User',
    });
    expect(zonaprop.publishedAt).toBeTruthy();

    const read = await request(app.getHttpServer()).get(`/api/properties/${id}/listings`).set(auth).expect(200);
    expect(read.body.listings).toHaveLength(2);
  });

  it('CP-720 rechaza un portal desconocido, una url no http y publicar una operación no disponible', async () => {
    const { auth } = await setupAgency('rechazos');
    const available = await createProperty(auth);
    const draft = await createProperty(auth, {}, null);

    await request(app.getHttpServer())
      .put(`/api/properties/${available.id}/listings`)
      .set(auth)
      .send({ listings: [listing('inexistente', 'Pausado')] })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/api/properties/${available.id}/listings`)
      .set(auth)
      .send({ listings: [listing('zonaprop', 'Publicado', { externalUrl: 'javascript:alert(1)' })] })
      .expect(400);
    const res = await request(app.getHttpServer())
      .put(`/api/properties/${draft.id}/listings`)
      .set(auth)
      .send({ listings: [listing('zonaprop', 'Publicado')] })
      .expect(409);
    expect(res.body.error).toBe('OPERATION_NOT_PUBLISHABLE');
  });

  it('CP-721 no deja tocar los avisos de una propiedad de otra inmobiliaria', async () => {
    const a = await setupAgency('aislamiento-a');
    const b = await setupAgency('aislamiento-b');
    const { id } = await createProperty(a.auth);

    await request(app.getHttpServer()).get(`/api/properties/${id}/listings`).set(b.auth).expect(404);
    await request(app.getHttpServer())
      .put(`/api/properties/${id}/listings`)
      .set(b.auth)
      .send({ listings: [listing('micrositio', 'Publicado')] })
      .expect(404);
    await request(app.getHttpServer()).get(`/api/properties/${id}/ad-copy`).set(b.auth).expect(404);
  });

  it('CP-722 PUT /listings/portals configura los portales y GET los devuelve', async () => {
    const { auth } = await setupAgency('config');
    const res = await request(app.getHttpServer())
      .put('/api/listings/portals')
      .set(auth)
      .send({
        portals: [{ key: 'portal-nuevo', name: 'Portal nuevo', urlTemplate: 'https://p.test/{code}' }],
        hideExactAddress: false,
        showMap: true,
        expiryWarnDays: 10,
      })
      .expect(200);
    expect(res.body.catalog.map((p: { key: string }) => p.key)).toEqual(['micrositio', 'portal-nuevo']);

    const read = await request(app.getHttpServer()).get('/api/listings/portals').set(auth).expect(200);
    expect(read.body).toMatchObject({ hideExactAddress: false, showMap: true, expiryWarnDays: 10 });

    // El formulario de valores por defecto no manda la publicación: no la borra.
    const defaults = await request(app.getHttpServer()).get('/api/tenants/me/operational-defaults').set(auth).expect(200);
    const withoutPublication = { ...defaults.body };
    delete withoutPublication.publication;
    await request(app.getHttpServer())
      .put('/api/tenants/me/operational-defaults')
      .set(auth)
      .send(withoutPublication)
      .expect(200);
    const after = await request(app.getHttpServer()).get('/api/listings/portals').set(auth).expect(200);
    expect(after.body.showMap).toBe(true);
  });

  // ─── Resumen ──────────────────────────────────────────

  it('CP-723 el resumen marca lo que falta publicar, lo que vence y lo que hay que bajar', async () => {
    const { auth, tenantId } = await setupAgency('resumen');
    const unpublished = await createProperty(auth, { title: 'Sin publicar' });
    const expiring = await createProperty(auth, { title: 'Por vencer' });
    const rented = await createProperty(auth, { title: 'Ya alquilada' });
    const expired = await createProperty(auth, { title: 'Vencida' });

    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    for (const [p, extra] of [
      [expiring, { expiresAt: soon }],
      [rented, {}],
      [expired, {}],
    ] as const) {
      await request(app.getHttpServer())
        .put(`/api/properties/${p.id}/listings`)
        .set(auth)
        .send({ listings: [listing('zonaprop', 'Publicado', extra)] })
        .expect(200);
    }
    // La operación se alquila y a otra se le pasa la fecha, por fuera de la API.
    await prisma.baseClient.propertyOperation.update({
      where: { id: rented.operationId },
      data: { state: PropertyState.Alquilado },
    });
    await prisma.baseClient.propertyListing.updateMany({
      where: { propertyId: expired.id },
      data: { expiresAt: new Date(Date.now() - 86_400_000) },
    });

    const overview = await request(app.getHttpServer()).get('/api/listings/overview').set(auth).expect(200);
    expect(overview.body.notPublished.map((r: { propertyId: string }) => r.propertyId)).toEqual(
      expect.arrayContaining([unpublished.id, expired.id]),
    );
    expect(overview.body.expiring.map((r: { propertyId: string }) => r.propertyId)).toEqual([expiring.id]);
    expect(overview.body.expired.map((r: { propertyId: string }) => r.propertyId)).toEqual([expired.id]);
    expect(overview.body.shouldPause.map((r: { propertyId: string }) => r.propertyId)).toEqual([rented.id]);

    const paused = await request(app.getHttpServer()).post('/api/listings/pause-unavailable').set(auth).expect(201);
    expect(paused.body).toEqual({ paused: 1 });
    const row = await prisma.baseClient.propertyListing.findFirst({ where: { propertyId: rented.id, tenantId } });
    expect(row?.status).toBe('Pausado');
  });

  // ─── Aviso para copiar ────────────────────────────────

  it('CP-724 el aviso no lleva dueño, teléfono, mail ni dirección exacta', async () => {
    const { auth } = await setupAgency('aviso');
    const { id } = await createProperty(auth);

    const res = await request(app.getHttpServer())
      .get(`/api/properties/${id}/ad-copy`)
      .query({ portal: 'zonaprop', operation: 'Alquiler' })
      .set(auth)
      .expect(200);

    const text = `${res.body.title}\n${res.body.description}`;
    expect(res.body.title).toBe('Departamento 2 ambientes 50 m² en alquiler - Córdoba');
    expect(text).not.toMatch(/Juan|Pérez|555|@|Calle Falsa|123/);
    expect(res.body.description).toContain('Precio: ARS 450.000 por mes.');
    expect(res.body.warnings).toEqual(expect.arrayContaining(['contact_data_removed', 'no_photos']));
    expect(res.body.limits.title).toBe(70);

    await request(app.getHttpServer())
      .get(`/api/properties/${id}/ad-copy`)
      .query({ portal: 'no-existe' })
      .set(auth)
      .expect(400);
  });

  // ─── Micrositio ───────────────────────────────────────

  async function publishOnMicrosite(auth: Record<string, string>, id: string) {
    await request(app.getHttpServer())
      .put(`/api/properties/${id}/listings`)
      .set(auth)
      .send({ listings: [listing('micrositio', 'Publicado')] })
      .expect(200);
  }

  it('CP-725 el micrositio muestra sólo lo publicado y nunca calle, dueño ni coordenadas por defecto', async () => {
    const agency = await setupAgency('sitio');
    const published = await createProperty(agency.auth);
    const unmarked = await createProperty(agency.auth, { title: 'Disponible sin marcar' });
    await publishOnMicrosite(agency.auth, published.id);

    const list = await request(app.getHttpServer()).get(`/api/public/${agency.slug}/properties`).expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([published.id]);
    expect(list.body.items[0].street).toBeNull();

    const detail = await request(app.getHttpServer())
      .get(`/api/public/${agency.slug}/properties/${published.id}`)
      .expect(200);
    const raw = JSON.stringify(detail.body);
    expect(raw).not.toMatch(/Calle Falsa|latitude|longitude|-31\.42|tenantId|ownerId/);
    expect(detail.body.location).toBeNull();
    expect(detail.body.number).toBeNull();

    await request(app.getHttpServer())
      .get(`/api/public/${agency.slug}/properties/${unmarked.id}`)
      .expect(404);
  });

  it('CP-725 con la dirección y el mapa permitidos los muestra, el mapa redondeado', async () => {
    const agency = await setupAgency('sitio-abierto');
    const { id } = await createProperty(agency.auth);
    await publishOnMicrosite(agency.auth, id);
    await request(app.getHttpServer())
      .put('/api/listings/portals')
      .set(agency.auth)
      .send({ portals: [], hideExactAddress: false, showMap: true })
      .expect(200);

    const detail = await request(app.getHttpServer()).get(`/api/public/${agency.slug}/properties/${id}`).expect(200);
    expect(detail.body.street).toBe('Calle Falsa');
    expect(detail.body.location).toEqual({ lat: -31.42, lng: -64.189 });
  });

  it('CP-725 un aviso pausado, vencido o de una operación que ya no está disponible sale del sitio', async () => {
    const agency = await setupAgency('sitio-baja');
    const { id, operationId } = await createProperty(agency.auth);
    await publishOnMicrosite(agency.auth, id);
    const url = `/api/public/${agency.slug}/properties`;
    expect((await request(app.getHttpServer()).get(url).expect(200)).body.total).toBe(1);

    await prisma.baseClient.propertyListing.updateMany({ where: { propertyId: id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app.getHttpServer()).get(url).expect(200)).body.total).toBe(0);

    await prisma.baseClient.propertyListing.updateMany({ where: { propertyId: id }, data: { expiresAt: null, status: 'Pausado' } });
    expect((await request(app.getHttpServer()).get(url).expect(200)).body.total).toBe(0);

    await prisma.baseClient.propertyListing.updateMany({ where: { propertyId: id }, data: { status: 'Publicado' } });
    expect((await request(app.getHttpServer()).get(url).expect(200)).body.total).toBe(1);
    await prisma.baseClient.propertyOperation.update({ where: { id: operationId }, data: { state: PropertyState.Alquilado } });
    expect((await request(app.getHttpServer()).get(url).expect(200)).body.total).toBe(0);
  });

  it('CP-726 filtra por tipo, zona y rango de precio; no mezcla inmobiliarias', async () => {
    const a = await setupAgency('filtros-a');
    const b = await setupAgency('filtros-b');
    const cheap = await createProperty(a.auth, { city: 'Córdoba' });
    const dear = await createProperty(a.auth, { city: 'Villa Allende', type: PropertyType.Casa });
    const other = await createProperty(b.auth, { city: 'Córdoba' });
    for (const p of [cheap, dear]) await publishOnMicrosite(a.auth, p.id);
    await publishOnMicrosite(b.auth, other.id);
    await prisma.baseClient.propertyOperation.update({ where: { id: dear.operationId }, data: { price: 900000 } });

    const ids = async (qs: string) =>
      (await request(app.getHttpServer()).get(`/api/public/${a.slug}/properties?${qs}`).expect(200)).body.items.map(
        (i: { id: string }) => i.id,
      );
    expect(await ids('')).toEqual(expect.arrayContaining([cheap.id, dear.id]));
    expect(await ids('')).not.toContain(other.id);
    expect(await ids('type=Casa')).toEqual([dear.id]);
    expect(await ids('city=allende')).toEqual([dear.id]);
    expect(await ids('maxPrice=500000')).toEqual([cheap.id]);
    expect(await ids('minPrice=600000')).toEqual([dear.id]);

    // La propiedad de A no se ve ni se consulta desde el sitio de B.
    await request(app.getHttpServer()).get(`/api/public/${b.slug}/properties/${cheap.id}`).expect(404);
    const sitemapB = await request(app.getHttpServer()).get(`/api/public/${b.slug}/sitemap`).expect(200);
    expect(sitemapB.body.items.map((i: { id: string }) => i.id)).toEqual([other.id]);
  });

  it('CP-726 la consulta del formulario entra como interesado y el señuelo la descarta', async () => {
    const agency = await setupAgency('consulta');
    const { id } = await createProperty(agency.auth);
    await publishOnMicrosite(agency.auth, id);
    const url = `/api/public/${agency.slug}/inquiries`;
    const body = {
      firstName: 'Lucía',
      lastName: 'Gómez',
      email: 'lucia.gomez@correo.com.ar',
      message: 'Quisiera coordinar una visita. <script>alert(1)</script>',
      propertyId: id,
    };

    await request(app.getHttpServer()).post(url).send({ ...body, website: 'http://spam.test' }).expect(201);
    const none = await request(app.getHttpServer()).get('/api/leads').set(agency.auth).expect(200);
    expect(none.body.total).toBe(0);

    await request(app.getHttpServer()).post(url).send(body).expect(201);
    const leads = await request(app.getHttpServer()).get('/api/leads').set(agency.auth).expect(200);
    expect(leads.body.total).toBe(1);
    expect(leads.body.items[0]).toMatchObject({ source: 'WebInquiry', propertyId: id });
  });
});
