'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import type { ArcaIssuerDTO, ArcaPdvDTO } from '@/lib/schemas/invoices';

/* ── Add PdV modal ── */

interface AddPdvModalProps {
  issuerId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function AddPdvModal({ issuerId, onClose, onSuccess }: AddPdvModalProps) {
  const t = useTranslations('invoices.fiscal.pdv');
  const [number, setNumber] = useState('');
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = parseInt(number, 10);
    if (!num || num < 1) { setError(t('numberRequired')); return; }
    setSubmitting(true);
    setError('');
    try {
      await apiClient(`/invoices/issuers/${issuerId}/pdv`, {
        method: 'POST',
        body: JSON.stringify({ number: num, nombre: nombre || undefined, tipo: tipo || undefined }),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('addError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-pdv-title"
        className="relative z-10 w-full max-w-md bg-white rounded-xl shadow-xl"
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 id="add-pdv-title" className="text-base font-semibold text-slate-900">{t('addTitle')}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label htmlFor="pdvNumber" className="block text-xs font-medium text-slate-500 mb-1">{t('number')} *</label>
            <input
              id="pdvNumber"
              type="number"
              min={1}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
          <div>
            <label htmlFor="pdvNombre" className="block text-xs font-medium text-slate-500 mb-1">{t('nombre')}</label>
            <input
              id="pdvNombre"
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
          <div>
            <label htmlFor="pdvTipo" className="block text-xs font-medium text-slate-500 mb-1">{t('tipo')}</label>
            <input
              id="pdvTipo"
              type="text"
              value={tipo}
              placeholder="Web Services"
              onChange={(e) => setTipo(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">{error}</div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? t('adding') : t('add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main section ── */

interface PdvSectionProps {
  issuer: ArcaIssuerDTO | null;
  onRefresh: () => void;
}

function formatDate(iso: string | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export function PdvSection({ issuer, onRefresh }: PdvSectionProps) {
  const t = useTranslations('invoices.fiscal.pdv');
  const [addOpen, setAddOpen] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'success' | 'error'>('idle');

  async function handleSyncAfip() {
    if (!issuer) return;
    setSyncLoading(true);
    setSyncStatus('idle');
    try {
      await apiClient(`/invoices/issuers/${issuer.id}/sync-pdv`, { method: 'POST' });
      setSyncStatus('success');
      onRefresh();
    } catch {
      setSyncStatus('error');
    } finally {
      setSyncLoading(false);
    }
  }

  if (!issuer) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-base font-semibold text-slate-900">{t('sectionTitle')}</h2>
        <p className="text-sm text-slate-400 mt-4 text-center py-6">{t('selectIssuer')}</p>
      </div>
    );
  }

  const pdvList: ArcaPdvDTO[] = issuer.puntosDeVenta;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{t('sectionTitle')}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{issuer.businessName} — {issuer.cuit}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSyncAfip}
            disabled={syncLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            <svg className={`w-4 h-4 ${syncLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            {syncLoading ? t('syncing') : t('syncAfip')}
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t('addManual')}
          </button>
        </div>
      </div>

      {syncStatus === 'success' && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm" role="status">{t('syncSuccess')}</div>
      )}
      {syncStatus === 'error' && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">{t('syncError')}</div>
      )}

      {pdvList.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">{t('empty')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border border-slate-100">
                <th className="text-left px-3 py-2.5 font-medium text-slate-600 text-xs">{t('col.number')}</th>
                <th className="text-left px-3 py-2.5 font-medium text-slate-600 text-xs">{t('col.nombre')}</th>
                <th className="text-left px-3 py-2.5 font-medium text-slate-600 text-xs">{t('col.tipo')}</th>
                <th className="text-left px-3 py-2.5 font-medium text-slate-600 text-xs">{t('col.bloqueado')}</th>
                <th className="text-left px-3 py-2.5 font-medium text-slate-600 text-xs">{t('col.lastSync')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pdvList.map((pdv) => (
                <tr key={pdv.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-3 py-3 font-mono text-slate-700">{String(pdv.number).padStart(4, '0')}</td>
                  <td className="px-3 py-3 text-slate-700">{pdv.nombre || '—'}</td>
                  <td className="px-3 py-3 text-slate-600">{pdv.tipo || '—'}</td>
                  <td className="px-3 py-3">
                    {pdv.bloqueado ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-xs font-medium">{t('blocked')}</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 text-xs font-medium">{t('active')}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-500 text-xs">{formatDate(pdv.lastSyncAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <AddPdvModal
          issuerId={issuer.id}
          onClose={() => setAddOpen(false)}
          onSuccess={() => { setAddOpen(false); onRefresh(); }}
        />
      )}
    </div>
  );
}
