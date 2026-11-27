'use client';

import type { IconName } from '@/components/ui/icon';
import { useOptionalAuth } from '@/lib/auth-context';
import type { ReadResource } from '@realfy/shared';
import { can, type Action } from '@/lib/permissions';
import { useReadAccess, type ReadAccess } from '@/lib/read-access';

export interface NavItem {
  /** Translation key under the `nav` namespace. */
  key: string;
  href: string;
  icon: IconName;
  /**
   * Acción de `lib/permissions` que habilita el ítem. Sin acción, lo ven todos
   * los roles del personal (cada pantalla ya decide qué ofrece según el rol).
   */
  action?: Action;
  /** Recurso sensible: el ítem se oculta a los roles que la política de lectura de la inmobiliaria no deja leerlo. */
  readResource?: ReadResource;
  /** Contador a la derecha del nombre (la bandeja de consultas y las boletas en revisión). */
  badge?: 'inbox' | 'billReview';
}

export interface NavSection {
  /** Translation key under `nav.sections`. */
  key: string;
  items: NavItem[];
}

/**
 * Single source of truth for the primary navigation, grouped by what an agency
 * does day to day. The desktop sidebar, the icon rail, the mobile drawer and
 * the login → panel transition all read this list, so none of them can drift
 * in grouping, order or iconography.
 */
export const navSections: NavSection[] = [
  {
    key: 'home',
    items: [
      { key: 'dashboard', href: '/dashboard', icon: 'dashboard' },
      { key: 'followUps', href: '/vencimientos', icon: 'calendarClock' },
      { key: 'notifications', href: '/notifications', icon: 'bell' },
    ],
  },
  {
    key: 'portfolio',
    items: [
      { key: 'properties', href: '/properties', icon: 'properties' },
      { key: 'persons', href: '/persons', icon: 'persons' },
      { key: 'contracts', href: '/contracts', icon: 'contracts' },
      { key: 'keys', href: '/llaves', icon: 'key', action: 'keys.view' },
    ],
  },
  {
    key: 'commercial',
    items: [
      { key: 'inbox', href: '/bandeja', icon: 'inbox', action: 'inbox.access', badge: 'inbox' },
      { key: 'listings', href: '/publicaciones', icon: 'megaphone' },
      { key: 'leads', href: '/leads', icon: 'leads' },
      { key: 'pipeline', href: '/pipeline', icon: 'pipeline', action: 'pipeline.access' },
      { key: 'sales', href: '/ventas', icon: 'handshake', action: 'sales.view' },
    ],
  },
  {
    key: 'rentals',
    items: [
      { key: 'adjustments', href: '/ajustes', icon: 'percent', action: 'adjustments.manage' },
      { key: 'serviceBills', href: '/boletas', icon: 'utilities', action: 'serviceBills.manage' },
      { key: 'billDocuments', href: '/boletas/recibidas', icon: 'fileInput', action: 'billDocuments.view', badge: 'billReview' },
      { key: 'charges', href: '/cargos', icon: 'listPlus', action: 'charges.manage' },
      { key: 'liquidaciones', href: '/liquidaciones', icon: 'liquidaciones' },
    ],
  },
  {
    key: 'money',
    items: [
      { key: 'pagos', href: '/pagos', icon: 'handCoins' },
      { key: 'cash', href: '/caja', icon: 'wallet', action: 'cash.view' },
      { key: 'delinquency', href: '/delinquency', icon: 'delinquency', action: 'delinquency.view' },
      { key: 'collections', href: '/cobranza', icon: 'phoneOutgoing', action: 'collections.view' },
      { key: 'fees', href: '/honorarios', icon: 'badgePercent', action: 'fees.view' },
      { key: 'invoices', href: '/invoices', icon: 'invoices', readResource: 'invoices' },
    ],
  },
  {
    key: 'owners',
    items: [
      { key: 'owners', href: '/locadores', icon: 'building', action: 'ownerAccounts.view', readResource: 'renditions' },
      {
        key: 'ownerStatements',
        href: '/estados-de-cuenta',
        icon: 'scroll',
        action: 'ownerAccounts.view',
        readResource: 'renditions',
      },
      { key: 'renditions', href: '/renditions', icon: 'renditions', readResource: 'renditions' },
    ],
  },
  {
    key: 'service',
    items: [
      { key: 'tickets', href: '/tickets', icon: 'tickets' },
      { key: 'providers', href: '/providers', icon: 'services' },
      { key: 'messaging', href: '/mensajeria', icon: 'send', action: 'messaging.view' },
    ],
  },
  {
    key: 'admin',
    items: [
      { key: 'reports', href: '/reports', icon: 'reports', action: 'reports.view', readResource: 'reports.financial' },
      { key: 'import', href: '/import', icon: 'import', action: 'settings.manage' },
      { key: 'dataQuality', href: '/calidad-de-datos', icon: 'listChecks', action: 'dataQuality.view' },
      { key: 'users', href: '/configuracion/usuarios', icon: 'team', action: 'users.view' },
      { key: 'permissions', href: '/configuracion/permisos', icon: 'shield', action: 'permissions.manage' },
    ],
  },
];

/** Todos los ítems, en el orden en que se muestran. */
export const navItems: NavItem[] = navSections.flatMap((section) => section.items);

/**
 * Los ítems que el rol puede ver. `access` es lo que la política de lectura le
 * deja leer; sin él (todavía no se consultó) no se oculta nada por recurso.
 */
export function visibleNavItems(
  role: string | null | undefined,
  items: readonly NavItem[] = navItems,
  access?: ReadAccess | null,
): NavItem[] {
  return items.filter(
    (item) =>
      (!item.action || can(role, item.action)) &&
      (!item.readResource || !access || access[item.readResource]),
  );
}

/** Las secciones con los ítems que el rol puede ver; las que quedan vacías no se muestran. */
export function visibleNavSections(
  role: string | null | undefined,
  access?: ReadAccess | null,
  sections: readonly NavSection[] = navSections,
): NavSection[] {
  return sections
    .map((section) => ({ ...section, items: visibleNavItems(role, section.items, access) }))
    .filter((section) => section.items.length > 0);
}

/** Los ítems de navegación del usuario de la sesión. */
export function useVisibleNavItems(): NavItem[] {
  const user = useOptionalAuth()?.user;
  const access = useReadAccess();
  // Sin sesión (la transición de ingreso) no hay política que consultar.
  return visibleNavItems(user?.role, navItems, user ? access : null);
}

/**
 * Las secciones de navegación del usuario de la sesión. `roleOverride` sirve a la
 * transición de ingreso, que se dibuja fuera del proveedor de sesión.
 */
export function useVisibleNavSections(roleOverride?: string): NavSection[] {
  const user = useOptionalAuth()?.user;
  const access = useReadAccess();
  return visibleNavSections(user?.role ?? roleOverride, user ? access : null);
}

/**
 * El ítem de la ruta actual. Si dos ítems encajan (`/boletas` y `/boletas/recibidas`), gana el de la ruta
 * más específica, para que no se marquen los dos a la vez.
 */
export function isNavItemActive(pathname: string, href: string, items: readonly NavItem[] = navItems): boolean {
  const matches = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
  return matches(href) && !items.some((item) => item.href.length > href.length && matches(item.href));
}
