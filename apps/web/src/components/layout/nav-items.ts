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
}

/**
 * Single source of truth for the primary navigation. The desktop sidebar, the
 * icon rail, the mobile drawer and the login → panel transition all read this
 * list, so none of them can drift in count, order or iconography.
 */
export const navItems: NavItem[] = [
  { key: 'dashboard', href: '/dashboard', icon: 'dashboard' },
  { key: 'properties', href: '/properties', icon: 'properties' },
  { key: 'persons', href: '/persons', icon: 'persons' },
  { key: 'leads', href: '/leads', icon: 'leads' },
  { key: 'pipeline', href: '/pipeline', icon: 'pipeline', action: 'pipeline.access' },
  { key: 'contracts', href: '/contracts', icon: 'contracts' },
  { key: 'liquidaciones', href: '/liquidaciones', icon: 'liquidaciones' },
  { key: 'pagos', href: '/pagos', icon: 'liquidaciones' },
  { key: 'renditions', href: '/renditions', icon: 'renditions', readResource: 'renditions' },
  { key: 'invoices', href: '/invoices', icon: 'invoices', readResource: 'invoices' },
  { key: 'delinquency', href: '/delinquency', icon: 'delinquency', action: 'delinquency.view' },
  { key: 'reports', href: '/reports', icon: 'reports', action: 'reports.view', readResource: 'reports.financial' },
  { key: 'tickets', href: '/tickets', icon: 'tickets' },
  { key: 'providers', href: '/providers', icon: 'providers' },
  { key: 'notifications', href: '/notifications', icon: 'bell' },
  { key: 'import', href: '/import', icon: 'import', action: 'settings.manage' },
  { key: 'users', href: '/configuracion/usuarios', icon: 'team', action: 'users.view' },
  { key: 'permissions', href: '/configuracion/permisos', icon: 'settings', action: 'permissions.manage' },
];

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

/** Los ítems de navegación del usuario de la sesión. */
export function useVisibleNavItems(): NavItem[] {
  const user = useOptionalAuth()?.user;
  const access = useReadAccess();
  // Sin sesión (la transición de ingreso) no hay política que consultar.
  return visibleNavItems(user?.role, navItems, user ? access : null);
}
