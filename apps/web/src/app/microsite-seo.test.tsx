// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '@/components/index-data/test-utils';

const { requestHeaders, publicPortal } = vi.hoisted(() => ({
  requestHeaders: { value: new Headers() },
  publicPortal: {
    getRealtorProfile: vi.fn(),
    getPublicProperty: vi.fn(),
    getPublicProperties: vi.fn(),
    getPublicSitemap: vi.fn(),
  },
}));

vi.mock('next/headers', () => ({ headers: async () => requestHeaders.value }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  usePathname: () => '/es/p/mi-inmo',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next-intl/server', async () => {
  const es = (await import('@/i18n/messages/es.json')).default as Record<string, unknown>;
  const lookup = (ns: string | undefined, key: string) =>
    [...(ns ? ns.split('.') : []), ...key.split('.')].reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], es);
  return {
    getTranslations: async (arg?: string | { namespace: string }) => {
      const ns = typeof arg === 'string' ? arg : arg?.namespace;
      const t = (key: string, values: Record<string, string> = {}) =>
        Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, v), String(lookup(ns, key)));
      return Object.assign(t, { has: (key: string) => lookup(ns, key) !== undefined });
    },
  };
});
vi.mock('@/lib/public-portal', () => publicPortal);

import { GET as sitemapByHost } from './sitemap.xml/route';
import { GET as robotsGet } from './robots.txt/route';
import { GET as sitemapBySlug } from './[locale]/p/[slug]/sitemap.xml/route';
import HomePage, { generateMetadata as homeMetadata } from './[locale]/p/[slug]/page';
import DetailPage, { generateMetadata as detailMetadata } from './[locale]/p/[slug]/propiedades/[id]/page';
import { InquiryForm } from '@/components/portal-publico/inquiry-form';
import userEvent from '@testing-library/user-event';
import { PropertyFilters } from '@/components/portal-publico/property-filters';

const PROFILE = { id: 't1', name: 'Inmobiliaria Demo', slug: 'mi-inmo', logoUrl: 'https://cdn.test/logo.png' };
const PROPERTY = {
  id: 'p1',
  title: 'Dos ambientes',
  description: 'Luminoso '.repeat(40),
  media: [
    { url: 'https://cdn.test/a.jpg', sortOrder: 1, isPrimary: false },
    { url: 'https://cdn.test/cover.jpg', sortOrder: 2, isPrimary: true },
  ],
};

function setHost(host: string, extra: Record<string, string> = {}) {
  requestHeaders.value = new Headers({ host, ...extra });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('MICROSITE_HOST_MAP', JSON.stringify({ 'www.mi-inmo.test': 'mi-inmo' }));
  publicPortal.getRealtorProfile.mockResolvedValue(PROFILE);
  publicPortal.getPublicProperty.mockResolvedValue(PROPERTY);
  publicPortal.getPublicSitemap.mockResolvedValue([{ id: 'p1', updatedAt: '2026-11-01T00:00:00.000Z' }]);
  setHost('app.realfy.test', { 'x-forwarded-proto': 'https' });
});

describe('sitemap.xml', () => {
  it('en el dominio propio lista la portada y las fichas con direcciones del dominio', async () => {
    setHost('www.mi-inmo.test', { 'x-forwarded-proto': 'https' });
    const res = await sitemapByHost();
    expect(res.headers.get('content-type')).toContain('application/xml');
    const xml = await res.text();
    expect(xml).toContain('<loc>https://www.mi-inmo.test/</loc>');
    expect(xml).toContain('<loc>https://www.mi-inmo.test/propiedades/p1</loc>');
  });

  it('en el dominio de la aplicación no hay sitemap general', async () => {
    expect((await sitemapByHost()).status).toBe(404);
  });

  it('por la ruta del portal usa el prefijo /idioma/p/slug', async () => {
    const res = await sitemapBySlug(new Request('http://x'), { params: Promise.resolve({ locale: 'es', slug: 'mi-inmo' }) });
    expect(await res.text()).toContain('<loc>https://app.realfy.test/es/p/mi-inmo/propiedades/p1</loc>');
  });

  it('un slug inexistente da 404', async () => {
    publicPortal.getRealtorProfile.mockResolvedValue(null);
    const res = await sitemapBySlug(new Request('http://x'), { params: Promise.resolve({ locale: 'es', slug: 'nada' }) });
    expect(res.status).toBe(404);
  });
});

describe('robots.txt', () => {
  it('en el dominio propio anuncia el sitemap', async () => {
    setHost('www.mi-inmo.test', { 'x-forwarded-proto': 'https' });
    const body = await (await robotsGet()).text();
    expect(body).toContain('Sitemap: https://www.mi-inmo.test/sitemap.xml');
    expect(body).toContain('Allow: /');
  });

  it('en el dominio de la aplicación sólo permite las páginas públicas', async () => {
    const body = await (await robotsGet()).text();
    expect(body).toContain('Allow: /es/p/');
    expect(body).toContain('Disallow: /');
    expect(body).not.toContain('Sitemap');
  });
});

describe('metadatos de las páginas públicas', () => {
  it('la portada trae título, descripción, canónica y OpenGraph', async () => {
    const meta = await homeMetadata({ params: Promise.resolve({ locale: 'es', slug: 'mi-inmo' }) });
    expect(meta.title).toBe('Inmobiliaria Demo · Propiedades en venta y alquiler');
    expect(meta.description).toContain('Inmobiliaria Demo');
    expect(meta.alternates?.canonical).toBe('https://app.realfy.test/es/p/mi-inmo');
    expect(meta.openGraph).toMatchObject({ type: 'website', siteName: 'Inmobiliaria Demo', images: ['https://cdn.test/logo.png'] });
  });

  it('en el dominio propio la canónica es la del dominio', async () => {
    setHost('www.mi-inmo.test', { 'x-forwarded-proto': 'https' });
    const meta = await homeMetadata({ params: Promise.resolve({ locale: 'es', slug: 'mi-inmo' }) });
    expect(meta.alternates?.canonical).toBe('https://www.mi-inmo.test/');
  });

  it('un slug inexistente no da metadatos', async () => {
    publicPortal.getRealtorProfile.mockResolvedValue(null);
    expect(await homeMetadata({ params: Promise.resolve({ locale: 'es', slug: 'nada' }) })).toEqual({});
  });

  it('la ficha usa la portada como imagen y una descripción corta en texto plano', async () => {
    const meta = await detailMetadata({ params: Promise.resolve({ locale: 'es', slug: 'mi-inmo', id: 'p1' }) });
    expect(meta.title).toBe('Dos ambientes · Inmobiliaria Demo');
    expect((meta.description ?? '').length).toBeLessThanOrEqual(160);
    expect(meta.description).toMatch(/…$/);
    expect(meta.alternates?.canonical).toBe('https://app.realfy.test/es/p/mi-inmo/propiedades/p1');
    expect(meta.openGraph).toMatchObject({ images: ['https://cdn.test/cover.jpg'] });
  });

  it('una ficha sin descripción ni fotos usa el texto general', async () => {
    publicPortal.getPublicProperty.mockResolvedValue({ id: 'p1', title: 'Casa', description: null, media: [] });
    const meta = await detailMetadata({ params: Promise.resolve({ locale: 'es', slug: 'mi-inmo', id: 'p1' }) });
    expect(meta.description).toContain('Inmobiliaria Demo');
    expect(meta.openGraph).not.toHaveProperty('images');
  });

  it('una propiedad que no está publicada no da metadatos', async () => {
    publicPortal.getPublicProperty.mockResolvedValue(null);
    expect(await detailMetadata({ params: Promise.resolve({ locale: 'es', slug: 'mi-inmo', id: 'x' }) })).toEqual({});
  });

  it('un host raro no se usa para armar direcciones absolutas', async () => {
    setHost('evil.test/<script>');
    const meta = await homeMetadata({ params: Promise.resolve({ locale: 'es', slug: 'mi-inmo' }) });
    expect(meta.alternates?.canonical).toBe('http://localhost:3000/es/p/mi-inmo');
  });
});

describe('filtros del sitio público', () => {
  it('muestra zona y rango de precio con lo ya filtrado', () => {
    renderEs(
      <PropertyFilters
        initialOperation="Alquiler"
        initialType=""
        initialCity="Córdoba"
        initialMinPrice="100000"
        initialMaxPrice="500000"
      />,
    );
    expect(screen.getByLabelText('Zona')).toHaveValue('Córdoba');
    expect(screen.getByLabelText('Precio desde')).toHaveValue(100000);
    expect(screen.getByLabelText('Precio hasta')).toHaveValue(500000);
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeInTheDocument();
  });
});

describe('páginas del sitio público', () => {
  const listItem = {
    id: 'p1',
    title: 'Dos ambientes',
    type: 'Departamento',
    operationType: 'Alquiler',
    price: 450000,
    currency: 'ARS',
    city: 'Córdoba',
    province: 'Córdoba',
    street: null,
    mediaCount: 0,
  };

  it('la portada pasa los filtros de precio a la API y los conserva en la paginación', async () => {
    publicPortal.getPublicProperties.mockResolvedValue({ items: [listItem], total: 30, page: 1, limit: 12 });
    const ui = await HomePage({
      params: Promise.resolve({ locale: 'es', slug: 'mi-inmo' }),
      searchParams: Promise.resolve({ city: 'Córdoba', minPrice: '100', maxPrice: '900' }),
    });
    renderEs(ui);
    expect(publicPortal.getPublicProperties).toHaveBeenCalledWith(
      'mi-inmo',
      expect.objectContaining({ city: 'Córdoba', minPrice: '100', maxPrice: '900', page: 1 }),
    );
    expect(screen.getByLabelText('Precio desde')).toHaveValue(100);
    const next = screen.getByRole('link', { name: /Siguiente/ });
    expect(next.getAttribute('href')).toContain('minPrice=100');
    expect(next.getAttribute('href')).toContain('maxPrice=900');
    expect(next.getAttribute('href')).toContain('page=2');
  });

  it('la ficha muestra calle y altura sólo si vienen, y el mapa aproximado sólo si viene la ubicación', async () => {
    publicPortal.getPublicProperty.mockResolvedValue({
      ...listItem,
      street: 'Calle Falsa',
      number: '123',
      description: 'Luminoso',
      amenities: [],
      media: [],
      location: { lat: -31.42, lng: -64.189 },
    });
    const ui = await DetailPage({ params: Promise.resolve({ locale: 'es', slug: 'mi-inmo', id: 'p1' }) });
    renderEs(ui);
    expect(screen.getAllByText('Calle Falsa 123, Córdoba, Córdoba').length).toBeGreaterThan(0);
    const map = screen.getByRole('link', { name: 'Ver la zona en el mapa' });
    expect(map.getAttribute('href')).toContain('mlat=-31.42&mlon=-64.189');
    expect(map).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('la ficha sin calle ni ubicación no muestra ninguna de las dos', async () => {
    publicPortal.getPublicProperty.mockResolvedValue({ ...listItem, description: null, amenities: [], media: [], location: null });
    const ui = await DetailPage({ params: Promise.resolve({ locale: 'es', slug: 'mi-inmo', id: 'p1' }) });
    renderEs(ui);
    expect(screen.queryByRole('link', { name: 'Ver la zona en el mapa' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Córdoba, Córdoba').length).toBeGreaterThan(0);
  });
});

describe('formulario de consulta', () => {
  it('manda el señuelo vacío y los datos de la persona; la persona nunca lo ve', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);
    renderEs(<InquiryForm slug="mi-inmo" propertyId="p1" />);

    const trap = document.getElementById('inquiry-website') as HTMLInputElement;
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(trap.tabIndex).toBe(-1);

    await user.type(screen.getByLabelText('Nombre'), 'Lucía');
    await user.type(screen.getByLabelText('Apellido'), 'Gómez');
    await user.type(screen.getByLabelText('Email'), 'lucia@correo.test');
    await user.type(screen.getByLabelText('Mensaje'), 'Quisiera visitarla');
    await user.click(screen.getByRole('button', { name: 'Enviar consulta' }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/public/mi-inmo/inquiries');
    expect(body).toMatchObject({ firstName: 'Lucía', propertyId: 'p1', website: '', email: 'lucia@correo.test' });
    expect(await screen.findByRole('status')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('un bot que completa el señuelo lo manda lleno', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);
    renderEs(<InquiryForm slug="mi-inmo" />);
    await user.type(document.getElementById('inquiry-website') as HTMLInputElement, 'http://spam.test');
    await user.type(screen.getByLabelText('Nombre'), 'Bot');
    await user.type(screen.getByLabelText('Apellido'), 'Bot');
    await user.type(screen.getByLabelText('Email'), 'bot@spam.test');
    await user.type(screen.getByLabelText('Mensaje'), 'comprá ya');
    await user.click(screen.getByRole('button', { name: 'Enviar consulta' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).website).toBe('http://spam.test');
    vi.unstubAllGlobals();
  });
});
