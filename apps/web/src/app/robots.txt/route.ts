import { headers } from 'next/headers';
import { routing } from '@/i18n/routing';
import { buildRobotsTxt, slugForHost } from '@/lib/microsite-host';
import { getSiteContext } from '@/lib/microsite-site';

/**
 * robots.txt. En el dominio propio de un micrositio se indexa todo y se anuncia el sitemap; en el
 * dominio de la aplicación sólo se indexan las páginas públicas `/<idioma>/p/...`, nunca el panel.
 */
export async function GET() {
  const h = await headers();
  const slug = slugForHost(h.get('x-forwarded-host') ?? h.get('host'));
  const site = slug ? await getSiteContext(slug, routing.defaultLocale) : null;
  const body = buildRobotsTxt(routing.locales, site ? { origin: site.origin } : null);
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
