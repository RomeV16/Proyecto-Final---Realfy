/**
 * UI-facing Zod schemas for the invoice wizard and fiscal settings forms.
 *
 * Deliberate difference from @realfy/shared DTOs:
 *   - Amounts are `z.number()` here (suitable for HTML inputs / react-hook-form)
 *     vs `z.string()` in @realfy/shared (wire format for the API).
 *   - `emitInvoiceSchema` includes `items[]` + `clientRequestId` which are
 *     split differently in the API DTO.
 *   - Receptor uses local field names (razonSocial, condicionIvaReceptorId)
 *     vs API field names (businessName, condicionIVAReceptorId).
 *
 * Do NOT replace with @realfy/shared re-exports — the shapes are intentionally
 * different. All components import only interface types (ArcaIssuerDTO, etc.)
 * from this file; the Zod schemas are consumed internally by form hooks.
 */

import { z } from 'zod';

// ─── Delegation Status ──────────────────────────────────

export const ArcaDelegationStatus = {
  Pending: 'Pending',
  Active: 'Active',
  Revoked: 'Revoked',
} as const;
export type ArcaDelegationStatus = (typeof ArcaDelegationStatus)[keyof typeof ArcaDelegationStatus];

// ─── CUIT validation (Luhn-like Argentine algorithm) ────

function validateCuit(cuit: string): boolean {
  const clean = cuit.replace(/[-\s]/g, '');
  if (!/^\d{11}$/.test(clean)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(clean[i]), 0);
  const remainder = sum % 11;
  const checkDigit = remainder === 0 ? 0 : remainder === 1 ? 9 : 11 - remainder;
  return checkDigit === Number(clean[10]);
}

// ─── Certificate ────────────────────────────────────────

export const uploadCertificateSchema = z.object({
  certPem: z.string().min(1, 'Requerido').refine(
    (v) => v.includes('-----BEGIN CERTIFICATE-----'),
    'Debe ser un PEM de certificado válido',
  ),
  keyPem: z.string().min(1, 'Requerido').refine(
    (v) =>
      v.includes('-----BEGIN RSA PRIVATE KEY-----') ||
      v.includes('-----BEGIN PRIVATE KEY-----'),
    'Debe ser una clave privada PEM válida',
  ),
});
export type UploadCertificateInput = z.infer<typeof uploadCertificateSchema>;

// ─── Issuer ─────────────────────────────────────────────

export const createIssuerSchema = z.object({
  cuit: z
    .string()
    .min(1, 'Requerido')
    .refine(validateCuit, 'CUIT inválido — verificá el dígito verificador'),
  businessName: z.string().min(1, 'Requerido'),
  fiscalCondition: z.enum([
    'ResponsableInscripto',
    'Monotributista',
    'ConsumidorFinal',
    'Exento',
    'NoResponsable',
  ] as const),
  ingresosBrutos: z.string().optional(),
  activityStartDate: z.string().optional(), // ISO date string YYYY-MM-DD
  businessAddress: z.string().optional(),
});
export type CreateIssuerInput = z.infer<typeof createIssuerSchema>;

// ─── Punto de Venta ─────────────────────────────────────

export const createPdvSchema = z.object({
  number: z.number().int().min(1, 'El número debe ser mayor a 0'),
  nombre: z.string().optional(),
  tipo: z.string().optional(),
});
export type CreatePdvInput = z.infer<typeof createPdvSchema>;

// ─── Invoice Line Item ───────────────────────────────────

export const lineItemSchema = z.object({
  descripcion: z.string().min(1, 'Requerido'),
  cantidad: z.number().positive('Debe ser mayor a 0'),
  precioUnitario: z.number().nonnegative('Debe ser mayor o igual a 0'),
  alicuotaIvaId: z.number().int(), // AFIP alicuota ID (e.g. 5 = 21%)
});
export type LineItemInput = z.infer<typeof lineItemSchema>;

// ─── Tributo ────────────────────────────────────────────

export const tributoSchema = z.object({
  id: z.number().int(),
  desc: z.string().optional(),
  baseImp: z.number().nonnegative(),
  alic: z.number().nonnegative(),
  importe: z.number().nonnegative(),
});
export type TributoInput = z.infer<typeof tributoSchema>;

// ─── Opcional ───────────────────────────────────────────

export const opcionalSchema = z.object({
  id: z.number().int(),
  valor: z.string(),
});
export type OpcionalInput = z.infer<typeof opcionalSchema>;

// ─── Comprobante Asociado ────────────────────────────────

export const cbtesAsocSchema = z.object({
  tipo: z.number().int(),
  ptoVta: z.number().int(),
  nro: z.number().int(),
  cuit: z.string().optional(),
  fecha: z.string().optional(), // YYYYMMDD
});
export type CbtesAsocInput = z.infer<typeof cbtesAsocSchema>;

// ─── Receptor ───────────────────────────────────────────

export const receptorSchema = z.object({
  docTipo: z.number().int(),
  docNro: z.string().min(1, 'Requerido'),
  razonSocial: z.string().min(1, 'Requerido'),
  condicionIvaReceptorId: z.number().int({ message: 'Requerido' }),
  domicilio: z.string().optional(),
});
export type ReceptorInput = z.infer<typeof receptorSchema>;

// ─── Emit Invoice ────────────────────────────────────────

export const emitInvoiceSchema = z.object({
  clientRequestId: z.string().uuid(),
  issuerId: z.string().uuid('Requerido'),
  pdvId: z.string().uuid('Requerido'),
  cbteTipo: z.number().int(),
  concepto: z.number().int().min(1).max(3).default(2),
  cbteFch: z.string().regex(/^\d{8}$/, 'Formato YYYYMMDD requerido'),
  receptor: receptorSchema,
  items: z.array(lineItemSchema).min(1, 'Se requiere al menos un ítem'),
  // Computed amounts (auto-calculated but editable)
  impNeto: z.number().nonnegative(),
  impIva: z.number().nonnegative(),
  impTotal: z.number().nonnegative(),
  impTotConc: z.number().nonnegative().default(0),
  impOpEx: z.number().nonnegative().default(0),
  impTrib: z.number().nonnegative().default(0),
  monId: z.string().default('PES'),
  monCotiz: z.number().positive().default(1),
  // Advanced / optional
  fchServDesde: z.string().optional(),
  fchServHasta: z.string().optional(),
  fchVtoPago: z.string().optional(),
  periodoAsocDesde: z.string().optional(),
  periodoAsocHasta: z.string().optional(),
  tributos: z.array(tributoSchema).optional(),
  opcionales: z.array(opcionalSchema).optional(),
  cbtesAsoc: z.array(cbtesAsocSchema).optional(),
  // Optional pre-fill
  paymentId: z.string().optional(),
});
export type EmitInvoiceInput = z.infer<typeof emitInvoiceSchema>;

// ─── API DTO shapes (what the API returns) ───────────────

export interface ArcaCertificateDTO {
  id: string;
  commonName: string;
  notBefore: string; // ISO datetime
  notAfter: string;  // ISO datetime
  isProduction: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface ArcaIssuerDTO {
  id: string;
  cuit: string;
  businessName: string;
  fiscalCondition: string;
  ingresosBrutos?: string;
  activityStartDate?: string;
  businessAddress?: string;
  delegationStatus: string;
  delegationVerifiedAt?: string;
  isSelf: boolean;
  isActive: boolean;
  puntosDeVenta: ArcaPdvDTO[];
}

export interface ArcaPdvDTO {
  id: string;
  number: number;
  nombre?: string;
  tipo?: string;
  bloqueado: boolean;
  lastSyncAt?: string;
}

export interface ParamCacheItem {
  id: number;
  desc: string;
}

export interface PadronResult {
  cuit: string;
  razonSocial: string;
  condicionFiscal?: string;
  domicilio?: string;
}

export interface PreviewResult {
  nextNumber: number;
  puntoDeVenta: number;
  cbteTipo: number;
  receptor: string;
  impTotal: number;
  concepto: number;
}

export interface EmitResult {
  id: string;
  cae: string;
  caeFchVto: string;
  numero: number;
  puntoDeVenta: number;
  cbteTipo: number;
}

// ─── NC schema (extends emit) ────────────────────────────

export const emitNcSchema = emitInvoiceSchema.extend({
  originalComprobanteId: z.string().uuid(),
  cbtesAsoc: z.array(cbtesAsocSchema).min(1, 'Se requiere al menos un comprobante asociado'),
});
export type EmitNcInput = z.infer<typeof emitNcSchema>;
