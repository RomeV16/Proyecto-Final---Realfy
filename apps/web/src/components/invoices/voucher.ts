import { formatCompNumber } from '@/lib/format';

/** Un comprobante como lo devuelve la API (`GET /invoices` y `GET /invoices/:id`). */
export interface Voucher {
  id: string;
  type: string;
  status?: string | null;
  cbteTipo?: number | null;
  puntoDeVenta: number;
  numero: number;
  issuerId?: string | null;
  receptorName?: string | null;
  receptorFiscalCondition?: string | null;
  docNro?: string | null;
  impTotal?: string | number | null;
  impNeto?: string | number | null;
  impIva?: string | number | null;
  impExento?: string | number | null;
  impTrib?: string | number | null;
  currency?: string | null;
  cae?: string | null;
  caeFchVto?: string | null;
  emittedAt?: string | null;
  createdAt: string;
  fchServDesde?: string | null;
  fchServHasta?: string | null;
  fchVtoPago?: string | null;
  paymentId?: string | null;
  ownerStatementId?: string | null;
  feeInstallmentId?: string | null;
  payment?: { method?: string | null; reference?: string | null; paidAt?: string | null } | null;
  originalComprobante?: VoucherRef | null;
  creditNotes?: VoucherRef[] | null;
}

export interface VoucherRef {
  id: string;
  type: string;
  puntoDeVenta: number;
  numero: number;
  impTotal?: string | number | null;
}

export type VoucherState = 'authorized' | 'credited' | 'pending';

export const isCreditNote = (type: string) => type.startsWith('NotaCredito');
export const isInvoice = (type: string) => type.startsWith('Factura');

/** La letra del comprobante (A, B o C), que es el último carácter del tipo. */
export const voucherLetter = (type: string) => type.slice(-1).toUpperCase();

/** Código de ARCA del tipo de comprobante con tres cifras: 11 -> "011". */
export const voucherCode = (cbteTipo?: number | null) => (cbteTipo == null ? null : String(cbteTipo).padStart(3, '0'));

/** Punto de venta y número: `0001-00000042`. */
export const voucherNumber = (v: Pick<Voucher, 'puntoDeVenta' | 'numero'>) =>
  formatCompNumber(v.puntoDeVenta, v.numero ?? 0);

/** CUIT de once cifras con guiones (`20-12345678-9`); cualquier otro documento queda como vino. */
export function formatDocNumber(doc?: string | null): string | null {
  if (!doc) return null;
  const digits = doc.replace(/\D/g, '');
  return digits.length === 11 ? `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}` : doc;
}

/** Estado frente a ARCA: sin CAE todavía, autorizado, o autorizado y con una nota de crédito encima. */
export function voucherState(v: Pick<Voucher, 'cae' | 'creditNotes'>): VoucherState {
  if (!v.cae) return 'pending';
  return (v.creditNotes?.length ?? 0) > 0 ? 'credited' : 'authorized';
}

/** Importe con signo: una nota de crédito resta. */
export function signedTotal(v: Pick<Voucher, 'type' | 'impTotal'>): number {
  const total = Number(v.impTotal ?? 0);
  if (!Number.isFinite(total)) return 0;
  return isCreditNote(v.type) ? -total : total;
}
