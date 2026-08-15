'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import type { EmitResult } from '@/lib/schemas/invoices';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function toAFIPDate(iso: string): string { return iso.replace(/-/g, ''); }
function fmt(n: number) { return '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function formatDate(iso: string) { try { return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return iso; } }

/* ── Types ── */

interface OriginalComprobante {
  id: string;
  type: string;
  puntoDeVenta: number;
  numero: number;
  cbteTipo: number;
  issuerId: string;
  issuer?: { id: string; cuit: string };
  impTotal: number;
  receptorName: string;
  docNro: string;
  docTipo: number;
  condicionIVAReceptorId?: number;
  emittedAt: string;
}

interface NcInvoiceFormProps {
  originalInvoiceId: string;
}

export function NcInvoiceForm({ originalInvoiceId }: NcInvoiceFormProps) {
  const t = useTranslations('invoices.nc');
  const router = useRouter();

  const [original, setOriginal] = useState<OriginalComprobante | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [amount, setAmount] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fchServDesde, setFchServDesde] = useState('');
  const [fchServHasta, setFchServHasta] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [clientRequestId] = useState(() => generateId());

  const fetchOriginal = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient<OriginalComprobante>(`/invoices/${originalInvoiceId}`);
      setOriginal(res);
      setAmount(String(res.impTotal));
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [originalInvoiceId]);

  useEffect(() => { fetchOriginal(); }, [fetchOriginal]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!original) return;
    setSubmitting(true);
    setError('');

    const impTotal = parseFloat(amount) || 0;
    const ivaRate = 0.21;
    const impIva = impTotal / (1 + ivaRate) * ivaRate;
    const impNeto = impTotal - impIva;

    try {
      const payload = {
        clientRequestId,
        issuerId: original.issuerId,
        originalComprobanteId: original.id,
        cbteTipo: getNcType(original.cbteTipo),
        concepto: 2,
        cbteFch: toAFIPDate(new Date().toISOString().slice(0, 10)),
        receptor: {
          docTipo: original.docTipo,
          docNro: original.docNro,
          razonSocial: original.receptorName,
          condicionIvaReceptorId: original.condicionIVAReceptorId ?? 5,
        },
        items: [{ descripcion, cantidad: 1, precioUnitario: impNeto, alicuotaIvaId: 5 }],
        impNeto,
        impIva,
        impTotal,
        impTotConc: 0,
        impOpEx: 0,
        impTrib: 0,
        monId: 'PES',
        monCotiz: 1,
        fchServDesde: fchServDesde ? toAFIPDate(fchServDesde) : undefined,
        fchServHasta: fchServHasta ? toAFIPDate(fchServHasta) : undefined,
        cbtesAsoc: [{
          tipo: original.cbteTipo,
          ptoVta: original.puntoDeVenta,
          nro: original.numero,
          cuit: original.issuer?.cuit,
        }],
      };

      const res = await apiClient<EmitResult>('/invoices/emit-nc', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const pathname = window.location.pathname;
      const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
      router.push(`${localePrefix}/invoices/${res.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('emitError'));
    } finally {
      setSubmitting(false);
    }
  }

  // Determine NC tipo from original factura type
  function getNcType(originalTipo: number): number {
    // A → NC A (3), B → NC B (8), C → NC C (13)
    const map: Record<number, number> = { 1: 3, 6: 8, 11: 13 };
    return map[originalTipo] ?? 3;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (notFound || !original) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h2 className="text-lg font-semibold text-slate-900">{t('notFound')}</h2>
      </div>
    );
  }

  const isValid = !!descripcion && parseFloat(amount) > 0;

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      {/* Original comprobante card */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
        <p className="text-xs font-medium text-slate-500">{t('originalLabel')}</p>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">
            {String(original.puntoDeVenta).padStart(4, '0')}-{String(original.numero).padStart(8, '0')}
          </p>
          <p className="text-sm font-semibold text-slate-900">{fmt(original.impTotal)}</p>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{original.receptorName}</span>
          <span>{formatDate(original.emittedAt)}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        {/* Receptor (pre-filled, read-only display) */}
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">{t('receptor')}</p>
          <p className="text-sm font-medium text-slate-900">{original.receptorName}</p>
          <p className="text-xs text-slate-400 font-mono">{original.docNro}</p>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="ncDescripcion" className="block text-xs font-medium text-slate-500 mb-1">{t('descripcion')} *</label>
          <input
            id="ncDescripcion"
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder={t('descripcionPlaceholder')}
            required
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
        </div>

        {/* Amount */}
        <div>
          <label htmlFor="ncAmount" className="block text-xs font-medium text-slate-500 mb-1">{t('amount')} *</label>
          <input
            id="ncAmount"
            type="number"
            min="0.01"
            step="0.01"
            max={original.impTotal}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
          <p className="text-xs text-slate-400 mt-1">
            {t('amountHint', { max: fmt(original.impTotal) })}
          </p>
        </div>

        {/* Service dates (optional) */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ncFchDesde" className="block text-xs font-medium text-slate-500 mb-1">{t('fchServDesde')}</label>
            <input
              id="ncFchDesde"
              type="date"
              value={fchServDesde}
              onChange={(e) => setFchServDesde(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
          <div>
            <label htmlFor="ncFchHasta" className="block text-xs font-medium text-slate-500 mb-1">{t('fchServHasta')}</label>
            <input
              id="ncFchHasta"
              type="date"
              value={fchServHasta}
              onChange={(e) => setFchServHasta(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert" aria-live="polite">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={submitting || !isValid}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {submitting ? t('submitting') : t('submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
