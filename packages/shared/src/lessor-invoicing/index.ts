import { z } from 'zod';
import { OwnerLedgerEntryType as T } from '../enums';
import { Money, round2, sumMoney } from '../money';
import type { MoneyInput } from '../money';

/**
 * Facturación por cuenta del locador (roadmap 38). Puro, sin acceso a la base.
 *
 * La inmobiliaria emite, con la delegación ARCA del locador, las facturas del
 * alquiler a nombre de él: nunca a nombre de la inmobiliaria. Qué se factura,
 * cuándo y con qué IVA es configurable (valor de la inmobiliaria y, si hace
 * falta, el de cada locador): ninguna regla fiscal está fijada acá. Los
 * valores de fábrica son los conservadores: solo el alquiler, sin IVA
 * discriminado y a pedido.
 */

/** Qué parte de lo que le corresponde al locador se factura. */
export enum LessorInvoiceScope {
  /** Solo el alquiler. */
  Alquiler = 'Alquiler',
  /** El alquiler y los punitorios. */
  AlquilerPunitorios = 'AlquilerPunitorios',
  /** Todo lo que es del locador: alquiler, punitorios, reintegros y otros conceptos. */
  TodoLocador = 'TodoLocador',
}

/** Cuándo se factura. */
export enum LessorInvoiceWhen {
  /** Solo cuando una persona lo pide. */
  Manual = 'Manual',
  /** Al registrar cada cobro. */
  AlPagar = 'AlPagar',
  /** Al emitir el estado de cuenta del locador. */
  AlEmitirEstado = 'AlEmitirEstado',
}

/** Alícuotas de IVA que ARCA admite en el comprobante. */
export const LESSOR_INVOICE_VAT_RATES = [0, 2.5, 5, 10.5, 21, 27] as const;

const vatPct = z
  .number()
  .refine((v) => (LESSOR_INVOICE_VAT_RATES as readonly number[]).includes(v), { message: 'Invalid VAT rate' });

/**
 * Configuración de facturación. `vatPct` es el IVA incluido en el importe (0 = sin IVA discriminado;
 * en una factura C nunca se discrimina).
 */
export const InvoicingSettingsSchema = z
  .object({
    scope: z.nativeEnum(LessorInvoiceScope).default(LessorInvoiceScope.Alquiler),
    when: z.nativeEnum(LessorInvoiceWhen).default(LessorInvoiceWhen.Manual),
    vatPct: vatPct.default(0),
  })
  .strict();
export type InvoicingSettings = z.infer<typeof InvoicingSettingsSchema>;

/** Lo que guarda un locador: cada campo que no define, lo toma de la inmobiliaria. */
export const LessorInvoicingOverrideSchema = z
  .object({
    scope: z.nativeEnum(LessorInvoiceScope).nullish(),
    when: z.nativeEnum(LessorInvoiceWhen).nullish(),
    vatPct: vatPct.nullish(),
  })
  .strict();
export type LessorInvoicingOverride = z.infer<typeof LessorInvoicingOverrideSchema>;

export const DEFAULT_INVOICING_SETTINGS: InvoicingSettings = InvoicingSettingsSchema.parse({});

/** Configuración vigente de un locador: sus campos y, donde no definió, los de la inmobiliaria. */
export function resolveInvoicingSettings(
  agency: InvoicingSettings | null | undefined,
  override: LessorInvoicingOverride | null | undefined,
): InvoicingSettings {
  const base = agency ?? DEFAULT_INVOICING_SETTINGS;
  const own = override ?? {};
  return {
    scope: own.scope ?? base.scope,
    when: own.when ?? base.when,
    vatPct: own.vatPct ?? base.vatPct,
  };
}

/** Conceptos de la cuenta corriente que entran en cada alcance. */
export const SCOPE_ENTRY_TYPES: Record<LessorInvoiceScope, readonly T[]> = {
  [LessorInvoiceScope.Alquiler]: [T.Alquiler],
  [LessorInvoiceScope.AlquilerPunitorios]: [T.Alquiler, T.Punitorio],
  [LessorInvoiceScope.TodoLocador]: [T.Alquiler, T.Punitorio, T.ReintegroImpuesto, T.Ajuste],
};

/** Importe a facturar por cuenta del locador: la suma de sus asientos del alcance (nunca negativa). */
export function lessorInvoiceAmount(
  entries: ReadonlyArray<{ type: string; amount: MoneyInput }>,
  scope: LessorInvoiceScope,
): Money {
  const types = SCOPE_ENTRY_TYPES[scope] as readonly string[];
  const total = sumMoney(entries.filter((e) => types.includes(e.type)).map((e) => e.amount));
  return total.isPositive() ? round2(total) : new Money(0);
}

/** Neto e IVA de un importe que incluye el IVA indicado (en una factura C, nunca se discrimina). */
export function splitVatIncluded(
  total: MoneyInput,
  vatPct: number,
  letra: 'A' | 'B' | 'C',
): { neto: Money; iva: Money; vatPct: number } {
  const t = round2(total);
  if (letra === 'C' || vatPct === 0) return { neto: t, iva: new Money(0), vatPct: 0 };
  const neto = round2(t.div(new Money(vatPct).div(100).plus(1)));
  return { neto, iva: t.minus(neto), vatPct };
}

/** Clave de idempotencia ante ARCA y la base de una factura (o nota de crédito) de un origen y un locador. */
export function lessorInvoiceKey(
  kind: 'Factura' | 'NotaCredito',
  sourceType: 'Payment' | 'OwnerStatement',
  sourceId: string,
  personId: string,
): string {
  return `lessor:${kind}:${sourceType}:${sourceId}:${personId}`;
}
