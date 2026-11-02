import { z } from 'zod';
import { CashCategory, CashDirection, Currency, FinancialAccountKind } from '../enums';
import { MANUAL_CASH_CATEGORIES } from '../cash';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
/** Importe positivo con hasta 2 decimales. */
const positiveAmount = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a decimal with up to 2 places'))
  .refine((v) => Number(v) > 0, 'Amount must be positive');
/** Tipo de cambio positivo con hasta 6 decimales. */
const rate = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^\d+(\.\d{1,6})?$/, 'Must be a decimal with up to 6 places'))
  .refine((v) => Number(v) > 0, 'Rate must be positive');
const note = z.string().trim().max(1000).optional().nullable();
const page = {
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
};

// ─── Cuentas ────────────────────────────────────────────

export const CreateFinancialAccountSchema = z
  .object({
    kind: z.nativeEnum(FinancialAccountKind),
    name: z.string().trim().min(1).max(120),
    currency: z.nativeEnum(Currency),
    /** Locador dueño del dinero; obligatorio en una cuenta de custodia y prohibido en las demás. */
    ownerPersonId: z.string().uuid().optional().nullable(),
  })
  .strict()
  .refine((v) => (v.kind === FinancialAccountKind.Custodia) === !!v.ownerPersonId, {
    message: 'A custody account needs an owner and only custody accounts have one',
    path: ['ownerPersonId'],
  });

/** La clase, la moneda y el dueño no cambian: una cuenta con movimientos los necesita fijos. */
export const UpdateFinancialAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const FinancialAccountFilterSchema = z.object({
  kind: z.nativeEnum(FinancialAccountKind).optional(),
  currency: z.nativeEnum(Currency).optional(),
  ownerPersonId: z.string().uuid().optional(),
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional(),
});

// ─── Movimientos ────────────────────────────────────────

export const CashMovementFilterSchema = z.object({
  accountId: z.string().uuid().optional(),
  category: z.nativeEnum(CashCategory).optional(),
  contractId: z.string().uuid().optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  ...page,
});

/** Movimiento cargado a mano: gastos, honorarios, pagos a locadores, entes y proveedores, señas. */
export const CreateCashMovementSchema = z
  .object({
    accountId: z.string().uuid(),
    date: dateOnly,
    direction: z.nativeEnum(CashDirection),
    amount: positiveAmount,
    category: z.nativeEnum(CashCategory),
    counterpartyId: z.string().uuid().optional().nullable(),
    contractId: z.string().uuid().optional().nullable(),
    note,
  })
  .strict()
  .refine((v) => MANUAL_CASH_CATEGORIES.includes(v.category), {
    message: 'This category is written by its own action (payments, custody, compensations, conversions)',
    path: ['category'],
  });

/** Conversión entre dos cuentas de distinta moneda con tipo de cambio explícito. */
export const CreateConversionSchema = z
  .object({
    fromAccountId: z.string().uuid(),
    toAccountId: z.string().uuid(),
    date: dateOnly,
    amount: positiveAmount,
    /** Unidades de la moneda de destino por unidad de la de origen. */
    rate,
    note,
  })
  .strict()
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    message: 'A conversion needs two different accounts',
    path: ['toAccountId'],
  });

// ─── Custodia y compensaciones ──────────────────────────

/** Entrega al locador del efectivo en custodia; sin importe, entrega todo el saldo. */
export const DeliverCustodySchema = z
  .object({
    amount: positiveAmount.optional(),
    date: dateOnly,
    note,
  })
  .strict();

export const CreateCompensationSchema = z
  .object({
    paymentId: z.string().uuid(),
    /** Locador que recibió el cobro (o lo cubre con su saldo). */
    fromLessorId: z.string().uuid(),
    /** Locador del contrato al que le correspondía. */
    toLessorId: z.string().uuid(),
    /** Sin importe, la parte del locador compensado en ese cobro. */
    amount: positiveAmount.optional(),
    /**
     * Lo cubre el efectivo que la inmobiliaria guarda en custodia para `from`:
     * sale de su custodia y entra en `toAccountId` (por defecto, la caja de la moneda).
     */
    fromCustody: z.boolean().optional(),
    toAccountId: z.string().uuid().optional().nullable(),
    note,
  })
  .strict()
  .refine((v) => v.fromLessorId !== v.toLessorId, {
    message: 'A lessor cannot compensate themselves',
    path: ['toLessorId'],
  });

// ─── Recibos ────────────────────────────────────────────

export const ReceiptFilterSchema = z.object({
  contractId: z.string().uuid().optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  ...page,
});

// ─── Gasto de la inmobiliaria desde el centro de carga ──

/** Cierra un cargo a la inmobiliaria como egreso (Gasto) de una de sus cuentas. */
export const AgencyExpenseSchema = z
  .object({
    accountId: z.string().uuid(),
    date: dateOnly.optional(),
    note,
  })
  .strict();

export type CreateFinancialAccountInput = z.infer<typeof CreateFinancialAccountSchema>;
export type CreateCashMovementInput = z.infer<typeof CreateCashMovementSchema>;
export type CreateConversionInput = z.infer<typeof CreateConversionSchema>;
export type CreateCompensationInput = z.infer<typeof CreateCompensationSchema>;
