'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import type { ArcaCertificateDTO } from '@/lib/schemas/invoices';

/* ── Helpers ── */

function daysUntil(isoDate: string): number {
  const diff = new Date(isoDate).getTime() - Date.now();
  return Math.floor(diff / 86_400_000);
}

function CertExpiryBadge({ notAfter }: { notAfter: string }) {
  const days = daysUntil(notAfter);
  if (days > 60) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 text-green-700 text-xs font-medium px-2.5 py-0.5">
        {days} días
      </span>
    );
  }
  if (days >= 30) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium px-2.5 py-0.5">
        {days} días
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-medium px-2.5 py-0.5">
      {days < 0 ? 'Vencido' : `${days} días`}
    </span>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return iso; }
}

/* ── Validate PEM ── */

function validatePem(pem: string, type: 'cert' | 'key'): string | null {
  if (type === 'cert' && !pem.includes('-----BEGIN CERTIFICATE-----')) {
    return 'Debe incluir -----BEGIN CERTIFICATE-----';
  }
  if (type === 'key' && !pem.includes('-----BEGIN') && !pem.includes('PRIVATE KEY')) {
    return 'Debe ser una clave privada PEM válida';
  }
  return null;
}

/* ── Props ── */

interface CertificateSectionProps {
  cert: ArcaCertificateDTO | null;
  onRefresh: () => void;
}

/* ── Upload form ── */

function UploadForm({ onSuccess }: { onSuccess: () => void }) {
  const t = useTranslations('invoices.fiscal.cert');
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [certFile, setCertFile] = useState('');
  const [keyFile, setKeyFile] = useState('');
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ cert?: string; key?: string }>({});

  function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsText(file);
    });
  }

  async function handleFileChange(
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (v: string) => void,
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await readFile(file);
    setter(text);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const finalCert = mode === 'file' ? certFile : certPem;
    const finalKey = mode === 'file' ? keyFile : keyPem;

    const errs: { cert?: string; key?: string } = {};
    const certErr = validatePem(finalCert, 'cert');
    const keyErr = validatePem(finalKey, 'key');
    if (certErr) errs.cert = certErr;
    if (keyErr) errs.key = keyErr;
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }
    setFieldErrors({});
    setSubmitting(true);
    setError('');
    try {
      await apiClient('/invoices/certificate', {
        method: 'POST',
        body: JSON.stringify({ certPem: finalCert, keyPem: finalKey }),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('uploadError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Empty state teaching text */}
      <div className="flex flex-col items-center justify-center py-8 text-center bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
        <svg className="w-12 h-12 text-slate-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 10.5v6m3-3H9m4.06-7.19-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
        </svg>
        <p className="text-sm font-medium text-slate-700">{t('emptyTitle')}</p>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">{t('emptySubtitle')}</p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode('file')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'file' ? 'bg-brand-500 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
        >
          {t('modeFile')}
        </button>
        <button
          type="button"
          onClick={() => setMode('paste')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'paste' ? 'bg-brand-500 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
        >
          {t('modePaste')}
        </button>
      </div>

      {mode === 'file' ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="certFile" className="block text-xs font-medium text-slate-500 mb-1">
              {t('certLabel')} (.crt / .pem / .cer)
            </label>
            <input
              id="certFile"
              type="file"
              accept=".crt,.pem,.cer"
              onChange={(e) => handleFileChange(e, setCertFile)}
              className="block w-full text-sm text-slate-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-200 file:text-xs file:font-medium file:text-slate-600 file:bg-white hover:file:bg-slate-50 file:cursor-pointer"
            />
            {certFile && <p className="text-xs text-emerald-600 mt-1">Archivo cargado correctamente</p>}
            {fieldErrors.cert && <p className="text-xs text-red-600 mt-1" role="alert">{fieldErrors.cert}</p>}
          </div>
          <div>
            <label htmlFor="keyFile" className="block text-xs font-medium text-slate-500 mb-1">
              {t('keyLabel')} (.key / .pem)
            </label>
            <input
              id="keyFile"
              type="file"
              accept=".key,.pem"
              onChange={(e) => handleFileChange(e, setKeyFile)}
              className="block w-full text-sm text-slate-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-200 file:text-xs file:font-medium file:text-slate-600 file:bg-white hover:file:bg-slate-50 file:cursor-pointer"
            />
            {keyFile && <p className="text-xs text-emerald-600 mt-1">Archivo cargado correctamente</p>}
            {fieldErrors.key && <p className="text-xs text-red-600 mt-1" role="alert">{fieldErrors.key}</p>}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="certPem" className="block text-xs font-medium text-slate-500 mb-1">
              {t('certLabel')} (PEM)
            </label>
            <textarea
              id="certPem"
              value={certPem}
              onChange={(e) => setCertPem(e.target.value)}
              rows={6}
              placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-y"
            />
            {fieldErrors.cert && <p className="text-xs text-red-600 mt-1" role="alert">{fieldErrors.cert}</p>}
          </div>
          <div>
            <label htmlFor="keyPem" className="block text-xs font-medium text-slate-500 mb-1">
              {t('keyLabel')} (PEM)
            </label>
            <textarea
              id="keyPem"
              value={keyPem}
              onChange={(e) => setKeyPem(e.target.value)}
              rows={6}
              placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-y"
            />
            {fieldErrors.key && <p className="text-xs text-red-600 mt-1" role="alert">{fieldErrors.key}</p>}
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="px-6 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? t('uploading') : t('upload')}
      </button>
    </form>
  );
}

/* ── Main section ── */

export function CertificateSection({ cert, onRefresh }: CertificateSectionProps) {
  const t = useTranslations('invoices.fiscal.cert');
  const [isProduction, setIsProduction] = useState(cert?.isProduction ?? false);
  const [saving, setSaving] = useState(false);

  async function handleToggleProduction() {
    setSaving(true);
    try {
      await apiClient('/invoices/certificate/production', {
        method: 'PATCH',
        body: JSON.stringify({ isProduction: !isProduction }),
      });
      setIsProduction((v) => !v);
    } catch {
      // silent — could add toast
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t('sectionTitle')}</h2>
        <p className="text-sm text-slate-500 mt-0.5">{t('sectionSubtitle')}</p>
      </div>

      {!cert ? (
        <UploadForm onSuccess={onRefresh} />
      ) : (
        <div className="space-y-4">
          {/* Cert details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500">{t('commonName')}</p>
              <p className="text-sm font-medium text-slate-900 font-mono">{cert.commonName}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('notBefore')}</p>
              <p className="text-sm text-slate-700">{formatDate(cert.notBefore)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('notAfter')}</p>
              <div className="flex items-center gap-2">
                <p className="text-sm text-slate-700">{formatDate(cert.notAfter)}</p>
                <CertExpiryBadge notAfter={cert.notAfter} />
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('environment')}</p>
              <span className={`inline-flex items-center gap-1 rounded-full text-xs font-medium px-2.5 py-0.5 ${isProduction ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                {isProduction ? t('production') : t('sandbox')}
              </span>
            </div>
          </div>

          {/* Toggle production + Renew button */}
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
            <label className="flex items-center gap-3 cursor-pointer">
              <button
                type="button"
                role="switch"
                aria-checked={isProduction}
                onClick={handleToggleProduction}
                disabled={saving}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${isProduction ? 'bg-brand-500' : 'bg-slate-200'}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isProduction ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
              <span className="text-sm font-medium text-slate-700">{t('isProduction')}</span>
            </label>

            <button
              type="button"
              onClick={onRefresh}
              className="ml-auto px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              {t('renew')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
