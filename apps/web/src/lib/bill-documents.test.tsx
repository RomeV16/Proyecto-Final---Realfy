// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

import { BILL_PROVIDER_KEYS, BILL_REVIEW_REASONS, BillChannel, BillDocumentStatus } from '@realfy/shared';
import { ApiRequestError } from '@/lib/api-client';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import {
  apiErrorCode,
  confidencePercent,
  isReviewable,
  pdfProblem,
  providerMessageKey,
  reasonMessageKey,
  uploadBillFile,
  useBillReviewCount,
} from './bill-documents';

describe('bill-documents', () => {
  beforeEach(() => apiClient.mockReset());

  it('traduce sólo los códigos de motivo y proveedor conocidos', () => {
    expect(reasonMessageKey('LOW_CONFIDENCE')).toBe('reasons.LOW_CONFIDENCE');
    expect(reasonMessageKey('Importe ilegible')).toBeNull();
    expect(reasonMessageKey(null)).toBeNull();
    expect(providerMessageKey('epec')).toBe('providers.epec');
    expect(providerMessageKey('otro')).toBeNull();
    expect(providerMessageKey(undefined)).toBeNull();
  });

  it('muestra la confianza como porcentaje entero', () => {
    expect(confidencePercent('0.853')).toBe(85);
    expect(confidencePercent(null)).toBeNull();
    expect(confidencePercent('x')).toBeNull();
  });

  it('sólo se revisa lo que está en revisión', () => {
    expect(isReviewable('RequiereRevision')).toBe(true);
    expect(isReviewable('Procesada')).toBe(false);
  });

  it('rechaza antes de subir lo que no es PDF o pesa más de 10 MB', () => {
    expect(pdfProblem({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toBeNull();
    expect(pdfProblem({ name: 'A.PDF', type: '', size: 10 })).toBeNull();
    expect(pdfProblem({ name: 'a.png', type: 'image/png', size: 10 })).toBe('notPdf');
    expect(pdfProblem({ name: 'a.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 })).toBe('tooLarge');
  });

  it('sube un PDF como multipart y devuelve su resultado', async () => {
    apiClient.mockResolvedValueOnce({ total: 1, results: [{ fileName: 'a.pdf', id: 'd1', status: 'Procesada' }] });
    const file = new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' });
    await expect(uploadBillFile(file)).resolves.toMatchObject({ id: 'd1', status: 'Procesada' });
    const [path, options] = apiClient.mock.calls[0];
    expect(path).toBe('/bills-intake/documents');
    expect(options.method).toBe('POST');
    expect((options.body as FormData).getAll('files')).toHaveLength(1);
  });

  it('una respuesta sin resultados es un error de la subida', async () => {
    apiClient.mockResolvedValueOnce({ total: 0, results: [] });
    const result = await uploadBillFile(new File(['x'], 'a.pdf'));
    expect(result.error?.code).toBe('EMPTY_RESPONSE');
  });

  it('lee el código de un error de la API', () => {
    expect(apiErrorCode(new ApiRequestError(409, 'DOCUMENT_NOT_REVIEWABLE', 'x'))).toBe('DOCUMENT_NOT_REVIEWABLE');
    expect(apiErrorCode(new Error('x'))).toBeNull();
  });
});

describe('textos de boletas recibidas', () => {
  it.each([
    ['es', es],
    ['en', en],
  ])('%s: cada motivo, proveedor, canal y estado tiene su texto', (_lang, messages) => {
    const block = messages.billDocuments;
    for (const reason of BILL_REVIEW_REASONS) expect(block.reasons[reason], reason).toBeTruthy();
    for (const provider of BILL_PROVIDER_KEYS) expect(block.providers[provider], provider).toBeTruthy();
    for (const channel of Object.values(BillChannel)) expect(block.channels[channel], channel).toBeTruthy();
    for (const status of Object.values(BillDocumentStatus)) expect(block.statuses[status], status).toBeTruthy();
  });
});

describe('useBillReviewCount', () => {
  beforeEach(() => {
    apiClient.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('cuenta lo que espera revisión y lo refresca cada minuto', async () => {
    apiClient.mockResolvedValueOnce({ total: 3 }).mockResolvedValueOnce({ total: 5 });
    const { result } = renderHook(() => useBillReviewCount(true));
    await act(async () => {});
    expect(result.current).toBe(3);
    expect(apiClient.mock.calls[0][0]).toContain('status=RequiereRevision');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current).toBe(5);
  });

  it('sin permiso no pregunta nada', () => {
    const { result } = renderHook(() => useBillReviewCount(false));
    expect(result.current).toBe(0);
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('si falla conserva el último valor', async () => {
    apiClient.mockResolvedValueOnce({ total: 2 }).mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useBillReviewCount(true));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current).toBe(2);
    expect(apiClient).toHaveBeenCalledTimes(2);
  });
});
