'use client';

import type { IconName } from '@/components/ui/icon';
import { useAuth } from '@/lib/auth-context';
import { can, type Action } from '@/lib/permissions';

export interface NavItem {
  /** Translation key under the `nav` namespace. */
  key: string;
  href: string;
  icon: IconName;
  /**
   * Acción de `lib/permissions` que habilita el ítem. Sin acción, lo ven todos
   * los roles del personal (hoy ningún ítem restringe: cada pantalla ya decide
   * qué ofrece según el rol).
   */
  action?: Action;
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
  { key: 'pipeline', href: '/pipeline', icon: 'pipeline' },
  { key: 'contracts', href: '/contracts', icon: 'contracts' },
  { key: 'liquidaciones', href: '/liquidaciones', icon: 'liquidaciones' },
  { key: 'pagos', href: '/pagos', icon: 'liquidaciones' },
  { key: 'renditions', href: '/renditions', icon: 'renditions' },
  { key: 'invoices', href: '/invoices', icon: 'invoices' },
  { key: 'delinquency', href: '/delinquency', icon: 'delinquency' },
  { key: 'reports', href: '/reports', icon: 'reports' },
  { key: 'tickets', href: '/tickets', icon: 'tickets' },
  { key: 'providers', href: '/providers', icon: 'providers' },
  { key: 'notifications', href: '/notifications', icon: 'bell' },
  { key: 'import', href: '/import', icon: 'import' },
];

/** Los ítems que el rol puede ver. */
export function visibleNavItems(
  role: string | null | undefined,
  items: readonly NavItem[] = navItems,
): NavItem[] {
  return items.filter((item) => !item.action || can(role, item.action));
}

/** Los ítems de navegación del usuario de la sesión. */
export function useVisibleNavItems(): NavItem[] {
  const { user } = useAuth();
  return visibleNavItems(user?.role);
}
