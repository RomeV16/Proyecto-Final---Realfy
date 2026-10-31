import { PersonRole } from '@realfy/shared';

/** Lo mínimo que `ensureRole` necesita de un cliente de Prisma o de una transacción. */
interface RoleClient {
  person: { findFirst(args: any): Promise<{ tenantId: string } | null> };
  personRoleAssignment: { upsert(args: any): Promise<any> };
}

/**
 * Asegura que la persona tenga el rol: lo crea si falta y no hace nada si ya
 * está. Es la única forma de etiquetar a una persona con un rol; la usan el alta
 * de consultas, de proveedores, de contratos y la asignación manual.
 *
 * `tx` puede ser el cliente base o una transacción: la inmobiliaria se toma de
 * la persona, no del contexto de la petición, para que funcione también donde
 * no hay petición (el formulario público).
 */
export async function ensureRole(
  tx: RoleClient,
  personId: string,
  role: PersonRole,
  extra: { guarantorForPersonId?: string | null } = {},
) {
  const person = await tx.person.findFirst({
    where: { id: personId },
    select: { tenantId: true },
  });
  if (!person) throw new Error(`ensureRole: person ${personId} not found`);

  return tx.personRoleAssignment.upsert({
    where: { personId_role: { personId, role } },
    create: {
      personId,
      role,
      tenantId: person.tenantId,
      guarantorForPersonId: extra.guarantorForPersonId ?? null,
    },
    update: {},
  });
}
