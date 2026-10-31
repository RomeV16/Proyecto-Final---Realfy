'use client';

import { useOptionalAuth } from '@/lib/auth-context';
import { UserRole, type ReadResource } from '@realfy/shared';
import { useReadAccess } from '@/lib/read-access';

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
  /** Ver el equipo (solo lectura) y gestionarlo: invitar, cambiar roles, dar de baja. */
  'users.view': [Admin, Gerente],
  'users.manage': [Admin],
  /** Configurar qué roles leen los datos sensibles (política de lectura). */
  'permissions.manage': [Admin],
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

/**
 * `true` si la política de lectura de la inmobiliaria deja al rol del usuario
 * leer el recurso sensible. Mientras se consulta se asume que sí: la API es la
 * que niega (403 `READ_FORBIDDEN`) o enmascara el dato, y la web solo oculta.
 */
export function useCanRead(resource: ReadResource): boolean {
  const access = useReadAccess();
  return access === null ? true : access[resource];
}
