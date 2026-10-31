'use client';

import { useOptionalAuth } from '@/lib/auth-context';
import { UserRole } from '@realfy/shared';

const { Admin, Gerente, Ventas, Liquidaciones, Soporte, Lectura } = UserRole;

/**
 * Qué rol puede hacer qué, en un solo lugar. La API es la que impone los
 * permisos de verdad (`@Roles` + `RbacGuard`); esta matriz solo decide qué
 * botones, secciones y pantallas muestra la web. Cada acción lleva el nombre
 * de lo que habilita, no el de quién lo usa.
 */
export const ACTION_ROLES = {
  // Propiedades, personas y leads: el equipo comercial
  'properties.manage': [Admin, Gerente, Ventas],
  'properties.delete': [Admin, Gerente],
  'persons.manage': [Admin, Gerente, Ventas],
  'persons.delete': [Admin, Gerente],
  'persons.scoring': [Admin, Gerente],
  'leads.manage': [Admin, Gerente, Ventas],
  /** Usuarios a los que se les puede asignar un lead. */
  'leads.assignable': [Admin, Gerente, Ventas],
  'pipeline.access': [Admin, Gerente, Ventas],
  'pipeline.configure': [Admin, Gerente],
  'scoring.configure': [Admin, Gerente],

  // Contratos
  'contracts.manage': [Admin, Gerente, Ventas],
  'contracts.administer': [Admin, Gerente],

  // Liquidaciones, rendiciones y comprobantes
  'liquidaciones.generate': [Admin, Gerente],
  'liquidaciones.bulk': [Admin, Gerente],
  'liquidaciones.act': [Admin, Gerente, Ventas, Liquidaciones],
  /** Aviso de "solo lectura" en el listado de liquidaciones. */
  'liquidaciones.readOnlyNotice': [Lectura],
  'renditions.manage': [Admin, Gerente, Liquidaciones],
  'invoices.emit': [Admin, Gerente, Liquidaciones],
  'fiscal.configure': [Admin, Gerente],

  // Reportes, morosidad y tablero
  'reports.view': [Admin, Gerente, Liquidaciones],
  'reports.schedule': [Admin, Gerente],
  'delinquency.view': [Admin, Gerente],
  'dashboard.analytics': [Admin, Gerente],

  // Soporte y configuración
  'tickets.manage': [Admin, Gerente, Soporte],
  'settings.manage': [Admin, Gerente],
  'indexData.view': [Admin, Gerente],
  'indexData.manage': [Admin],
} as const satisfies Record<string, readonly UserRole[]>;

export type Action = keyof typeof ACTION_ROLES;

/** `true` si el rol puede realizar la acción. Un rol ausente o desconocido no puede nada. */
export function can(role: string | null | undefined, action: Action): boolean {
  if (!role) return false;
  return (ACTION_ROLES[action] as readonly string[]).includes(role);
}

/** `can` con el rol del usuario de la sesión. */
export function useCan(action: Action): boolean {
  const user = useOptionalAuth()?.user;
  return can(user?.role, action);
}
