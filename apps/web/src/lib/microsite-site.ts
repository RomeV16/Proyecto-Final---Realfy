import { headers } from 'next/headers';
import { slugForHost } from '@/lib/microsite-host';

const HOST_RE = /^[a-z0-9.-]+(?::\d{1,5})?$/i;

export interface SiteContext {
  /** `https://dominio` desde el que se está sirviendo el sitio. */
  origin: string;
  /** Prefijo de las rutas públicas: vacío en el dominio propio, `/<idioma>/p/<slug>` en el de la aplicación. */
  base: string;
  /** El pedido llegó por el dominio propio del micrositio. */
  onOwnDomain: boolean;
}

/** Origen y prefijo de rutas del micrositio en este pedido, para canónicas, OpenGraph y sitemap. */
export async function getSiteContext(slug: string, locale: string): Promise<SiteContext> {
  const h = await headers();
  const rawHost = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0].trim();
  const host = HOST_RE.test(rawHost) ? rawHost : 'localhost:3000';
  const forwardedProto = h.get('x-forwarded-proto')?.split(',')[0].trim();
  const proto = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : /^localhost|^127\./.test(host) ? 'http' : 'https';
  const onOwnDomain = slugForHost(host) === slug;
  return { origin: `${proto}://${host}`, base: onOwnDomain ? '' : `/${locale}/p/${slug}`, onOwnDomain };
}
