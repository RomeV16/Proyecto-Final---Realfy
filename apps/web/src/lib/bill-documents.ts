import { useEffect, useState } from 'react';
import {
  BILL_PROVIDER_KEYS,
  BILL_REVIEW_REASONS,
  BillDocumentStatus,
  type BillProviderKey,
  type BillReviewReason,
  type ParsedBillLine,
} from '@realfy/shared';
import { apiClient, ApiRequestError } from '@/lib/api-client';

export const BILL_DOCUMENTS_PATH = '/bills-intake/documents';

/** Peso máximo de un PDF que acepta la API. */
export const MAX_BILL_FILE_BYTES = 10 * 1024 * 1024;

/** Cada cuánto se vuelve a contar lo que espera revisión. */
const COUNT_REFRESH_MS = 60_000;

/** Un documento en el listado (`GET /bills-intake/documents`). */
export interface BillDocumentRow {
  id: string;
  channel: string;
  origin: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  providerKey: string | null;
  accountNumber: string | null;
  /** Decimal en texto, de 0 a 1. */
  confidence: string | null;
  status: string;
  reason: string | null;
  serviceId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  service: { id: string; serviceType: string; providerName: string | null; propertyId: string } | null;
  _count: { bills: number };
}

/** Una boleta que el documento dio de alta. */
export interface CreatedBill {
  id: string;
  serviceId: string;
  period: string;
  installmentLabel: string;
  amount: string;
  dueDate: string | null;
  status: string;
}

/** El documento con lo leído (`GET /bills-intake/documents/:id`). */
export interface BillDocumentDetail extends Omit<BillDocumentRow, '_count'> {
  data: { lines?: ParsedBillLine[]; warnings?: string[] } | null;
  bills: CreatedBill[];
  hasFile: boolean;
}

/** El resultado de subir un PDF (un renglón de `results` de `POST /bills-intake/documents`). */
export interface UploadedBillResult {
  fileName: string;
  id?: string;
  status?: string;
  reason?: string | null;
  billIds?: string[];
  duplicate?: boolean;
  error?: { code: string; message: string };
}

const REASONS: readonly string[] = BILL_REVIEW_REASONS;
const PROVIDERS: readonly string[] = BILL_PROVIDER_KEYS;

/** Clave i18n (bajo `billDocuments`) del motivo si es un código conocido; un rechazo trae texto libre y devuelve null. */
export function reasonMessageKey(reason: string | null | undefined): `reasons.${BillReviewReason}` | null {
  return reason && REASONS.includes(reason) ? `reasons.${reason as BillReviewReason}` : null;
}

/** Clave i18n del proveedor del catálogo, o null si no es uno conocido. */
export function providerMessageKey(key: string | null | undefined): `providers.${BillProviderKey}` | null {
  return key && PROVIDERS.includes(key) ? `providers.${key as BillProviderKey}` : null;
}

/** La confianza de la lectura como porcentaje entero ("85 %"), o null. */
export function confidencePercent(confidence: string | null | undefined): number | null {
  if (confidence == null) return null;
  const value = Number(confidence);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** Los documentos que una persona todavía puede aceptar o rechazar. */
export function isReviewable(status: string): boolean {
  return status === BillDocumentStatus.RequiereRevision;
}

/** `AAAA-MM` de un período `AAAA-MM-DD`. */
export const periodMonth = (period: string) => period.slice(0, 7);

/** Por qué no se puede subir un PDF antes de mandarlo, o null si está bien. */
export function pdfProblem(file: Pick<File, 'name' | 'type' | 'size'>): 'notPdf' | 'tooLarge' | null {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 'notPdf';
  return file.size > MAX_BILL_FILE_BYTES ? 'tooLarge' : null;
}

/** Sube un PDF (un pedido por archivo, así cada uno tiene su resultado). */
export async function uploadBillFile(file: File): Promise<UploadedBillResult> {
  const form = new FormData();
  form.append('files', file);
  const response = await apiClient<{ results: UploadedBillResult[] }>(BILL_DOCUMENTS_PATH, { method: 'POST', body: form });
  return response.results[0] ?? { fileName: file.name, error: { code: 'EMPTY_RESPONSE', message: '' } };
}

/** Código de error de la API, o null. */
export const apiErrorCode = (err: unknown) => (err instanceof ApiRequestError ? err.errorCode : null);

/**
 * Cuántas boletas recibidas esperan revisión. Se vuelve a preguntar cada minuto; si no se puede leer queda el último
 * valor (un contador del menú no rompe la pantalla).
 */
export function useBillReviewCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const page = await apiClient<{ total: number }>(
          `${BILL_DOCUMENTS_PATH}?status=${BillDocumentStatus.RequiereRevision}&limit=1`,
        );
        if (!cancelled && typeof page.total === 'number') setCount(page.total);
      } catch {
        // conserva el último valor
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), COUNT_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);
  return enabled ? count : 0;
}
