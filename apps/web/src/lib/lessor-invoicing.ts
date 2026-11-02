import type { InvoicingSettings, LessorInvoicingOverride } from '@realfy/shared';

/* ──────────── Lo que devuelve la API ──────────── */

export interface LessorIssuer {
  id: string;
  cuit: string;
  businessName: string;
  fiscalCondition: string;
  delegationStatus: 'Pending' | 'Active' | 'Revoked';
  delegationVerifiedAt: string | null;
  delegationLastError: string | null;
  isActive: boolean;
  puntosDeVenta: { id: string; number: number; nombre: string | null; bloqueado: boolean }[];
}

/** `GET /persons/:id/invoicing-settings`. */
export interface LessorInvoicingState {
  person: { id: string; name: string; cuit: string | null; fiscalCondition: string | null };
  issuer: LessorIssuer | null;
  /** Lo que definió el locador (cada campo vacío hereda el de la inmobiliaria). */
  override: LessorInvoicingOverride | null;
  autoSince: string | null;
  agencyDefaults: InvoicingSettings;
  effective: InvoicingSettings;
}

export interface InvoiceJob {
  id: string;
  personId: string;
  person?: { id: string; firstName: string; lastName: string };
  sourceType: 'Payment' | 'OwnerStatement';
  sourceId: string;
  kind: 'Factura' | 'NotaCredito';
  status: 'Pendiente' | 'Emitido' | 'Fallido' | 'Omitido';
  attempts: number;
  lastError: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
}

export interface SourceComprobante {
  id: string;
  type: string;
  puntoDeVenta: number;
  numero: number;
  impTotal: string;
  currency: string;
  cae: string;
  emittedAt: string;
  issuer: { id: string; cuit: string; businessName: string; personId: string | null };
  creditNotes: { id: string; numero: number }[];
}

export interface SourceInvoices {
  comprobantes: SourceComprobante[];
  jobs: InvoiceJob[];
}

export interface PendingPage {
  items: InvoiceJob[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RunSummary {
  enqueued: number;
  processed: number;
  emitted: number;
  skipped: number;
  failed: number;
}

/* ──────────── Ayudas ──────────── */

/** Número de comprobante con punto de venta: 0003-00000012. */
export function comprobanteNumber(c: { puntoDeVenta: number; numero: number }): string {
  return `${String(c.puntoDeVenta).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}`;
}

/** Nombre del locador de un trabajo de la cola. */
export function jobPersonName(job: Pick<InvoiceJob, 'person' | 'personId'>): string {
  const p = job.person;
  return p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : job.personId;
}

/** Una configuración propia vacía (sin ningún campo definido). */
export function isEmptyOverride(o: LessorInvoicingOverride | null | undefined): boolean {
  return !o || (o.scope == null && o.when == null && o.vatPct == null);
}

/** Texto del campo vacío del formulario ("hereda") como valor del `<select>`. */
export const INHERIT = '';

/** Cuerpo de `PUT /persons/:id/invoicing-settings` desde los valores del formulario. */
export function overrideBody(form: { scope: string; when: string; vatPct: string }): Record<string, unknown> {
  return {
    scope: form.scope === INHERIT ? null : form.scope,
    when: form.when === INHERIT ? null : form.when,
    vatPct: form.vatPct === INHERIT ? null : Number(form.vatPct),
  };
}
