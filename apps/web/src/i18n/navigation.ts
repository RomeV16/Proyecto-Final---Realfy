import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export { currentLocale, localizedPath } from './locale-path';

/**
 * Navegación consciente del locale: `Link`, `useRouter` y `redirect` agregan el
 * prefijo (`/es`, `/en`) solos, y `usePathname` lo quita. Las rutas internas se
 * escriben siempre sin prefijo: `href="/contracts"`.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
