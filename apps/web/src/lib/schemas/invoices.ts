/**
 * Shapes of the invoice and fiscal-settings payloads returned by the API,
 * consumed by the invoice wizard and fiscal settings components.
 */

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
