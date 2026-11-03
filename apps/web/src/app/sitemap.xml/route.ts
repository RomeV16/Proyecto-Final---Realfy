import { headers } from 'next/headers';
import { routing } from '@/i18n/routing';
import { buildSitemapXml, slugForHost } from '@/lib/microsite-host';
import { getSiteContext } from '@/lib/microsite-site';
import { getPublicSitemap } from '@/lib/public-portal';

/** sitemap.xml en el dominio propio de un micrositio. En el dominio de la aplicación no hay sitemap general. */
export async function GET() {
  const h = await headers();
  const slug = slugForHost(h.get('x-forwarded-host') ?? h.get('host'));
  if (!slug) return new Response('Not found', { status: 404 });

  const site = await getSiteContext(slug, routing.defaultLocale);
  const xml = buildSitemapXml(site.origin, site.base, await getPublicSitemap(slug));
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
