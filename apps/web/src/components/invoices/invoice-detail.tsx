'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { ComprobanteType } from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

/* ──────────── Types ──────────── */

interface ComprobanteData {
  id: string;
  type: string;
  puntoDeVenta: number;
  comprobanteNumber: number;
  receptorName?: string;
  receptorCuit?: string;
  receptorFiscalCondition?: string;
  amount: string | number;
  impNeto?: string | number;
  impIva?: string | number;
  ivaRate?: number;
  currency?: string;
  cae?: string;
  caeExpiration?: string;
  description?: string;
  paymentId?: string;
  originalComprobanteId?: string;
  originalComprobante?: { id: string; type: string; puntoDeVenta: number; comprobanteNumber: number };
  createdAt: string;
}

interface InvoiceDetailProps {
  invoiceId: string;
}

/* ──────────── Helpers ──────────── */

function formatCompNumber(pdv: number, num: number): string {
  return `${String(pdv).padStart(4, '0')}-${String(num).padStart(8, '0')}`;
}

function formatCurrency(amount: string | number | undefined | null): string {
  if (amount == null) return '—';
  return '$ ' + Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

const TYPE_COLORS: Record<string, string> = {
  FacturaA: 'bg-blue-50 text-blue-700 border-blue-200',
  FacturaB: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FacturaC: 'bg-purple-50 text-purple-700 border-purple-200',
  NotaCreditoA: 'bg-red-50 text-red-700 border-red-200',
  NotaCreditoB: 'bg-red-50 text-red-700 border-red-200',
  NotaCreditoC: 'bg-red-50 text-red-700 border-red-200',
  NotaDebitoA: 'bg-amber-50 text-amber-700 border-amber-200',
  NotaDebitoB: 'bg-amber-50 text-amber-700 border-amber-200',
  NotaDebitoC: 'bg-amber-50 text-amber-700 border-amber-200',
};

const NC_TYPES: string[] = [
  ComprobanteType.NotaCreditoA,
  ComprobanteType.NotaCreditoB,
  ComprobanteType.NotaCreditoC,
];

const FACTURA_TYPES: string[] = [
  ComprobanteType.FacturaA,
  ComprobanteType.FacturaB,
  ComprobanteType.FacturaC,
];

/* ──────────── Component ──────────── */

export function InvoiceDetail({ invoiceId }: InvoiceDetailProps) {
  const t = useTranslations('invoices.detail');
  const tTypes = useTranslations('invoices.typesLong');
  const tShortTypes = useTranslations('invoices.types');
  const tInvoices = useTranslations('invoices');
  const tFc = useTranslations('persons.fiscalConditions');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('invoices.errors');
  const { user } = useAuth();

  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [data, setData] = useState<ComprobanteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfDownloading, setPdfDownloading] = useState(false);

  const canEmit = ['Admin', 'Gerente', 'Liquidaciones'].includes(user?.role || '');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient<ComprobanteData>(`/invoices/${invoiceId}`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleDownloadPdf() {
    setPdfDownloading(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/invoices/${invoiceId}/pdf`,
        { credentials: 'include' as RequestCredentials },
      );
      if (!response.ok) throw new Error('PDF download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comprobante-${data?.type}-${data?.comprobanteNumber || invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Could add error feedback
    } finally {
      setPdfDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h2 className="text-lg font-semibold text-slate-900">{tErrors('notFound')}</h2>
        <Link href={`${localePrefix}/invoices`} className="mt-4 text-sm text-brand-600 hover:text-brand-700">
          ← {t('back')}
        </Link>
      </div>
    );
  }

  const isNC = NC_TYPES.includes(data.type);
  const isFactura = FACTURA_TYPES.includes(data.type);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Back link */}
      <Link href={`${localePrefix}/invoices`} className="text-sm text-brand-600 hover:text-brand-700">
        ← {t('back')}
      </Link>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-semibold border ${TYPE_COLORS[data.type] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                {tTypes(data.type)}
              </span>
            </div>
            <p className="text-xl font-bold text-slate-900 font-mono tabular-nums">
              {formatCompNumber(data.puntoDeVenta, data.comprobanteNumber)}
            </p>
            <p className="text-xs text-slate-400">{t('createdAt')}: {formatDate(data.createdAt)}</p>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <p className="text-2xl font-bold text-slate-900 tabular-nums">
              {isNC ? '- ' : ''}{formatCurrency(data.amount)}
            </p>
            {/* PDF download */}
            <button
              onClick={handleDownloadPdf}
              disabled={pdfDownloading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {pdfDownloading ? tInvoices('downloading') : tInvoices('downloadPdf')}
            </button>
            {/* Emit NC button for facturas */}
            {isFactura && canEmit && (
              <Link href={`${localePrefix}/invoices/${invoiceId}?action=emit-nc`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
              >
                {tInvoices('emitNC')}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Receptor info */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900 pb-2 border-b border-slate-100">{t('receptor')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-slate-500">{t('receptor')}</p>
            <p className="text-sm font-medium text-slate-900">{data.receptorName || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">{t('receptorCuit')}</p>
            <p className="text-sm font-mono text-slate-700">{data.receptorCuit || '—'}</p>
          </div>
          {data.receptorFiscalCondition && (
            <div>
              <p className="text-xs text-slate-500">{t('receptorFiscalCondition')}</p>
              <p className="text-sm text-slate-700">{tFc(data.receptorFiscalCondition)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Amounts */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900 pb-2 border-b border-slate-100">{t('amount')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {data.impNeto != null && Number(data.impNeto) > 0 && (
            <div>
              <p className="text-xs text-slate-500">{t('netAmount')}</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900">{formatCurrency(data.impNeto)}</p>
            </div>
          )}
          {data.impIva != null && Number(data.impIva) > 0 && (
            <div>
              <p className="text-xs text-slate-500">{t('ivaAmount')} {data.ivaRate ? `(${data.ivaRate}%)` : ''}</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900">{formatCurrency(data.impIva)}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-slate-500">{t('amount')}</p>
            <p className="text-lg font-bold tabular-nums text-slate-900">{formatCurrency(data.amount)}</p>
          </div>
          {data.currency && (
            <div>
              <p className="text-xs text-slate-500">{t('currency')}</p>
              <p className="text-sm text-slate-700">{data.currency}</p>
            </div>
          )}
        </div>
      </div>

      {/* CAE & Description */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-slate-500">{t('cae')}</p>
            <p className="text-sm font-mono font-semibold text-slate-900">{data.cae || '—'}</p>
          </div>
          {data.caeExpiration && (
            <div>
              <p className="text-xs text-slate-500">{t('caeExpiration')}</p>
              <p className="text-sm text-slate-700">{formatDate(data.caeExpiration)}</p>
            </div>
          )}
        </div>
        {data.description && (
          <div>
            <p className="text-xs text-slate-500">{t('description')}</p>
            <p className="text-sm text-slate-700">{data.description}</p>
          </div>
        )}
      </div>

      {/* Original comprobante (for NC) */}
      {isNC && data.originalComprobante && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <p className="text-xs text-slate-500 mb-1">{t('originalComprobante')}</p>
          <Link href={`${localePrefix}/invoices/${data.originalComprobante.id}`}
            className="text-sm text-brand-600 hover:text-brand-700 font-medium"
          >
            {tShortTypes(data.originalComprobante.type)} {formatCompNumber(data.originalComprobante.puntoDeVenta, data.originalComprobante.comprobanteNumber)} →
          </Link>
        </div>
      )}

      {/* Payment link */}
      {data.paymentId && (
        <div className="text-xs text-slate-400">
          {t('payment')}: <span className="font-mono">{data.paymentId}</span>
        </div>
      )}
    </div>
  );
}
