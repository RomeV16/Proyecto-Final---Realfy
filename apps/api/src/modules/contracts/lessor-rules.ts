import { BadRequestException } from '@nestjs/common';
import {
  findInvalidShareDates,
  LessorShareRow,
  InvalidShareDate,
  PowerScope,
} from '@realfy/shared';

/** Cliente de Prisma o transacción con los modelos que usan estas reglas. */
type Db = any;

export interface LessorRefs {
  personId: string;
  bankAccountId?: string | null;
  payeePersonId?: string | null;
}

/**
 * Lo que un locador referencia tiene que existir y ser coherente:
 * la persona, su cuenta (que sea suya) y, si cobra otro, que ese otro tenga
 * un poder vigente para cobrar en nombre del locador sobre este contrato o esta
 * propiedad.
 */
export async function assertLessorRefs(
  db: Db,
  refs: LessorRefs,
  ctx: { contractId?: string; propertyId: string; at: Date },
): Promise<void> {
  const person = await db.person.findFirst({ where: { id: refs.personId } });
  if (!person) {
    throw new BadRequestException({
      error: 'PERSON_NOT_FOUND',
      message: `Person ${refs.personId} not found`,
    });
  }

  if (refs.bankAccountId) {
    const account = await db.personBankAccount.findFirst({
      where: { id: refs.bankAccountId, personId: refs.personId },
    });
    if (!account) {
      throw new BadRequestException({
        error: 'BANK_ACCOUNT_NOT_OF_LESSOR',
        message: 'The bank account does not belong to the lessor',
      });
    }
  }

  if (refs.payeePersonId) {
    const payee = await db.person.findFirst({ where: { id: refs.payeePersonId } });
    if (!payee) {
      throw new BadRequestException({
        error: 'PERSON_NOT_FOUND',
        message: `Person ${refs.payeePersonId} not found`,
      });
    }
    const power = await db.powerOfAttorney.findFirst({
      where: {
        principalId: refs.personId,
        agentId: refs.payeePersonId,
        scopes: { has: PowerScope.Cobrar },
        validFrom: { lte: ctx.at },
        AND: [
          { OR: [{ validTo: null }, { validTo: { gt: ctx.at } }] },
          { OR: [{ contractId: null }, ...(ctx.contractId ? [{ contractId: ctx.contractId }] : [])] },
          { OR: [{ propertyId: null }, { propertyId: ctx.propertyId }] },
        ],
      },
    });
    if (!power) {
      throw new BadRequestException({
        error: 'PAYEE_WITHOUT_POWER',
        message: 'The payee needs an active power of attorney with scope Cobrar from the lessor',
      });
    }
  }
}

export function throwLessorSharesInvalid(invalidDates: InvalidShareDate[]): never {
  const first = invalidDates[0];
  throw new BadRequestException({
    error: 'LESSOR_SHARES_INVALID',
    message: `Active lessors must add up to 100% on every date; they add up to ${first.sum}% on ${first.date.toISOString().slice(0, 10)}`,
    details: {
      invalidDates: invalidDates.map((d) => ({
        date: d.date.toISOString().slice(0, 10),
        sum: d.sum,
      })),
    },
  });
}

/** Valida los locadores guardados del contrato; lanza `LESSOR_SHARES_INVALID`. */
export async function assertLessorShares(
  db: Db,
  contract: { id: string; startDate: Date; endDate: Date },
): Promise<void> {
  const rows: LessorShareRow[] = await db.contractLessor.findMany({
    where: { contractId: contract.id },
    select: { payoutPct: true, validFrom: true, validTo: true },
  });
  const invalid = findInvalidShareDates(rows, contract.startDate, contract.endDate);
  if (invalid.length > 0) throwLessorSharesInvalid(invalid);
}
