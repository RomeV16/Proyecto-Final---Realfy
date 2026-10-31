import { z } from 'zod';
import { UserRole } from '../enums';

/**
 * Recursos sensibles cuya lectura puede restringirse por rol. La política es
 * por inmobiliaria; sin configurar, todos los roles de personal leen todo.
 */
export const READ_RESOURCES = [
  'persons.bankAccounts',
  'persons.document',
  'contracts.commission',
  'renditions',
  'reports.financial',
  'invoices',
  'audit',
] as const;

export type ReadResource = (typeof READ_RESOURCES)[number];

export type ReadPolicy = Record<ReadResource, UserRole[]>;

const ALL_ROLES = Object.values(UserRole) as UserRole[];

export const DEFAULT_READ_POLICY: ReadPolicy = Object.fromEntries(
  READ_RESOURCES.map((r) => [r, [...ALL_ROLES]]),
) as ReadPolicy;

const RolesSchema = z.array(z.nativeEnum(UserRole));

/**
 * Política completa: cada recurso lista los roles que pueden leerlo. El rol
 * Admin siempre debe estar incluido, para que la inmobiliaria no pueda
 * quedarse sin acceso a su propia información.
 */
export const ReadPolicySchema = z
  .object(
    Object.fromEntries(READ_RESOURCES.map((r) => [r, RolesSchema])) as Record<
      ReadResource,
      typeof RolesSchema
    >,
  )
  .strict()
  .superRefine((policy, ctx) => {
    for (const resource of READ_RESOURCES) {
      if (!policy[resource].includes(UserRole.Admin)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [resource],
          message: 'El rol Admin siempre debe poder leer',
        });
      }
    }
  });

/**
 * Resuelve el valor guardado (null/indefinido = política por defecto). Un
 * valor guardado que no valida lanza: quien lo llama decide fallar cerrado.
 */
export function resolveReadPolicy(stored: unknown): ReadPolicy {
  if (stored === null || stored === undefined) return DEFAULT_READ_POLICY;
  const parsed = ReadPolicySchema.parse(stored);
  return Object.fromEntries(
    READ_RESOURCES.map((r) => [r, [...new Set(parsed[r])]]),
  ) as ReadPolicy;
}

export function canReadResource(
  policy: ReadPolicy,
  resource: ReadResource,
  role: UserRole | string | null | undefined,
): boolean {
  if (!role) return false;
  return (policy[resource] as string[]).includes(role);
}
