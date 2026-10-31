import { routing } from './routing';

const LOCALES: readonly string[] = routing.locales;

/**
 * Locale que muestra la URL actual del navegador. Se usa fuera de React
 * (clientes de API, redirecciones duras) donde no hay hooks de next-intl.
 */
export function currentLocale(pathname?: string): string {
  const path =
    pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  const first = path.split('/')[1];
  return LOCALES.includes(first) ? first : routing.defaultLocale;
}

/** Antepone el locale actual a una ruta interna: `/auth/login` -> `/en/auth/login`. */
export function localizedPath(path: string, pathname?: string): string {
  return `/${currentLocale(pathname)}${path.startsWith('/') ? path : `/${path}`}`;
}
