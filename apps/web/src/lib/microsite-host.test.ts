import { describe, expect, it } from 'vitest';
import {
  buildRobotsTxt,
  buildSitemapXml,
  micrositeRewritePath,
  normalizeHost,
  parseHostMap,
  slugForHost,
} from './microsite-host';

const ENV = {
  MICROSITE_HOST_MAP: JSON.stringify({
    'www.inmobiliariademo.com.ar': 'inmobiliaria-demo',
    'Otra.Inmo.test:8080': 'otra-inmo',
    'roto.test': 'MAL SLUG',
    '': 'vacio',
  }),
  MICROSITE_BASE_DOMAIN: 'sitios.realfy.test',
};

describe('dominio del micrositio', () => {
  it('normaliza el host: minúsculas, sin puerto ni punto final', () => {
    expect(normalizeHost(' Otra.Inmo.test:8080 ')).toBe('otra.inmo.test');
    expect(normalizeHost('x.test.')).toBe('x.test');
    expect(normalizeHost(null)).toBe('');
  });

  it('lee el mapa de dominios e ignora lo inválido', () => {
    expect([...parseHostMap(ENV.MICROSITE_HOST_MAP)]).toEqual([
      ['www.inmobiliariademo.com.ar', 'inmobiliaria-demo'],
      ['otra.inmo.test', 'otra-inmo'],
    ]);
    expect(parseHostMap(undefined).size).toBe(0);
    expect(parseHostMap('{no es json').size).toBe(0);
    expect(parseHostMap('["a"]').size).toBe(0);
  });

  it('resuelve por dominio propio, con o sin www, y por subdominio de la base', () => {
    expect(slugForHost('www.inmobiliariademo.com.ar', ENV)).toBe('inmobiliaria-demo');
    expect(slugForHost('InmobiliariaDemo.com.ar', { MICROSITE_HOST_MAP: '{"inmobiliariademo.com.ar":"inmobiliaria-demo"}' })).toBe(
      'inmobiliaria-demo',
    );
    expect(slugForHost('otra.inmo.test:3000', ENV)).toBe('otra-inmo');
    expect(slugForHost('mi-inmo.sitios.realfy.test', ENV)).toBe('mi-inmo');
  });

  it('el host de la aplicación y los desconocidos no resuelven nada', () => {
    expect(slugForHost('app.realfy.test', ENV)).toBeNull();
    expect(slugForHost('a.b.sitios.realfy.test', ENV)).toBeNull();
    expect(slugForHost('sitios.realfy.test', ENV)).toBeNull();
    expect(slugForHost('roto.test', ENV)).toBeNull();
    expect(slugForHost('', ENV)).toBeNull();
    expect(slugForHost('app.realfy.test', {})).toBeNull();
  });

  it('reescribe las rutas del dominio propio hacia el portal y no toca las internas', () => {
    const locales = ['es', 'en'];
    expect(micrositeRewritePath('/', 'mi-inmo', locales, 'es')).toBe('/es/p/mi-inmo');
    expect(micrositeRewritePath('/propiedades/abc', 'mi-inmo', locales, 'es')).toBe('/es/p/mi-inmo/propiedades/abc');
    expect(micrositeRewritePath('/propiedades/abc/', 'mi-inmo', locales, 'es')).toBe('/es/p/mi-inmo/propiedades/abc');
    expect(micrositeRewritePath('/es/p/mi-inmo/propiedades/abc', 'mi-inmo', locales, 'es')).toBeNull();
    // El panel no es alcanzable por el dominio del micrositio: queda bajo el portal y da 404.
    expect(micrositeRewritePath('/es/auth/login', 'mi-inmo', locales, 'es')).toBe('/es/p/mi-inmo/es/auth/login');
  });
});

describe('sitemap y robots', () => {
  it('arma el sitemap con la portada y cada propiedad, escapando el XML', () => {
    const xml = buildSitemapXml('https://x.test', '/es/p/mi-inmo', [
      { id: 'a&b<c>', updatedAt: '2026-11-01T10:00:00.000Z' },
      { id: 'sin-fecha' },
    ]);
    expect(xml).toContain('<loc>https://x.test/es/p/mi-inmo</loc>');
    expect(xml).toContain('<loc>https://x.test/es/p/mi-inmo/propiedades/a%26b%3Cc%3E</loc><lastmod>2026-11-01T10:00:00.000Z</lastmod>');
    expect(xml).toContain('<loc>https://x.test/es/p/mi-inmo/propiedades/sin-fecha</loc></url>');
    expect(xml).not.toMatch(/<c>|&b</);
  });

  it('en el dominio propio la portada es la raíz', () => {
    expect(buildSitemapXml('https://x.test', '', [])).toContain('<loc>https://x.test/</loc>');
  });

  it('robots: el dominio propio anuncia el sitemap; el de la aplicación sólo deja las páginas públicas', () => {
    expect(buildRobotsTxt(['es', 'en'], { origin: 'https://x.test' })).toBe(
      'User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://x.test/sitemap.xml\n',
    );
    expect(buildRobotsTxt(['es', 'en'], null)).toBe('User-agent: *\nAllow: /es/p/\nAllow: /en/p/\nDisallow: /\n');
  });
});
