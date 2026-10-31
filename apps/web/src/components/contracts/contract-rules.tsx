'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { formatDate, formatMoneyFixed, formatPercent } from '@/lib/format';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Skeleton } from '@/components/ui/skeleton';

/* ──────────── Types ──────────── */

interface TermsVersion {
  id: string;
  validFrom: string;
  adjustmentType: string;
  adjustmentPeriod: string;
  adjustmentBase: string;
  indexLagMonths: number;
  fixedInitialMonths: number;
  customPct: string | null;
  rentOverride: string | null;
  discountPct: string | null;
  discountAmount: string | null;
  dueDay: number;
  paymentFlow: string;
}

interface TermsResponse {
  at: string;
  current: TermsVersion | null;
  versions: TermsVersion[];
}

interface Agreement {
  id: string;
  kind: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  documentUrl: string | null;
  notes: string | null;
}

/** Solo se muestra un enlace al documento si es una dirección web. */
function safeHttpUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-xs text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-900">{children}</p>
    </div>
  );
}

/**
 * Reglas vigentes hoy del contrato (modalidad de ajuste, base, rezago,
 * vencimiento, reparto y descuentos) y los acuerdos que las cambiaron. Es de
 * solo lectura: los acuerdos se cargan desde otra pantalla.
 */
export function ContractRules({ contractId, currency }: { contractId: string; currency?: string }) {
  const t = useTranslations('contractRules');
  const tContracts = useTranslations('contracts');
  const [terms, setTerms] = useState<TermsResponse | null>(null);
  const [agreements, setAgreements] = useState<Agreement[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiClient<TermsResponse>(`/contracts/${contractId}/terms`),
      apiClient<Agreement[]>(`/contracts/${contractId}/agreements`),
    ])
      .then(([termsData, agreementsData]) => {
        if (cancelled) return;
        setTerms(termsData);
        setAgreements(agreementsData);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  const current = terms?.current ?? null;
  const loading = error == null && (terms === null || agreements === null);

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="contract-rules-title">
        <h2 id="contract-rules-title" className="mb-3 text-sm font-semibold text-slate-900">
          {t('title')}
        </h2>
        {error != null && <ErrorNotice error={error} fallback={t('loadError')} />}
        {loading && <Skeleton className="h-16 w-full" />}
        {!loading && error == null && current === null && (
          <p className="text-sm italic text-slate-400">{t('none')}</p>
        )}
        {current && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Fact label={t('adjustmentType')}>{tContracts(`adjustmentTypes.${current.adjustmentType}`)}</Fact>
              <Fact label={t('adjustmentPeriod')}>{tContracts(`adjustmentPeriods.${current.adjustmentPeriod}`)}</Fact>
              <Fact label={t('adjustmentBase')}>{t(`bases.${current.adjustmentBase}`)}</Fact>
              <Fact label={t('indexLagMonths')}>{t('months', { count: current.indexLagMonths })}</Fact>
              {current.customPct != null && <Fact label={t('customPct')}>{formatPercent(current.customPct, { decimals: 2 })}</Fact>}
              <Fact label={t('dueDay')}>{current.dueDay}</Fact>
              <Fact label={t('paymentFlow')}>{t(`flows.${current.paymentFlow}`)}</Fact>
              {current.rentOverride != null && (
                <Fact label={t('rentOverride')}>{formatMoneyFixed(current.rentOverride, currency)}</Fact>
              )}
              {current.discountPct != null && (
                <Fact label={t('discountPct')}>{formatPercent(current.discountPct, { decimals: 2 })}</Fact>
              )}
              {current.discountAmount != null && (
                <Fact label={t('discountAmount')}>{formatMoneyFixed(current.discountAmount, currency)}</Fact>
              )}
            </div>
            <p className="mt-3 text-xs text-slate-400">
              {t('validFrom', { date: formatDate(current.validFrom, 'medium') })}
              {terms && terms.versions.length > 1 && ` · ${t('versions', { count: terms.versions.length })}`}
            </p>
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="contract-agreements-title">
        <h2 id="contract-agreements-title" className="mb-3 text-sm font-semibold text-slate-900">
          {t('agreements')}
        </h2>
        {agreements !== null && agreements.length === 0 && (
          <p className="text-sm italic text-slate-400">{t('noAgreements')}</p>
        )}
        {agreements !== null && agreements.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {agreements.map((agreement) => {
              const href = safeHttpUrl(agreement.documentUrl);
              return (
                <li key={agreement.id} className="flex flex-col gap-0.5 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-medium text-slate-900">{t(`kinds.${agreement.kind}`)}</span>
                    <span className="text-xs text-slate-500">
                      {agreement.effectiveTo
                        ? t('range', {
                            from: formatDate(agreement.effectiveFrom, 'medium'),
                            to: formatDate(agreement.effectiveTo, 'medium'),
                          })
                        : t('since', { date: formatDate(agreement.effectiveFrom, 'medium') })}
                    </span>
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-brand-600 hover:underline"
                      >
                        {t('document')}
                      </a>
                    )}
                  </div>
                  {agreement.notes && <p className="text-slate-600">{agreement.notes}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
