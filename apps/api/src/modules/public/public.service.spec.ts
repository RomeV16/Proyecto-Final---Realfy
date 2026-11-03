import { DEFAULT_OPERATIONAL_DEFAULTS } from '@realfy/shared';
import { NotFoundException } from '@nestjs/common';
import { PublicService } from './public.service';

const TENANT = 'tenant-a';
const PROP = '11111111-1111-4111-8111-111111111111';

function build(opts: { publication?: Record<string, unknown>; published?: Array<{ propertyId: string; operationType: string }> } = {}) {
  const publication = { ...DEFAULT_OPERATIONAL_DEFAULTS.publication, ...(opts.publication ?? {}) };
  const baseClient = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ operationalDefaults: { publication } }),
    },
    propertyListing: {
      findMany: jest.fn().mockResolvedValue(opts.published ?? [{ propertyId: PROP, operationType: 'Alquiler' }]),
    },
    property: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    pipeline: { findMany: jest.fn().mockResolvedValue([{ id: 'pl', type: 'Alquiler', stages: [{ id: 'st' }] }]) },
    person: {
      findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValue({ tenantId: TENANT }),
      create: jest.fn().mockResolvedValue({ id: 'person' }),
    },
    personRoleAssignment: { upsert: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    lead: { create: jest.fn().mockResolvedValue({ id: 'lead-1' }), count: jest.fn() },
  };
  const inbox = { receive: jest.fn().mockResolvedValue({ conversationId: 'c-1', created: true, reopened: false }) };
  const service = new PublicService({ baseClient } as never, inbox as never);
  return { service, baseClient, inbox };
}

describe('PublicService (micrositio)', () => {
  describe('qué se publica', () => {
    it('sin avisos marcados en el micrositio no lista nada ni consulta propiedades', async () => {
      const { service, baseClient } = build({ published: [] });
      const result = await service.findProperties(TENANT, {});
      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 12 });
      expect(baseClient.property.findMany).not.toHaveBeenCalled();
    });

    it('filtra por inmobiliaria, por aviso publicado y no vencido del portal micrositio', async () => {
      const { service, baseClient } = build();
      await service.findProperties(TENANT, { operation: 'Alquiler', minPrice: '100', maxPrice: '900' });

      const listingWhere = baseClient.propertyListing.findMany.mock.calls[0][0].where;
      expect(listingWhere).toMatchObject({
        tenantId: TENANT,
        portal: 'micrositio',
        status: 'Publicado',
        operationType: 'Alquiler',
      });
      expect(listingWhere.OR[1].expiresAt.gt).toBeInstanceOf(Date);

      const where = baseClient.property.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe(TENANT);
      expect(where.isActive).toBe(true);
      expect(where.operations.some.OR).toEqual([
        {
          operationType: 'Alquiler',
          propertyId: { in: [PROP] },
          state: 'Disponible',
          price: { gte: 100, lte: 900 },
        },
      ]);
    });

    it('el aviso y el estado tienen que ser de la misma operación', async () => {
      const { service, baseClient } = build({
        published: [
          { propertyId: 'a', operationType: 'Alquiler' },
          { propertyId: 'b', operationType: 'Venta' },
          { propertyId: 'c', operationType: 'Alquiler' },
        ],
      });
      await service.findProperties(TENANT, {});
      const clauses = baseClient.property.findMany.mock.calls[0][0].where.operations.some.OR;
      expect(clauses).toHaveLength(2);
      expect(clauses.find((c: any) => c.operationType === 'Alquiler').propertyId.in).toEqual(['a', 'c']);
      expect(clauses.find((c: any) => c.operationType === 'Venta').propertyId.in).toEqual(['b']);
    });
  });

  describe('privacidad', () => {
    it('por defecto no pide calle, altura ni coordenadas', async () => {
      const { service, baseClient } = build();
      await service.findProperties(TENANT, {});
      const select = baseClient.property.findMany.mock.calls[0][0].select;
      expect(select).not.toHaveProperty('street');
      expect(select).not.toHaveProperty('number');
      expect(select).not.toHaveProperty('latitude');
      expect(select).not.toHaveProperty('longitude');
      expect(select).not.toHaveProperty('tenantId');
    });

    it('la ficha no pide calle ni mapa por defecto y 404 si no está publicada', async () => {
      const { service, baseClient } = build();
      await expect(service.findProperty(TENANT, PROP)).rejects.toBeInstanceOf(NotFoundException);
      const select = baseClient.property.findFirst.mock.calls[0][0].select;
      expect(select).not.toHaveProperty('street');
      expect(select).not.toHaveProperty('latitude');
    });

    it('muestra la calle sólo si la inmobiliaria lo permite', async () => {
      const { service, baseClient } = build({ publication: { hideExactAddress: false } });
      await service.findProperties(TENANT, {});
      expect(baseClient.property.findMany.mock.calls[0][0].select.street).toBe(true);
    });

    it('con el mapa permitido devuelve coordenadas redondeadas a unos 100 m', async () => {
      const { service, baseClient } = build({ publication: { showMap: true } });
      baseClient.property.findFirst.mockResolvedValue({
        id: PROP,
        title: 'Depto',
        type: 'Departamento',
        operations: [{ operationType: 'Alquiler', price: 10, currency: 'ARS' }],
        media: [],
        amenities: [],
        latitude: -31.4201234,
        longitude: -64.1887654,
        description: null,
        updatedAt: new Date('2026-11-01T00:00:00Z'),
      });
      const detail = await service.findProperty(TENANT, PROP);
      expect(detail.location).toEqual({ lat: -31.42, lng: -64.189 });
      expect(JSON.stringify(detail)).not.toContain('-31.4201234');
    });
  });

  describe('sitemap', () => {
    it('devuelve sólo ids y fechas de lo publicado', async () => {
      const { service, baseClient } = build();
      baseClient.property.findMany.mockResolvedValue([{ id: PROP, updatedAt: new Date('2026-11-01T00:00:00Z') }]);
      await expect(service.findSitemapEntries(TENANT)).resolves.toEqual({
        items: [{ id: PROP, updatedAt: new Date('2026-11-01T00:00:00Z') }],
      });
      expect(baseClient.property.findMany.mock.calls[0][0].select).toEqual({ id: true, updatedAt: true });
    });

    it('sin nada publicado, vacío', async () => {
      const { service } = build({ published: [] });
      await expect(service.findSitemapEntries(TENANT)).resolves.toEqual({ items: [] });
    });
  });

  describe('consulta del formulario', () => {
    const valid = { firstName: 'Lucía', lastName: 'Gómez', email: 'lucia@correo.test', message: 'Hola' };

    it('el señuelo lleno descarta la consulta y responde como si hubiera entrado', async () => {
      const { service, baseClient } = build();
      const result = await service.createInquiry(TENANT, { ...valid, website: 'http://spam.test' });
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(baseClient.lead.create).not.toHaveBeenCalled();
      expect(baseClient.person.create).not.toHaveBeenCalled();
    });

    it('una consulta válida entra como interesado de la inmobiliaria', async () => {
      const { service, baseClient } = build();
      await expect(service.createInquiry(TENANT, { ...valid, website: '' })).resolves.toEqual({ id: 'lead-1' });
      expect(baseClient.lead.create.mock.calls[0][0].data).toMatchObject({
        tenantId: TENANT,
        source: 'WebInquiry',
        notes: 'Hola',
      });
    });

    it('la consulta también entra en la bandeja (canal Web) junto al interés', async () => {
      const { service, inbox } = build();
      await service.createInquiry(TENANT, { ...valid, website: '' });
      expect(inbox.receive).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({
          channel: 'Web',
          address: 'lucia@correo.test',
          name: 'Lucía Gómez',
          body: 'Hola',
          personId: 'person',
          leadId: 'lead-1',
          relatedType: null,
        }),
      );
    });

    it('sin mail, la bandeja usa el teléfono normalizado como dirección', async () => {
      const { service, inbox } = build();
      await service.createInquiry(TENANT, { firstName: 'A', lastName: 'B', phone: '351 555-0101', message: 'x' });
      expect(inbox.receive.mock.calls[0][1].address).toBe('5493515550101');
    });

    it('si la bandeja falla, el formulario igual responde: la consulta ya quedó como interés', async () => {
      const { service, inbox } = build();
      inbox.receive.mockRejectedValueOnce(new Error('boom'));
      await expect(service.createInquiry(TENANT, { ...valid, website: '' })).resolves.toEqual({ id: 'lead-1' });
    });

    it('descarta el vínculo con una propiedad que no está publicada', async () => {
      const { service, baseClient } = build();
      await service.createInquiry(TENANT, { ...valid, propertyId: PROP });
      expect(baseClient.lead.create.mock.calls[0][0].data.propertyId).toBeNull();
    });

    it('rechaza datos inválidos (Zod)', async () => {
      const { service } = build();
      await expect(service.createInquiry(TENANT, { firstName: 'A', lastName: 'B', message: 'x' })).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        service.createInquiry(TENANT, { ...valid, message: 'x'.repeat(5001) }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
