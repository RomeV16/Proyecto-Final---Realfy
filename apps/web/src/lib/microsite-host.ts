/**
 * Resolución de la inmobiliaria de un micrositio por dominio.
 *
 * Dos configuraciones, las dos por variables de entorno del servidor web:
 * - `MICROSITE_HOST_MAP`: JSON `{"www.inmobiliariademo.com.ar": "inmobiliaria-demo"}`. Un dominio propio por inmobiliaria.
 * - `MICROSITE_BASE_DOMAIN`: `sitios.realfy.app` hace que `<slug>.sitios.realfy.app` resuelva a ese slug.
 *
 * Sin ninguna de las dos, el micrositio sigue entrando por `/<idioma>/p/<slug>`.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;

type Env = Record<string, string | undefined>;

/** Host en minúsculas y sin puerto. */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

/** Lee `MICROSITE_HOST_MAP`; un JSON roto o una entrada inválida se ignoran. */
export function parseHostMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [host, slug] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof slug === 'string' && SLUG_RE.test(slug) && normalizeHost(host)) {
          map.set(normalizeHost(host), slug);
        }
      }
    }
  } catch {
    // Configuración inválida: no se resuelve ningún dominio propio.
  }
  return map;
}

/** El slug del micrositio al que pertenece el host, o null si es el host de la aplicación. */
export function slugForHost(host: string | null | undefined, env: Env = process.env): string | null {
  const h = normalizeHost(host);
  if (!h) return null;

  const mapped = parseHostMap(env.MICROSITE_HOST_MAP);
  const direct = mapped.get(h) ?? mapped.get(h.replace(/^www\./, ''));
  if (direct) return direct;

  const base = normalizeHost(env.MICROSITE_BASE_DOMAIN);
  if (base && h.endsWith(`.${base}`)) {
    const sub = h.slice(0, -(base.length + 1));
    // Un solo nivel: `a.b.sitios.realfy.app` no es un slug.
    if (SLUG_RE.test(sub)) return sub;
  }
  return null;
}

/**
 * Ruta interna a la que se reescribe un pedido hecho al dominio del micrositio, o null si ya
 * es una ruta interna del portal (`/es/p/...`) y no hay que tocarla.
 */
export function micrositeRewritePath(
  pathname: string,
  slug: string,
  locales: readonly string[],
  defaultLocale: string,
): string | null {
  const internal = new RegExp(`^/(?:${locales.join('|')})/p/`);
  if (internal.test(pathname)) return null;
  const rest = pathname === '/' ? '' : pathname.replace(/\/+$/, '');
  return `/${defaultLocale}/p/${slug}${rest}`;
}

/** Escapa lo que va dentro de un nodo de texto XML. */
function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** sitemap.xml del micrositio: la portada y la ficha de cada propiedad publicada. */
export function buildSitemapXml(
  origin: string,
  base: string,
  entries: { id: string; updatedAt?: string | null }[],
): string {
  const urls = [
    `  <url><loc>${xmlEscape(`${origin}${base || '/'}`)}</loc></url>`,
    ...entries.map((e) => {
      const lastmod = e.updatedAt ? `<lastmod>${xmlEscape(new Date(e.updatedAt).toISOString())}</lastmod>` : '';
      return `  <url><loc>${xmlEscape(`${origin}${base}/propiedades/${encodeURIComponent(e.id)}`)}</loc>${lastmod}</url>`;
    }),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/**
 * robots.txt. Con `site` (dominio propio de un micrositio) se permite todo salvo la API y se anuncia el
 * sitemap; sin él (dominio de la aplicación) sólo se permiten las páginas públicas del portal.
 */
export function buildRobotsTxt(locales: readonly string[], site: { origin: string } | null): string {
  if (site) {
    return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${site.origin}/sitemap.xml\n`;
  }
  const allow = locales.map((l) => `Allow: /${l}/p/`).join('\n');
  return `User-agent: *\n${allow}\nDisallow: /\n`;
}
