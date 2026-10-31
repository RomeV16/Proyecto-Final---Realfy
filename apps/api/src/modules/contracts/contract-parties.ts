import { isLessorActiveAt } from '@realfy/shared';

/**
 * Las partes de un contrato, leídas en un solo lugar.
 *
 * - Inquilino, garante y comprador viven en `ContractPerson`.
 * - Quien alquila y cobra (el locador) vive en `ContractLessor`, con su
 *   porcentaje de cobro y su vigencia. Ya no se lee de `ContractPerson`.
 */

interface WithRole {
  role: string;
}

/** Primera parte con ese rol de un contrato ya cargado con sus `persons`. */
export function getParty<T extends WithRole>(
  contract: { persons?: T[] | null },
  role: string,
): T | undefined {
  return contract.persons?.find((p) => p.role === role);
}

/** Todas las partes con ese rol, en el orden en que vienen. */
export function getParties<T extends WithRole>(
  contract: { persons?: T[] | null },
  role: string,
): T[] {
  return (contract.persons ?? []).filter((p) => p.role === role);
}

interface LessorWindow {
  validFrom: Date;
  validTo: Date | null;
}

/** Cliente de Prisma o transacción: lo único que se usa es `contractLessor.findMany`. */
interface LessorDb {
  contractLessor: { findMany(args: any): Promise<any[]> };
}

/**
 * Locadores vigentes en `date`, de mayor a menor porcentaje (a igualdad, por
 * orden de alta). Acepta el id del contrato o un contrato ya cargado con sus
 * `lessors`; en el segundo caso no consulta la base.
 */
export async function getLessorsAt<T extends LessorWindow = any>(
  db: LessorDb,
  contract: string | { id: string; lessors?: T[] | null },
  date: Date,
): Promise<T[]> {
  if (typeof contract !== 'string' && contract.lessors) {
    return contract.lessors
      .filter((l) => isLessorActiveAt(l, date))
      .sort(byShareThenCreation);
  }
  const contractId = typeof contract === 'string' ? contract : contract.id;
  return db.contractLessor.findMany({
    where: {
      contractId,
      validFrom: { lte: date },
      OR: [{ validTo: null }, { validTo: { gt: date } }],
    },
    include: { person: true, payee: true, bankAccount: true },
    orderBy: [{ payoutPct: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
}

function byShareThenCreation(a: any, b: any): number {
  return (
    Number(b.payoutPct) - Number(a.payoutPct) ||
    (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0) ||
    String(a.id ?? '').localeCompare(String(b.id ?? ''))
  );
}

interface PowerDb {
  powerOfAttorney: { findMany(args: any): Promise<any[]> };
}

/**
 * Poderes vigentes en `date` por los que alguien actúa por un locador del
 * contrato: los del propio contrato, los de su propiedad y los generales.
 */
export async function getApoderadosAt(
  db: PowerDb,
  contract: { id: string; propertyId: string; lessors?: Array<{ personId: string }> | null },
  date: Date,
): Promise<any[]> {
  const principalIds = [...new Set((contract.lessors ?? []).map((l) => l.personId))];
  if (principalIds.length === 0) return [];
  return db.powerOfAttorney.findMany({
    where: {
      principalId: { in: principalIds },
      validFrom: { lte: date },
      AND: [
        { OR: [{ validTo: null }, { validTo: { gt: date } }] },
        { OR: [{ contractId: null }, { contractId: contract.id }] },
        { OR: [{ propertyId: null }, { propertyId: contract.propertyId }] },
      ],
    },
    include: { agent: true, principal: true },
    orderBy: [{ validFrom: 'asc' }, { id: 'asc' }],
  });
}
