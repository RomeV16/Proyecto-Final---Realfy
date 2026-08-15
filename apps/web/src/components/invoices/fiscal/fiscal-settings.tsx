'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/api-client';
import { useState, useEffect, useCallback } from 'react';
import { CertificateSection } from './certificate-section';
import { IssuersSection } from './issuers-section';
import { PdvSection } from './pdv-section';
import type { ArcaCertificateDTO, ArcaIssuerDTO } from '@/lib/schemas/invoices';

type TabKey = 'cert' | 'issuers' | 'pdv';

interface FiscalData {
  certificate: ArcaCertificateDTO | null;
  issuers: ArcaIssuerDTO[];
}

export function FiscalSettings() {
  const t = useTranslations('invoices.fiscal');
  const { user } = useAuth();

  const [tab, setTab] = useState<TabKey>('cert');
  const [data, setData] = useState<FiscalData>({ certificate: null, issuers: [] });
  const [loading, setLoading] = useState(true);
  const [selectedIssuerId, setSelectedIssuerId] = useState<string | null>(null);

  const canAccess = ['Admin', 'Gerente'].includes(user?.role || '');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cert, issuers] = await Promise.allSettled([
        apiClient<ArcaCertificateDTO>('/invoices/certificate'),
        apiClient<ArcaIssuerDTO[]>('/invoices/issuers'),
      ]);
      setData({
        certificate: cert.status === 'fulfilled' ? cert.value : null,
        issuers: issuers.status === 'fulfilled' ? issuers.value : [],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canAccess) fetchData();
    else setLoading(false);
  }, [canAccess, fetchData]);

  const selectedIssuer = data.issuers.find((i) => i.id === selectedIssuerId) ?? null;

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">{t('forbidden')}</h2>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'cert', label: t('tabs.cert') },
    { key: 'issuers', label: t('tabs.issuers') },
    { key: 'pdv', label: t('tabs.pdv') },
  ];

  /* Cert expiry check */
  const certDaysLeft = data.certificate
    ? Math.floor((new Date(data.certificate.notAfter).getTime() - Date.now()) / 86_400_000)
    : null;
  const certExpiringSoon = certDaysLeft !== null && certDaysLeft <= 30;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      {/* Cert expiry banner */}
      {certExpiringSoon && (
        <div className="flex items-center gap-4 p-4 rounded-xl bg-red-50 border border-red-200">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-red-800">{t('cert.expiryWarning', { days: certDaysLeft })}</p>
              <p className="text-xs text-red-700">{t('cert.expiryWarningHint')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-1" role="tablist">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
              tab === key
                ? 'border-b-2 border-brand-500 text-brand-600 -mb-px'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {tab === 'cert' && <CertificateSection cert={data.certificate} onRefresh={fetchData} />}
      {tab === 'issuers' && (
        <IssuersSection
          issuers={data.issuers}
          selectedIssuerId={selectedIssuerId}
          onSelectIssuer={(id) => {
            setSelectedIssuerId(id);
            setTab('pdv');
          }}
          onRefresh={fetchData}
        />
      )}
      {tab === 'pdv' && (
        <div className="space-y-4">
          {/* Issuer selector if none selected */}
          {data.issuers.length > 0 && (
            <div>
              <label htmlFor="pdvIssuerSelect" className="block text-xs font-medium text-slate-500 mb-1">
                {t('selectIssuerLabel')}
              </label>
              <select
                id="pdvIssuerSelect"
                value={selectedIssuerId ?? ''}
                onChange={(e) => setSelectedIssuerId(e.target.value || null)}
                className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              >
                <option value="">{t('selectIssuerPlaceholder')}</option>
                {data.issuers.map((iss) => (
                  <option key={iss.id} value={iss.id}>
                    {iss.businessName} ({iss.cuit})
                  </option>
                ))}
              </select>
            </div>
          )}
          <PdvSection issuer={selectedIssuer} onRefresh={fetchData} />
        </div>
      )}
    </div>
  );
}
