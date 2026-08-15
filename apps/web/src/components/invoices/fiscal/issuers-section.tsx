'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { FiscalCondition } from '@realfy/shared';
import type { ArcaIssuerDTO } from '@/lib/schemas/invoices';

/* ── Delegation badge ── */

const DELEGATION_BADGE: Record<string, { label: string; cls: string }> = {
  Pending: { label: 'Pendiente', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  Active:  { label: 'Activa',    cls: 'bg-green-50 text-green-700 border-green-200' },
  Revoked: { label: 'Revocada',  cls: 'bg-red-50 text-red-700 border-red-200' },
};

function DelegationBadge({ status }: { status: string }) {
  const cfg = DELEGATION_BADGE[status] ?? DELEGATION_BADGE['Pending'];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

/* ── CUIT validation ── */

function validateCuit(raw: string): boolean {
  const clean = raw.replace(/[-\s]/g, '');
  if (!/^\d{11}$/.test(clean)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(clean[i]), 0);
  const rem = sum % 11;
  const chk = rem === 0 ? 0 : rem === 1 ? 9 : 11 - rem;
  return chk === Number(clean[10]);
}

/* ── Add Issuer Modal ── */

interface AddIssuerModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function AddIssuerModal({ onClose, onSuccess }: AddIssuerModalProps) {
  const t = useTranslations('invoices.fiscal.issuers');
  const tFc = useTranslations('persons.fiscalConditions');

  const [cuit, setCuit] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [fiscalCondition, setFiscalCondition] = useState<string>(FiscalCondition.ResponsableInscripto);
  const [iibb, setIibb] = useState('');
  const [activityStartDate, setActivityStartDate] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [cuitError, setCuitError] = useState('');

  function handleCuitBlur() {
    if (cuit && !validateCuit(cuit)) {
      setCuitError(t('cuitInvalid'));
    } else {
      setCuitError('');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateCuit(cuit)) {
      setCuitError(t('cuitInvalid'));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const body = {
        cuit: cuit.replace(/[-\s]/g, ''),
        businessName,
        fiscalCondition,
        ingresosBrutos: iibb || undefined,
        activityStartDate: activityStartDate || undefined,
        businessAddress: businessAddress || undefined,
      };
      await apiClient('/invoices/issuers', { method: 'POST', body: JSON.stringify(body) });
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
        aria-labelledby="add-issuer-title"
        className="relative z-10 w-full max-w-lg bg-white rounded-xl shadow-xl"
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 id="add-issuer-title" className="text-base font-semibold text-slate-900">{t('addTitle')}</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* CUIT */}
          <div>
            <label htmlFor="issuerCuit" className="block text-xs font-medium text-slate-500 mb-1">{t('cuit')} *</label>
            <input
              id="issuerCuit"
              type="text"
              value={cuit}
              onChange={(e) => setCuit(e.target.value)}
              onBlur={handleCuitBlur}
              placeholder="20-12345678-9"
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
            {cuitError && <p className="text-xs text-red-600 mt-1" role="alert">{cuitError}</p>}
          </div>

          {/* Business name */}
          <div>
            <label htmlFor="issuerName" className="block text-xs font-medium text-slate-500 mb-1">{t('businessName')} *</label>
            <input
              id="issuerName"
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>

          {/* Fiscal condition */}
          <div>
            <label htmlFor="issuerFc" className="block text-xs font-medium text-slate-500 mb-1">{t('fiscalCondition')} *</label>
            <select
              id="issuerFc"
              value={fiscalCondition}
              onChange={(e) => setFiscalCondition(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              {Object.values(FiscalCondition).map((fc) => (
                <option key={fc} value={fc}>{tFc(fc)}</option>
              ))}
            </select>
          </div>

          {/* IIBB (optional) */}
          <div>
            <label htmlFor="issuerIibb" className="block text-xs font-medium text-slate-500 mb-1">{t('iibb')}</label>
            <input
              id="issuerIibb"
              type="text"
              value={iibb}
              onChange={(e) => setIibb(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>

          {/* Activity start date (optional) */}
          <div>
            <label htmlFor="issuerActivity" className="block text-xs font-medium text-slate-500 mb-1">{t('activityStartDate')}</label>
            <input
              id="issuerActivity"
              type="date"
              value={activityStartDate}
              onChange={(e) => setActivityStartDate(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>

          {/* Business address (optional) */}
          <div>
            <label htmlFor="issuerAddress" className="block text-xs font-medium text-slate-500 mb-1">{t('businessAddress')}</label>
            <input
              id="issuerAddress"
              type="text"
              value={businessAddress}
              onChange={(e) => setBusinessAddress(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">{error}</div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? t('adding') : t('add')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main section ── */

interface IssuersSectionProps {
  issuers: ArcaIssuerDTO[];
  selectedIssuerId: string | null;
  onSelectIssuer: (id: string) => void;
  onRefresh: () => void;
}

export function IssuersSection({ issuers, selectedIssuerId, onSelectIssuer, onRefresh }: IssuersSectionProps) {
  const t = useTranslations('invoices.fiscal.issuers');
  const tFc = useTranslations('persons.fiscalConditions');
  const [addOpen, setAddOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function handleVerifyDelegation(id: string) {
    setActionLoading(id + '-verify');
    try {
      await apiClient(`/invoices/issuers/${id}/verify-delegation`, { method: 'POST' });
      onRefresh();
    } catch { /* silent */ } finally {
      setActionLoading(null);
    }
  }

  async function handleSyncPdv(id: string) {
    setActionLoading(id + '-sync');
    try {
      await apiClient(`/invoices/issuers/${id}/sync-pdv`, { method: 'POST' });
      onRefresh();
    } catch { /* silent */ } finally {
      setActionLoading(null);
    }
  }

  async function handleDeactivate(id: string) {
    setActionLoading(id + '-deact');
    try {
      await apiClient(`/invoices/issuers/${id}/deactivate`, { method: 'PATCH' });
      onRefresh();
    } catch { /* silent */ } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{t('sectionTitle')}</h2>
          <p className="text-sm text-slate-500 mt-0.5">{t('sectionSubtitle')}</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {t('add')}
        </button>
      </div>

      {issuers.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">{t('empty')}</div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border border-slate-100 rounded-lg">
                  <th className="text-left px-3 py-2.5 font-medium text-slate-600 text-xs">CUIT</th>
                  <th className="text-left px-3 py-2.5 font-medium text-slate-600 text-xs">{t('col.businessName')}</th>
                  <th className="text-left px-3 py-2.5 font-medium text-slate-600 text-xs">{t('col.fiscalCondition')}</th>
                  <th className="text-left px-3 py-2.5 font-medium text-slate-600 text-xs">{t('col.delegationStatus')}</th>
                  <th className="text-left px-3 py-2.5 font-medium text-slate-600 text-xs">{t('col.pdvCount')}</th>
                  <th className="text-right px-3 py-2.5 font-medium text-slate-600 text-xs">{t('col.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {issuers.map((issuer) => (
                  <tr
                    key={issuer.id}
                    onClick={() => onSelectIssuer(issuer.id)}
                    className={`hover:bg-slate-50/70 transition-colors cursor-pointer ${selectedIssuerId === issuer.id ? 'bg-brand-50/50' : ''}`}
                  >
                    <td className="px-3 py-3 font-mono text-slate-700 text-xs">
                      {issuer.cuit}
                      {issuer.isSelf && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-violet-50 text-violet-700 border border-violet-200">
                          Mi inmobiliaria
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-900 font-medium">{issuer.businessName}</td>
                    <td className="px-3 py-3 text-slate-600">{tFc(issuer.fiscalCondition)}</td>
                    <td className="px-3 py-3">
                      <DelegationBadge status={issuer.delegationStatus} />
                    </td>
                    <td className="px-3 py-3 text-slate-600">{issuer.puntosDeVenta.length}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleVerifyDelegation(issuer.id)}
                          disabled={actionLoading === issuer.id + '-verify'}
                          className="text-xs text-brand-600 hover:text-brand-700 disabled:opacity-50"
                        >
                          {t('action.verify')}
                        </button>
                        <button
                          onClick={() => handleSyncPdv(issuer.id)}
                          disabled={actionLoading === issuer.id + '-sync'}
                          className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
                        >
                          {t('action.syncPdv')}
                        </button>
                        <button
                          onClick={() => handleDeactivate(issuer.id)}
                          disabled={actionLoading === issuer.id + '-deact'}
                          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                        >
                          {t('action.deactivate')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {issuers.map((issuer) => (
              <div
                key={issuer.id}
                onClick={() => onSelectIssuer(issuer.id)}
                className={`p-4 rounded-xl border cursor-pointer transition-colors ${selectedIssuerId === issuer.id ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{issuer.businessName}</p>
                    <p className="text-xs font-mono text-slate-500">{issuer.cuit}</p>
                  </div>
                  <DelegationBadge status={issuer.delegationStatus} />
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{tFc(issuer.fiscalCondition)}</span>
                  <span>{issuer.puntosDeVenta.length} PdV</span>
                </div>
                <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handleVerifyDelegation(issuer.id)}
                    className="text-xs text-brand-600 hover:text-brand-700"
                  >
                    {t('action.verify')}
                  </button>
                  <button
                    onClick={() => handleSyncPdv(issuer.id)}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    {t('action.syncPdv')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {addOpen && (
        <AddIssuerModal
          onClose={() => setAddOpen(false)}
          onSuccess={() => { setAddOpen(false); onRefresh(); }}
        />
      )}
    </div>
  );
}
