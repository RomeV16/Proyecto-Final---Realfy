import { z } from 'zod';
import { Currency, OwnerLedgerEntryType, OwnerStatementStatus } from '../enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Must be YYYY-MM');
/** Importe con signo y hasta 2 decimales (el saldo inicial puede ser negativo o cero). */
const signedAmount = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Must be a decimal with up to 2 places'));
const positiveAmount = signedAmount.refine((v) => Number(v) > 0, 'Amount must be positive');
const reason = z.string().trim().min(3).max(1000);
const page = {
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
};

/** Movimientos de la cuenta corriente de un locador en una moneda, entre dos fechas. */
export const OwnerLedgerFilterSchema = z.object({
  currency: z.nativeEnum(Currency).optional().default(Currency.ARS),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  ...page,
});

/** Saldo inicial de un locador en una moneda (lo carga la gerencia o la importación). */
export const OpeningBalanceSchema = z
  .object({
    currency: z.nativeEnum(Currency),
    amount: signedAmount,
    /** Fecha del saldo; por defecto, hoy. */
    date: dateOnly.optional(),
    reason,
  })
  .strict();

/** Formas de pagarle al locador desde una cuenta de la inmobiliaria. */
export const OWNER_PAYOUT_METHODS = [OwnerLedgerEntryType.Transferencia, OwnerLedgerEntryType.EntregaEfectivo] as const;

/** Pago al locador: sale de una cuenta de la inmobiliaria y baja su saldo. */
export const OwnerPayoutSchema = z
  .object({
    accountId: z.string().uuid(),
    method: z.enum(OWNER_PAYOUT_METHODS),
    amount: positiveAmount,
    date: dateOnly,
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .strict();

/** Generar los borradores del mes: todos los locadores con movimientos o saldo, o uno solo. */
export const GenerateOwnerStatementsSchema = z
  .object({
    period,
    personId: z.string().uuid().optional(),
  })
  .strict();

export const OwnerStatementListSchema = z.object({
  period: period.optional(),
  personId: z.string().uuid().optional(),
  status: z.nativeEnum(OwnerStatementStatus).optional(),
  currency: z.nativeEnum(Currency).optional(),
  ...page,
});

export const AnnulOwnerStatementSchema = z.object({ reason }).strict();

export type OpeningBalanceInput = z.infer<typeof OpeningBalanceSchema>;
export type OwnerPayoutInput = z.infer<typeof OwnerPayoutSchema>;
