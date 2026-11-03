import { PropertyOperationType, PropertyType } from '../enums';
import { OperationalDefaultsSchema } from '../schemas/operational-defaults.schema';
import {
  adLimitsFor,
  buildAdCopy,
  orderPhotos,
  stripContactData,
  type AdCopyInput,
} from './ad-copy';
import {
  DEFAULT_PORTALS,
  DEFAULT_PUBLICATION_SETTINGS,
  ListingEntrySchema,
  PublicationSettingsSchema,
  UpsertListingsSchema,
  listingUrlFromTemplate,
} from './settings';

const base: AdCopyInput = {
  type: PropertyType.Departamento,
  operationType: PropertyOperationType.Alquiler,
  price: 450000,
  currency: 'ARS',
  city: 'Nueva Córdoba',
  province: 'Córdoba',
  street: 'Av. Hipólito Yrigoyen',
  number: '123',
  area: 45,
  rooms: 2,
  bedrooms: 1,
  bathrooms: 1,
  garages: 1,
  age: 5,
  orientation: 'Norte',
  amenities: ['Pileta', 'Balcon', 'AC'],
  description: 'Luminoso, a pasos del parque.',
  photos: [
    { id: 'b', url: 'https://cdn.example.com/b.jpg', sortOrder: 1, isPrimary: false },
    { id: 'a', url: 'https://cdn.example.com/a.jpg', sortOrder: 0, isPrimary: false },
    { id: 'c', url: 'https://cdn.example.com/c.jpg', sortOrder: 2, isPrimary: true },
  ],
};

describe('aviso optimizado', () => {
  it('arma título y descripción con lo principal primero', () => {
    const ad = buildAdCopy(base, { portal: 'zonaprop', hideExactAddress: true });
    expect(ad.title).toBe('Departamento 2 ambientes 45 m² en alquiler - Nueva Córdoba');
    const lines = ad.description.split('\n');
    expect(lines[0]).toBe('Departamento en alquiler en Nueva Córdoba.');
    expect(lines[1]).toBe('Características: 2 ambientes, 1 dormitorio, 1 baño, 45 m² totales, 1 cochera.');
    expect(ad.description).toContain('Antigüedad: 5 años. Orientación: Norte.');
    expect(ad.description).toContain('Comodidades: Aire acondicionado, Balcón, Pileta.');
    expect(ad.description).toContain('Precio: ARS 450.000 por mes.');
    expect(ad.description).toContain('Luminoso, a pasos del parque.');
  });

  it('es determinista', () => {
    const a = buildAdCopy(base, { portal: 'lavoz', hideExactAddress: true });
    const b = buildAdCopy({ ...base, amenities: [...(base.amenities ?? [])].reverse() }, { portal: 'lavoz', hideExactAddress: true });
    expect(b).toEqual(a);
  });

  it('con la dirección oculta no menciona calle ni altura', () => {
    const ad = buildAdCopy(base, { portal: 'zonaprop', hideExactAddress: true });
    expect(ad.description).toContain('Ubicación: Nueva Córdoba, Córdoba.');
    expect(ad.description).not.toContain('Yrigoyen');
    expect(ad.description).not.toContain('123');
    expect(ad.warnings).not.toContain('exact_address_shown');
  });

  it('con la dirección permitida la incluye y lo avisa', () => {
    const ad = buildAdCopy(base, { portal: 'zonaprop', hideExactAddress: false });
    expect(ad.description).toContain('Ubicación: Av. Hipólito Yrigoyen 123, Nueva Córdoba, Córdoba.');
    expect(ad.warnings).toContain('exact_address_shown');
  });

  it('no usa el título interno de la ficha ni datos de personas', () => {
    const ad = buildAdCopy(
      { ...base, ...({ title: 'Depto de Juan Pérez (dueño)', ownerName: 'Juan Pérez' } as object) },
      { portal: 'zonaprop', hideExactAddress: true },
    );
    expect(ad.title + ad.description).not.toContain('Juan');
  });

  it('saca mails, teléfonos y links del texto libre', () => {
    const ad = buildAdCopy(
      {
        ...base,
        description:
          'Consultas al 351 555-1234 o a dueno@correo.com.ar, o en https://wa.me/5493515551234. Excelente estado.',
      },
      { portal: 'zonaprop', hideExactAddress: true },
    );
    expect(ad.description).not.toMatch(/555|@|wa\.me|https?:/);
    expect(ad.description).toContain('Excelente estado.');
    expect(ad.warnings).toContain('contact_data_removed');
  });

  it('stripContactData no toca un texto sin datos de contacto', () => {
    expect(stripContactData('Cocina equipada y 2 balcones.')).toEqual({
      text: 'Cocina equipada y 2 balcones.',
      removed: false,
    });
  });

  it('respeta el límite del título y acorta sin cortar palabras', () => {
    const ad = buildAdCopy(
      { ...base, city: 'San Lorenzo de la Nueva Ciudad Jardín Norte del Valle' },
      { portal: 'mercadolibre', hideExactAddress: true },
    );
    expect(ad.title.length).toBeLessThanOrEqual(60);
    expect(ad.warnings).toContain('title_shortened');
  });

  it('recorta el texto libre al límite de la descripción pero deja lo estructurado', () => {
    const long = 'Texto largo de la ficha. '.repeat(400);
    const ad = buildAdCopy({ ...base, description: long }, { portal: 'lavoz', hideExactAddress: true });
    expect(ad.description.length).toBeLessThanOrEqual(adLimitsFor('lavoz').description);
    expect(ad.description).toContain('Características:');
    expect(ad.warnings).toContain('description_truncated');
  });

  it('usa los límites por defecto con un portal desconocido', () => {
    expect(adLimitsFor('otro')).toEqual({ title: 70, description: 2000, photos: 20 });
  });

  it('ordena las fotos con la portada primero y marca las que sobran', () => {
    expect(orderPhotos(base.photos ?? []).map((p) => p.id)).toEqual(['c', 'a', 'b']);
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `p${String(i).padStart(2, '0')}`,
      url: `https://cdn.example.com/${i}.jpg`,
      sortOrder: i,
      isPrimary: false,
    }));
    const ad = buildAdCopy({ ...base, photos: many }, { portal: 'lavoz', hideExactAddress: true });
    expect(ad.photos).toHaveLength(20);
    expect(ad.photos[0]).toEqual({ id: 'p00', url: 'https://cdn.example.com/0.jpg', position: 1 });
    expect(ad.omittedPhotos).toBe(5);
    expect(ad.warnings).toContain('photos_over_limit');
  });

  it('avisa si faltan fotos o precio', () => {
    const ad = buildAdCopy({ ...base, photos: [], price: null }, { portal: 'zonaprop', hideExactAddress: true });
    expect(ad.warnings).toEqual(expect.arrayContaining(['no_photos', 'no_price']));
    expect(ad.description).not.toContain('Precio');
  });

  it('en una venta el precio no dice "por mes"', () => {
    const ad = buildAdCopy(
      { ...base, operationType: PropertyOperationType.Venta, price: 120000, currency: 'USD' },
      { portal: 'zonaprop', hideExactAddress: true },
    );
    expect(ad.description).toContain('Precio: USD 120.000.');
    expect(ad.title).toContain('en venta');
  });

  it('un terreno sin datos mínimos igual da un aviso válido', () => {
    const ad = buildAdCopy(
      { type: PropertyType.Terreno, operationType: PropertyOperationType.Venta },
      { portal: 'zonaprop', hideExactAddress: true },
    );
    expect(ad.title).toBe('Terreno en venta');
    expect(ad.description).toBe('Terreno en venta.');
  });
});

describe('configuración de publicación', () => {
  it('trae los cuatro portales de la inmobiliaria y privacidad por defecto', () => {
    expect(DEFAULT_PUBLICATION_SETTINGS.portals.map((p) => p.key)).toEqual(
      DEFAULT_PORTALS.map((p) => p.key),
    );
    expect(DEFAULT_PUBLICATION_SETTINGS).toMatchObject({ hideExactAddress: true, showMap: false, expiryWarnDays: 7 });
  });

  it('forma parte de los valores por defecto de la operación', () => {
    expect(OperationalDefaultsSchema.parse({}).publication).toEqual(DEFAULT_PUBLICATION_SETTINGS);
  });

  it('rechaza claves repetidas, el portal propio y plantillas que no son http(s)', () => {
    const portal = { key: 'portal-x', name: 'X' };
    expect(PublicationSettingsSchema.safeParse({ portals: [portal, portal] }).success).toBe(false);
    expect(PublicationSettingsSchema.safeParse({ portals: [{ key: 'micrositio', name: 'M' }] }).success).toBe(false);
    expect(
      PublicationSettingsSchema.safeParse({ portals: [{ ...portal, urlTemplate: 'javascript:alert(1)' }] }).success,
    ).toBe(false);
    expect(
      PublicationSettingsSchema.safeParse({ portals: [{ ...portal, urlTemplate: 'https://x.test/aviso/{code}' }] }).success,
    ).toBe(true);
  });

  it('valida los avisos: url http(s), fechas coherentes y estados conocidos', () => {
    const ok = { operationType: 'Alquiler', portal: 'zonaprop', status: 'Publicado' };
    expect(ListingEntrySchema.safeParse(ok).success).toBe(true);
    expect(ListingEntrySchema.safeParse({ ...ok, externalUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(ListingEntrySchema.safeParse({ ...ok, status: 'Otro' }).success).toBe(false);
    expect(
      ListingEntrySchema.safeParse({ ...ok, publishedAt: '2026-11-10', expiresAt: '2026-11-01' }).success,
    ).toBe(false);
    expect(UpsertListingsSchema.safeParse({ listings: [] }).success).toBe(false);
  });

  it('arma la dirección del aviso con la plantilla del portal', () => {
    expect(listingUrlFromTemplate('https://x.test/aviso/{code}', 'AB 12')).toBe('https://x.test/aviso/AB%2012');
    expect(listingUrlFromTemplate(null, 'AB')).toBeNull();
    expect(listingUrlFromTemplate('https://x.test/{code}', null)).toBeNull();
  });
});
