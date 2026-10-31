import { UserRole } from '@realfy/shared';

/**
 * Grupos de roles con nombre. Los controladores los usan en `@Roles(...)` en
 * lugar de repetir la lista de roles en cada ruta.
 */
export const ADMIN_ONLY: readonly UserRole[] = [UserRole.Admin];

/** Administración de la inmobiliaria. */
export const MANAGEMENT_ROLES: readonly UserRole[] = [
  UserRole.Admin,
  UserRole.Gerente,
];

/** Gestión comercial: alquileres, ventas, personas, propiedades. */
export const SALES_ROLES: readonly UserRole[] = [
  ...MANAGEMENT_ROLES,
  UserRole.Ventas,
];

/** Cobranza, liquidaciones y facturación. */
export const BILLING_ROLES: readonly UserRole[] = [
  ...MANAGEMENT_ROLES,
  UserRole.Liquidaciones,
];

/** Atención de reclamos y tickets. */
export const SUPPORT_ROLES: readonly UserRole[] = [
  ...MANAGEMENT_ROLES,
  UserRole.Soporte,
];

/** Publicación, plantillas y campañas. */
export const MARKETING_ROLES: readonly UserRole[] = [
  ...MANAGEMENT_ROLES,
  UserRole.Marketing,
];

export const SALES_MARKETING_ROLES: readonly UserRole[] = [
  ...SALES_ROLES,
  UserRole.Marketing,
];

/** Liquidaciones más el rol de solo lectura. */
export const BILLING_READ_ROLES: readonly UserRole[] = [
  ...BILLING_ROLES,
  UserRole.Lectura,
];

/** Consulta de facturas: facturación, comercial, soporte y solo lectura. */
export const BILLING_VIEW_ROLES: readonly UserRole[] = [
  ...BILLING_READ_ROLES,
  UserRole.Ventas,
  UserRole.Soporte,
];

/** Todos los roles de personal (sin portal de inquilino/propietario). */
export const ALL_STAFF: readonly UserRole[] = Object.values(UserRole);
