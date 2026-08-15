'use client';

import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import type { ParamCacheItem, PreviewResult, EmitResult } from '@/lib/schemas/invoices';
import { StepIssuer, type StepIssuerData } from './step-issuer';
import { StepReceptor, type StepReceptorData } from './step-receptor';
import { StepItems, type StepItemsData } from './step-items';
import { StepAdvanced, type StepAdvancedData } from './step-advanced';

/* ── UUID fallback without uuid pkg ── */

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/* ── today helpers ── */

function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function firstOfMonth(): string { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); }
function lastOfMonth(): string { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); }
function toAFIPDate(iso: string): string { return iso.replace(/-/g, ''); } // YYYYMMDD

/* ── Step indicator ── */

const STEPS = ['step1', 'step2', 'step3', 'step4'] as const;

function StepIndicator({ current, labels }: { current: number; labels: string[] }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {labels.map((label, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border-2 transition-colors ${
            idx < current
              ? 'bg-brand-500 border-brand-500 text-white'
              : idx === current
              ? 'bg-white border-brand-500 text-brand-600'
              : 'bg-white border-slate-200 text-slate-400'
          }`}>
            {idx < current ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            ) : idx + 1}
          </div>
          <span className={`text-xs font-medium hidden sm:block ${idx === current ? 'text-slate-900' : 'text-slate-400'}`}>
            {label}
          </span>
          {idx < labels.length - 1 && (
            <div className={`w-8 h-px ${idx < current ? 'bg-brand-500' : 'bg-slate-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Preview dialog ── */

interface PreviewDialogProps {
  preview: PreviewResult | null;
  onClose: () => void;
  onEmit: () => void;
  emitting: boolean;
}

function PreviewDialog({ preview, onClose, onEmit, emitting }: PreviewDialogProps) {
  const t = useTranslations('invoices.newInvoice.preview');
  if (!preview) return null;

  function fmt(n: number) {
    return '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby="preview-title" className="relative z-10 w-full max-w-md bg-white rounded-xl shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 id="preview-title" className="text-base font-semibold text-slate-900">{t('title')}</h2>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">{t('nextNumber')}</span>
            <span className="font-mono font-semibold text-slate-900">
              {String(preview.puntoDeVenta).padStart(4, '0')}-{String(preview.nextNumber).padStart(8, '0')}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">{t('receptor')}</span>
            <span className="text-slate-900">{preview.receptor}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">{t('total')}</span>
            <span className="font-semibold text-slate-900">{fmt(preview.impTotal)}</span>
          </div>
          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
            {t('noCaeYet')}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={onEmit}
            disabled={emitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {emitting && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {emitting ? t('emitting') : t('emit')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main component ── */

export function NewInvoiceForm() {
  const t = useTranslations('invoices.newInvoice');
  const router = useRouter();
  const searchParams = useSearchParams();
  const paymentId = searchParams.get('paymentId') ?? undefined;

  const [step, setStep] = useState(0);
  const [condicionIvaOptions, setCondicionIvaOptions] = useState<ParamCacheItem[]>([]);
  const [alicuotaOptions, setAlicuotaOptions] = useState<ParamCacheItem[]>([]);

  const [issuerData, setIssuerData] = useState<StepIssuerData>({
    issuerId: '',
    pdvId: '',
    cbteTipo: 0,
    concepto: 2,
    cbteFch: todayISO(),
    issuerFiscalCondition: '',
  });

  const [receptorData, setReceptorData] = useState<StepReceptorData>({
    docTipo: 80,
    docNro: '',
    razonSocial: '',
    condicionIvaReceptorId: 0,
    domicilio: '',
  });

  const [itemsData, setItemsData] = useState<StepItemsData>({
    items: [{ descripcion: '', cantidad: 1, precioUnitario: 0, alicuotaIvaId: 5 }],
    amounts: { impNeto: 0, impIva: 0, impTotal: 0, impTotConc: 0, impOpEx: 0, impTrib: 0, monId: 'PES', monCotiz: 1 },
  });

  const [advancedData, setAdvancedData] = useState<StepAdvancedData>({
    periodoDesde: firstOfMonth(),
    periodoHasta: lastOfMonth(),
    fchServDesde: firstOfMonth(),
    fchServHasta: lastOfMonth(),
    fchVtoPago: lastOfMonth(),
    tributos: [],
    opcionales: [],
    cbtesAsoc: [],
  });

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [emitError, setEmitError] = useState('');
  const [clientRequestId] = useState(() => generateId());

  // Load param caches
  useEffect(() => {
    async function loadParams() {
      const [condRes, alicRes] = await Promise.allSettled([
        apiClient<ParamCacheItem[]>('/invoices/param-cache/condicionIvaReceptor'),
        apiClient<ParamCacheItem[]>('/invoices/param-cache/tiposIva'),
      ]);
      if (condRes.status === 'fulfilled') setCondicionIvaOptions(condRes.value);
      if (alicRes.status === 'fulfilled') setAlicuotaOptions(alicRes.value);
    }
    loadParams();
  }, []);

  // If paymentId given, prefill description
  useEffect(() => {
    if (paymentId) {
      setItemsData((prev) => ({
        ...prev,
        items: [{ ...prev.items[0], descripcion: `Pago ref. ${paymentId}` }],
      }));
    }
  }, [paymentId]);

  function buildPayload() {
    return {
      clientRequestId,
      issuerId: issuerData.issuerId,
      pdvId: issuerData.pdvId,
      cbteTipo: issuerData.cbteTipo,
      concepto: issuerData.concepto,
      cbteFch: toAFIPDate(issuerData.cbteFch),
      receptor: {
        docTipo: receptorData.docTipo,
        docNro: receptorData.docNro,
        razonSocial: receptorData.razonSocial,
        condicionIvaReceptorId: receptorData.condicionIvaReceptorId,
        domicilio: receptorData.domicilio || undefined,
      },
      items: itemsData.items,
      impNeto: itemsData.amounts.impNeto,
      impIva: itemsData.amounts.impIva,
      impTotal: itemsData.amounts.impTotal,
      impTotConc: itemsData.amounts.impTotConc,
      impOpEx: itemsData.amounts.impOpEx,
      impTrib: itemsData.amounts.impTrib,
      monId: itemsData.amounts.monId,
      monCotiz: itemsData.amounts.monCotiz,
      periodoAsocDesde: advancedData.periodoDesde ? toAFIPDate(advancedData.periodoDesde) : undefined,
      periodoAsocHasta: advancedData.periodoHasta ? toAFIPDate(advancedData.periodoHasta) : undefined,
      fchServDesde: advancedData.fchServDesde ? toAFIPDate(advancedData.fchServDesde) : undefined,
      fchServHasta: advancedData.fchServHasta ? toAFIPDate(advancedData.fchServHasta) : undefined,
      fchVtoPago: advancedData.fchVtoPago ? toAFIPDate(advancedData.fchVtoPago) : undefined,
      tributos: advancedData.tributos.length > 0 ? advancedData.tributos : undefined,
      opcionales: advancedData.opcionales.length > 0 ? advancedData.opcionales : undefined,
      cbtesAsoc: advancedData.cbtesAsoc.length > 0 ? advancedData.cbtesAsoc : undefined,
      paymentId,
    };
  }

  async function handlePreview() {
    setPreviewing(true);
    setEmitError('');
    try {
      const res = await apiClient<PreviewResult>('/invoices/preview', {
        method: 'POST',
        body: JSON.stringify(buildPayload()),
      });
      setPreview(res);
    } catch (err) {
      // The preview shows the numero AFIP will assign. Inventing one here would
      // let the user confirm an emission against a number that does not exist,
      // so a failed preview has to surface as an error.
      setEmitError(err instanceof ApiRequestError ? err.message : t('emitError'));
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleEmit() {
    setEmitting(true);
    setEmitError('');
    try {
      const res = await apiClient<EmitResult>('/invoices/emit', {
        method: 'POST',
        body: JSON.stringify(buildPayload()),
      });
      setPreview(null);
      // Navigate to detail page
      const pathname = window.location.pathname;
      const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
      router.push(`${localePrefix}/invoices/${res.id}`);
    } catch (err) {
      setEmitError(err instanceof ApiRequestError ? err.message : t('emitError'));
      setPreview(null);
    } finally {
      setEmitting(false);
    }
  }

  const stepLabels = [t('stepLabels.issuer'), t('stepLabels.receptor'), t('stepLabels.items'), t('stepLabels.advanced')];

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <div>
        <StepIndicator current={step} labels={stepLabels} />
      </div>

      {/* Emit error (after preview closes) */}
      {emitError && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert" aria-live="polite">
          {emitError}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        {step === 0 && (
          <StepIssuer
            value={issuerData}
            onChange={setIssuerData}
            onNext={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <StepReceptor
            value={receptorData}
            onChange={setReceptorData}
            onNext={() => setStep(2)}
            onBack={() => setStep(0)}
            condicionIvaOptions={condicionIvaOptions}
          />
        )}
        {step === 2 && (
          <StepItems
            value={itemsData}
            onChange={setItemsData}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
            alicuotaOptions={alicuotaOptions}
          />
        )}
        {step === 3 && (
          <StepAdvanced
            value={advancedData}
            onChange={setAdvancedData}
            onBack={() => setStep(2)}
            onPreview={handlePreview}
            concepto={issuerData.concepto}
          />
        )}
      </div>

      {previewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full" />
        </div>
      )}

      <PreviewDialog
        preview={preview}
        onClose={() => setPreview(null)}
        onEmit={handleEmit}
        emitting={emitting}
      />
    </div>
  );
}
