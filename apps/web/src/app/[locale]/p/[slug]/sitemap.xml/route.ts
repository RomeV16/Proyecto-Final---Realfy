import { buildSitemapXml } from '@/lib/microsite-host';
import { getSiteContext } from '@/lib/microsite-site';
import { getPublicSitemap, getRealtorProfile } from '@/lib/public-portal';

/** sitemap.xml del micrositio de una inmobiliaria, por la ruta `/<idioma>/p/<slug>/sitemap.xml`. */
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const profile = await getRealtorProfile(slug);
  if (!profile) return new Response('Not found', { status: 404 });

  const site = await getSiteContext(slug, locale);
  const xml = buildSitemapXml(site.origin, site.base, await getPublicSitemap(slug));
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
