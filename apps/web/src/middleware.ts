import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

// Paths that don't require authentication
const publicPaths = [
  '/auth/login',
  '/auth/register',
  '/auth/accept-invitation',
  '/portal/auth/login',
  '/portal/auth/set-password',
  '/docs',
  '/producto',
  '/casos',
  '/nosotros',
  '/contacto',
  // Vista previa de las pantallas en construccion para la demo.
  // El gating por sesion se reactiva cuando se integre el login del front.
  '/dashboard',
  '/propiedades',
  '/personas',
];

// Only strip a leading segment if it matches a configured locale (or a
// BCP-47-style regional variant like `es-AR`). A naive `[a-z]{2}` would
// chew the first two letters off any path (e.g. `/producto` → `oducto`).
const LOCALE_PREFIX_RE = new RegExp(
  `^/(?:${routing.locales.join('|')})(?:-[A-Z]{2})?(?=/|$)`,
);

function stripLocale(pathname: string): string {
  return pathname.replace(LOCALE_PREFIX_RE, '') || '/';
}

function isPublicPath(pathname: string): boolean {
  const pathWithoutLocale = stripLocale(pathname);
  // Marketing home is the bare locale root — treat as public
  if (pathWithoutLocale === '/') return true;
  return publicPaths.some((p) => pathWithoutLocale.startsWith(p));
}

function isPortalPath(pathname: string): boolean {
  return stripLocale(pathname).startsWith('/portal');
}

export default function middleware(request: NextRequest) {
  // Run next-intl middleware first (locale detection + redirect)
  const response = intlMiddleware(request);
  const { pathname } = request.nextUrl;

  // Skip auth check for public paths
  if (isPublicPath(pathname)) {
    return response;
  }

  // Determine the locale from the URL (only match configured locales) or default
  const LOCALE_CAPTURE_RE = new RegExp(
    `^/((?:${routing.locales.join('|')})(?:-[A-Z]{2})?)(?=/|$)`,
  );
  const locale = pathname.match(LOCALE_CAPTURE_RE)?.[1] || routing.defaultLocale;

  // Portal route: check portalAccessToken
  if (isPortalPath(pathname)) {
    const portalToken =
      request.cookies.get('portalAccessToken')?.value ||
      request.headers.get('authorization')?.replace('Bearer ', '');

    if (!portalToken) {
      const loginUrl = new URL(`/${locale}/portal/auth/login`, request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }

    return response;
  }

  // Staff route: check access_token cookie
  const token =
    request.cookies.get('access_token')?.value ||
    request.cookies.get('accessToken')?.value ||
    request.headers.get('authorization')?.replace('Bearer ', '');

  if (!token) {
    const loginUrl = new URL(`/${locale}/auth/login`, request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Match all pathnames except for
  // - API routes, Next.js internals, static assets
  matcher: '/((?!api|trpc|_next|_vercel|.*\\..*).*)',
};
