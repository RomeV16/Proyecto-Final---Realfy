import { z } from 'zod';
import { FiscalCondition } from '../enums';

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

export const IvaArrayItemSchema = z.object({
  id: z.number().int(),
  baseImp: z.string(),
  importe: z.string(),
});
export type IvaArrayItem = z.infer<typeof IvaArrayItemSchema>;

export const TributoSchema = z.object({
  id: z.number().int(),
  desc: z.string().optional(),
  baseImp: z.string(),
  alic: z.string(),
  importe: z.string(),
});
export type Tributo = z.infer<typeof TributoSchema>;

export const OpcionalSchema = z.object({
  id: z.string(),
  valor: z.string(),
});
export type Opcional = z.infer<typeof OpcionalSchema>;

export const CbteAsocSchema = z.object({
  tipo: z.number().int(),
  ptoVta: z.number().int(),
  nro: z.number().int(),
  cuit: z.string().optional(),
  fecha: z.string().optional(),
});
export type CbteAsoc = z.infer<typeof CbteAsocSchema>;

export const ReceptorSchema = z.object({
  docTipo: z.number().int(),             // 80 CUIT, 86 CUIL, 96 DNI, 99 Consumidor Final
  docNro: z.string(),
  businessName: z.string(),
  fiscalCondition: z.nativeEnum(FiscalCondition),
  condicionIVAReceptorId: z.number().int(),  // REQUIRED by RG 5616/2024
  address: z.string().optional(),
});
export type Receptor = z.infer<typeof ReceptorSchema>;

// ─── Emit Invoice ─────────────────────────────────────────────────────────────

export const EmitInvoiceDtoSchema = z.object({
  issuerId: z.string().uuid(),
  ptoVta: z.number().int().positive(),
  cbteTipo: z.number().int().positive(),       // 1/6/11 etc.
  concepto: z.union([z.literal(1), z.literal(2), z.literal(3)]),  // 1 productos, 2 servicios, 3 ambos
  cbteFch: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receptor: ReceptorSchema,
  // Amounts as decimal strings to avoid float issues
  impTotal: z.string(),
  impTotConc: z.string().default('0'),
  impNeto: z.string(),
  impOpEx: z.string().default('0'),
  impTrib: z.string().default('0'),
  impIVA: z.string().default('0'),
  monId: z.string().default('PES'),
  monCotiz: z.string().default('1'),
  iva: z.array(IvaArrayItemSchema).optional(),
  tributos: z.array(TributoSchema).optional(),
  opcionales: z.array(OpcionalSchema).optional(),
  cbtesAsoc: z.array(CbteAsocSchema).optional(),
  // Service period (required when concepto != 1)
  fchServDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fchServHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fchVtoPago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodoAsocDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodoAsocHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Business-side link
  paymentId: z.string().uuid().optional(),     // if linked to a Payment, for auto-associating
  description: z.string().max(500).optional(), // line item description
  clientRequestId: z.string().uuid().optional(), // idempotency
})
  .refine(
    (d) => d.concepto === 1 || (d.fchServDesde != null && d.fchServHasta != null && d.fchVtoPago != null),
    { message: 'fchServDesde/Hasta/VtoPago required when concepto != 1' },
  )
  .refine(
    (d) => {
      try {
        const t = +d.impNeto + +(d.impTotConc ?? '0') + +(d.impOpEx ?? '0') + +(d.impTrib ?? '0') + +(d.impIVA ?? '0');
        return Math.abs(t - +d.impTotal) < 0.01;
      } catch {
        return false;
      }
    },
    { message: 'impTotal mismatch with sum of parts' },
  );

export type EmitInvoiceDto = z.infer<typeof EmitInvoiceDtoSchema>;

// ─── Emit Nota de Crédito ─────────────────────────────────────────────────────
// NC schema is a separate object (can't use .extend() on ZodEffects) that
// requires cbtesAsoc, then adds the same cross-field refines.

export const EmitNotaCreditoDtoSchema = z.object({
  issuerId: z.string().uuid(),
  ptoVta: z.number().int().positive(),
  cbteTipo: z.number().int().positive(),
  concepto: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  cbteFch: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receptor: ReceptorSchema,
  impTotal: z.string(),
  impTotConc: z.string().default('0'),
  impNeto: z.string(),
  impOpEx: z.string().default('0'),
  impTrib: z.string().default('0'),
  impIVA: z.string().default('0'),
  monId: z.string().default('PES'),
  monCotiz: z.string().default('1'),
  iva: z.array(IvaArrayItemSchema).optional(),
  tributos: z.array(TributoSchema).optional(),
  opcionales: z.array(OpcionalSchema).optional(),
  // NC requires cbtesAsoc (min 1)
  cbtesAsoc: z.array(CbteAsocSchema).min(1, 'NC requires cbtesAsoc'),
  fchServDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fchServHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fchVtoPago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodoAsocDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodoAsocHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentId: z.string().uuid().optional(),
  description: z.string().max(500).optional(),
  clientRequestId: z.string().uuid().optional(),
})
  .refine(
    (d) => d.concepto === 1 || (d.fchServDesde != null && d.fchServHasta != null && d.fchVtoPago != null),
    { message: 'fchServDesde/Hasta/VtoPago required when concepto != 1' },
  )
  .refine(
    (d) => {
      try {
        const t = +d.impNeto + +(d.impTotConc ?? '0') + +(d.impOpEx ?? '0') + +(d.impTrib ?? '0') + +(d.impIVA ?? '0');
        return Math.abs(t - +d.impTotal) < 0.01;
      } catch {
        return false;
      }
    },
    { message: 'impTotal mismatch with sum of parts' },
  );

export type EmitNotaCreditoDto = z.infer<typeof EmitNotaCreditoDtoSchema>;

// ─── Issuer DTOs ──────────────────────────────────────────────────────────────

export const IssuerCreateDtoSchema = z.object({
  cuit: z.string().min(1),
  businessName: z.string().min(1),
  fiscalCondition: z.nativeEnum(FiscalCondition),
  ingresosBrutos: z.string().optional(),
  activityStartDate: z.string().optional(),
  businessAddress: z.string().optional(),
});
export type IssuerCreateDto = z.infer<typeof IssuerCreateDtoSchema>;

export const IssuerUpdateDtoSchema = IssuerCreateDtoSchema.partial();
export type IssuerUpdateDto = z.infer<typeof IssuerUpdateDtoSchema>;

// ─── Punto de Venta DTOs ─────────────────────────────────────────────────────

export const PuntoDeVentaCreateDtoSchema = z.object({
  number: z.number().int().positive(),
  nombre: z.string().optional(),
  tipo: z.string().optional(),
});
export type PuntoDeVentaCreateDto = z.infer<typeof PuntoDeVentaCreateDtoSchema>;
