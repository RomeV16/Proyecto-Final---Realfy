import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DEFAULT_OPERATIONAL_DEFAULTS, ListingStatus } from '@realfy/shared';
import { ListingsService, effectiveListingStatus, portalCatalog } from './listings.service';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-03T12:00:00.000Z');
const FUTURE = new Date('2026-12-01T00:00:00.000Z');
const PAST = new Date('2026-10-01T00:00:00.000Z');

function build(opts: { tenantId?: string | null; publication?: Record<string, unknown> } = {}) {
  const publication = { ...DEFAULT_OPERATIONAL_DEFAULTS.publication, ...(opts.publication ?? {}) };
  const property = {
    id: PROPERTY_ID,
    type: 'Departamento',
    description: 'Luminoso. Llamar al 351 555-1234.',
    street: 'Calle Falsa',
    number: '123',
    city: 'Córdoba',
    province: 'Córdoba',
    area: 50,
    rooms: 2,
    bedrooms: 1,
    bathrooms: 1,
    garages: 0,
    age: null,
    orientation: null,
    amenities: ['Balcon'],
    price: 100,
    currency: 'ARS',
    operations: [
      { operationType: 'Alquiler', state: 'Disponible', price: 450000, currency: 'ARS' },
      { operationType: 'Venta', state: 'Borrador', price: null, currency: 'USD' },
    ],
  };
  const tx = {
    propertyListing: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const client = {
    property: { findFirst: jest.fn().mockResolvedValue(property) },
    propertyListing: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    propertyOperation: { findMany: jest.fn().mockResolvedValue([]) },
    propertyMedia: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'm2', url: 'https://cdn.example.com/2.jpg', sortOrder: 1, isPrimary: false },
        { id: 'm1', url: 'https://cdn.example.com/1.jpg', sortOrder: 5, isPrimary: true },
      ]),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const defaultsStore = { value: { ...DEFAULT_OPERATIONAL_DEFAULTS, publication } };
  const defaults = {
    get: jest.fn(async () => defaultsStore.value),
    set: jest.fn(async (_t: string, v: typeof defaultsStore.value) => {
      defaultsStore.value = v;
      return v;
    }),
  };
  const ctx = {
    getTenantId: () => (opts.tenantId === null ? undefined : (opts.tenantId ?? 't1')),
    getUserId: () => 'u1',
  };
  const baseClient = { tenant: { findUnique: jest.fn().mockResolvedValue({ slug: 'mi-inmo' }) } };
  const service = new ListingsService({ client, baseClient } as never, ctx as never, defaults as never);
  return { service, client, tx, defaults, property };
}

describe('ListingsService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => jest.useRealTimers());

  describe('estado vigente', () => {
    it('un aviso publicado con la fecha vencida es un aviso vencido', () => {
      expect(effectiveListingStatus({ status: 'Publicado', expiresAt: PAST }, NOW)).toBe(ListingStatus.Vencido);
      expect(effectiveListingStatus({ status: 'Publicado', expiresAt: FUTURE }, NOW)).toBe(ListingStatus.Publicado);
      expect(effectiveListingStatus({ status: 'Publicado', expiresAt: null }, NOW)).toBe(ListingStatus.Publicado);
      expect(effectiveListingStatus({ status: 'Pausado', expiresAt: PAST }, NOW)).toBe(ListingStatus.Pausado);
    });

    it('el catálogo siempre trae el micrositio primero', () => {
      const catalog = portalCatalog(DEFAULT_OPERATIONAL_DEFAULTS.publication);
      expect(catalog[0]).toMatchObject({ key: 'micrositio', builtin: true });
      expect(catalog.slice(1).every((p) => !p.builtin)).toBe(true);
    });
  });

  it('exige el contexto de la inmobiliaria', async () => {
    const { service } = build({ tenantId: null });
    await expect(service.getPortals()).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('portales', () => {
    it('guarda la configuración sin tocar el resto de los valores por defecto', async () => {
      const { service, defaults } = build();
      const result = await service.updatePortals({
        portals: [{ key: 'zonaprop', name: 'Zonaprop', urlTemplate: 'https://x.test/{code}' }],
        hideExactAddress: false,
        showMap: true,
        expiryWarnDays: 10,
      });
      expect(result.catalog.map((p) => p.key)).toEqual(['micrositio', 'zonaprop']);
      const saved = defaults.set.mock.calls[0][1];
      expect(saved.publication).toMatchObject({ hideExactAddress: false, showMap: true, expiryWarnDays: 10 });
      expect(saved.dueDay).toBe(DEFAULT_OPERATIONAL_DEFAULTS.dueDay);
    });

    it('rechaza una configuración inválida', async () => {
      const { service } = build();
      await expect(service.updatePortals({ portals: [{ key: 'MAL KEY', name: 'x' }] })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('avisos de una propiedad', () => {
    it('lista con el estado vigente, la dirección armada con la plantilla y quién lo cambió', async () => {
      const { service, client } = build({
        publication: {
          portals: [{ key: 'zonaprop', name: 'Zonaprop', urlTemplate: 'https://x.test/aviso/{code}', enabled: true }],
        },
      });
      client.propertyListing.findMany.mockResolvedValue([
        {
          id: 'l1',
          operationType: 'Alquiler',
          portal: 'zonaprop',
          status: 'Publicado',
          externalUrl: null,
          externalCode: 'AB1',
          publishedAt: PAST,
          expiresAt: PAST,
          updatedAt: NOW,
          updatedBy: { firstName: 'Lucía', lastName: 'Demo' },
        },
      ]);
      const result = await service.findForProperty(PROPERTY_ID);
      expect(result.listings[0]).toMatchObject({
        effectiveStatus: 'Vencido',
        status: 'Publicado',
        externalUrl: 'https://x.test/aviso/AB1',
        updatedBy: 'Lucía Demo',
      });
      expect(result.micrositePath).toBe(`/p/mi-inmo/propiedades/${PROPERTY_ID}`);
      expect(result.operations).toEqual([
        { operationType: 'Alquiler', state: 'Disponible' },
        { operationType: 'Venta', state: 'Borrador' },
      ]);
    });

    it('404 si la propiedad no es de la inmobiliaria', async () => {
      const { service, client } = build();
      client.property.findFirst.mockResolvedValue(null);
      await expect(service.findForProperty(PROPERTY_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('crea un aviso publicado con la fecha de publicación de hoy', async () => {
      const { service, tx } = build();
      await service.upsertForProperty(PROPERTY_ID, {
        listings: [{ operationType: 'Alquiler', portal: 'micrositio', status: 'Publicado' }],
      });
      expect(tx.propertyListing.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 't1',
          propertyId: PROPERTY_ID,
          portal: 'micrositio',
          status: 'Publicado',
          publishedAt: NOW,
          updatedByUserId: 'u1',
        }),
      });
    });

    it('actualiza uno existente conservando lo que no se manda', async () => {
      const { service, tx } = build();
      tx.propertyListing.findFirst.mockResolvedValue({
        id: 'l1',
        externalUrl: 'https://x.test/a',
        externalCode: 'AB1',
        publishedAt: PAST,
        expiresAt: FUTURE,
      });
      await service.upsertForProperty(PROPERTY_ID, {
        listings: [{ operationType: 'Alquiler', portal: 'zonaprop', status: 'Pausado' }],
      });
      expect(tx.propertyListing.update).toHaveBeenCalledWith({
        where: { id: 'l1' },
        data: expect.objectContaining({
          status: 'Pausado',
          externalUrl: 'https://x.test/a',
          externalCode: 'AB1',
          publishedAt: PAST,
          expiresAt: FUTURE,
        }),
      });
    });

    it('rechaza un portal que no está configurado', async () => {
      const { service } = build();
      await expect(
        service.upsertForProperty(PROPERTY_ID, {
          listings: [{ operationType: 'Alquiler', portal: 'inexistente', status: 'Pausado' }],
        }),
      ).rejects.toMatchObject({ response: { error: 'PORTAL_UNKNOWN' } });
    });

    it('rechaza una operación que la propiedad no tiene', async () => {
      const { service } = build();
      await expect(
        service.upsertForProperty(PROPERTY_ID, {
          listings: [{ operationType: 'Temporario', portal: 'zonaprop', status: 'Pausado' }],
        }),
      ).rejects.toMatchObject({ response: { error: 'OPERATION_NOT_FOUND' } });
    });

    it('no publica una operación que no está disponible', async () => {
      const { service } = build();
      await expect(
        service.upsertForProperty(PROPERTY_ID, {
          listings: [{ operationType: 'Venta', portal: 'zonaprop', status: 'Publicado' }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('no publica en un portal deshabilitado ni con vencimiento en el pasado', async () => {
      const { service } = build({
        publication: { portals: [{ key: 'zonaprop', name: 'Zonaprop', urlTemplate: null, enabled: false }] },
      });
      await expect(
        service.upsertForProperty(PROPERTY_ID, {
          listings: [{ operationType: 'Alquiler', portal: 'zonaprop', status: 'Publicado' }],
        }),
      ).rejects.toMatchObject({ response: { error: 'PORTAL_DISABLED' } });
      await expect(
        service.upsertForProperty(PROPERTY_ID, {
          listings: [
            { operationType: 'Alquiler', portal: 'micrositio', status: 'Publicado', expiresAt: PAST.toISOString() },
          ],
        }),
      ).rejects.toMatchObject({ response: { error: 'EXPIRY_IN_PAST' } });
    });

    it('pausar siempre se puede, aunque la operación ya no esté disponible', async () => {
      const { service, tx } = build();
      await expect(
        service.upsertForProperty(PROPERTY_ID, {
          listings: [{ operationType: 'Venta', portal: 'zonaprop', status: 'Pausado' }],
        }),
      ).resolves.toBeDefined();
      expect(tx.propertyListing.create).toHaveBeenCalled();
    });
  });

  describe('aviso para copiar', () => {
    it('usa la operación disponible, oculta la dirección y no filtra teléfonos', async () => {
      const { service } = build();
      const ad = await service.adCopy(PROPERTY_ID, { portal: 'zonaprop' });
      expect(ad.operationType).toBe('Alquiler');
      expect(ad.portalName).toBe('Zonaprop');
      expect(ad.description).toContain('Precio: ARS 450.000 por mes.');
      expect(ad.description).not.toContain('Calle Falsa');
      expect(ad.description).not.toContain('555');
      expect(ad.photos.map((p) => p.id)).toEqual(['m1', 'm2']);
    });

    it('muestra la dirección sólo si la inmobiliaria lo permite', async () => {
      const { service } = build({ publication: { hideExactAddress: false } });
      const ad = await service.adCopy(PROPERTY_ID, { portal: 'micrositio', operation: 'Alquiler' });
      expect(ad.description).toContain('Calle Falsa 123');
      expect(ad.warnings).toContain('exact_address_shown');
    });

    it('rechaza un portal o una operación inexistentes', async () => {
      const { service } = build();
      await expect(service.adCopy(PROPERTY_ID, { portal: 'nada' })).rejects.toMatchObject({
        response: { error: 'PORTAL_UNKNOWN' },
      });
      await expect(service.adCopy(PROPERTY_ID, { portal: 'zonaprop', operation: 'Temporario' })).rejects.toMatchObject({
        response: { error: 'OPERATION_NOT_FOUND' },
      });
    });
  });

  describe('resumen', () => {
    function arrange(h: ReturnType<typeof build>) {
      const listing = (id: string, over: Record<string, unknown>) => ({
        id,
        propertyId: `p-${id}`,
        operationType: 'Alquiler',
        portal: 'zonaprop',
        status: 'Publicado',
        expiresAt: null,
        externalUrl: null,
        property: { title: `Prop ${id}`, isActive: true },
        ...over,
      });
      h.client.propertyListing.findMany.mockResolvedValue([
        listing('ok', {}),
        listing('pronto', { expiresAt: new Date('2026-11-06T00:00:00.000Z') }),
        listing('lejos', { expiresAt: FUTURE }),
        listing('vencido', { expiresAt: PAST }),
        listing('alquilado', {}),
        listing('baja', { property: { title: 'Prop baja', isActive: false } }),
        listing('stored', { status: 'Vencido' }),
      ]);
      h.client.propertyOperation.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
        if (args.where.state) {
          return [
            { propertyId: 'p-ok', operationType: 'Alquiler', property: { title: 'Prop ok', type: 'Casa', city: 'X' } },
            { propertyId: 'p-nueva', operationType: 'Venta', property: { title: 'Nueva', type: 'Casa', city: 'Y' } },
            { propertyId: 'p-vencido', operationType: 'Alquiler', property: { title: 'Prop vencido', type: 'Casa', city: 'Z' } },
          ];
        }
        return ['ok', 'pronto', 'lejos', 'vencido', 'baja', 'stored'].map((id) => ({
          propertyId: `p-${id}`,
          operationType: 'Alquiler',
          state: 'Disponible',
        })).concat([{ propertyId: 'p-alquilado', operationType: 'Alquiler', state: 'Alquilado' }]);
      });
    }

    it('separa lo que falta publicar, lo que vence y lo que hay que bajar', async () => {
      const h = build();
      arrange(h);
      const overview = await h.service.overview();
      expect(overview.notPublished.map((r) => r.title)).toEqual(['Nueva', 'Prop vencido']);
      expect(overview.expiring.map((r) => r.listingId)).toEqual(['pronto']);
      expect(overview.expired.map((r) => r.listingId).sort((a, b) => a.localeCompare(b))).toEqual(['stored', 'vencido']);
      expect(overview.shouldPause.map((r) => r.listingId).sort((a, b) => a.localeCompare(b))).toEqual([
        'alquilado',
        'baja',
      ]);
      expect(overview.counts).toEqual({
        notPublished: 2,
        expiring: 1,
        expired: 2,
        shouldPause: 2,
        published: 5,
      });
      expect(overview.perPortal).toEqual([{ portal: 'zonaprop', portalName: 'Zonaprop', count: 5 }]);
    });

    it('pausa los avisos de lo que ya no está disponible', async () => {
      const h = build();
      arrange(h);
      h.client.propertyListing.updateMany.mockResolvedValue({ count: 2 });
      const result = await h.service.pauseUnavailable();
      expect(result).toEqual({ paused: 2 });
      const where = h.client.propertyListing.updateMany.mock.calls[0][0].where;
      expect(where.id.in.sort((a: string, b: string) => a.localeCompare(b))).toEqual(['alquilado', 'baja']);
    });

    it('sin nada que pausar no escribe', async () => {
      const h = build();
      const result = await h.service.pauseUnavailable();
      expect(result).toEqual({ paused: 0 });
      expect(h.client.propertyListing.updateMany).not.toHaveBeenCalled();
    });
  });
});
