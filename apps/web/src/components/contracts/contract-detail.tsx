'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { Spinner } from '@/components/ui/spinner';
import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ContractStatusBadge } from './contract-status-badge';
import { GuaranteeBadge } from './guarantee-badge';
import { GenerateDocumentModal } from './generate-document-modal';

/* ──────────── Types ──────────── */

interface ContractPerson {
  id: string;
  role: string;
  person: { id: string; firstName: string; lastName: string; cuit?: string };
}

interface ContractGuarantee {
  id: string;
  type: string;
  description?: string;
  amount?: string | number;
  issuer?: string;
  policyNumber?: string;
  startDate?: string;
  endDate?: string;
}

interface ContractDetail {
  id: string;
  contractType: string;
  status: string;
  startDate: string;
  endDate?: string;
  rentAmount?: string | number;
  currency?: string;
  depositAmount?: string | number;
  adjustmentType?: string;
  adjustmentPeriod?: string;
  customAdjustmentPct?: number;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  property?: { id: string; title: string; street?: string; city?: string; type?: string };
  persons: ContractPerson[];
  guarantees: ContractGuarantee[];
}

interface ContractDetailProps {
  contractId: string;
}

/* ──────────── Helpers ──────────── */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatCurrency(
  amount: string | number | undefined | null,
  currency?: string,
): string {
  if (amount == null) return '—';
  const prefix = currency === 'USD' ? 'US$ ' : '$ ';
  return (
    prefix +
    Number(amount).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/* ──────────── Main Component ──────────── */

export function ContractDetailView({ contractId }: ContractDetailProps) {
  const t = useTranslations('contracts.detail');
  const tContracts = useTranslations('contracts');
  const tCommon = useTranslations('common');
  const { user } = useAuth();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [generateDocOpen, setGenerateDocOpen] = useState(false);

  const isAdmin = ['Admin', 'Gerente'].includes(user?.role || '');
  const canManage = ['Admin', 'Gerente', 'Ventas'].includes(user?.role || '');

  const fetchContract = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient<ContractDetail>(`/contracts/${contractId}`);
      setContract(res);
    } catch {
      setContract(null);
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    fetchContract();
  }, [fetchContract]);

  async function handleTerminate() {
    if (!contract || !confirm(t('terminateConfirm'))) return;
    setActionLoading('terminate');
    setActionError('');
    setActionSuccess('');
    try {
      await apiClient(`/contracts/${contract.id}/terminate`, { method: 'POST' });
      setActionSuccess(t('terminateSuccess'));
      fetchContract();
    } catch (err) {
      setActionError(
        err instanceof ApiRequestError ? err.message : t('terminateError'),
      );
    } finally {
      setActionLoading('');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h2 className="text-lg font-semibold text-slate-900">{tCommon('error')}</h2>
        <Link
          href={`${localePrefix}/contracts`}
          className="mt-4 text-sm text-brand-600 hover:text-brand-700"
        >
          ← {tCommon('back')}
        </Link>
      </div>
    );
  }

  const propietarios = (contract.persons || []).filter(
    (p) => p.role === 'Propietario',
  );
  const inquilinos = (contract.persons || []).filter(
    (p) => p.role === 'Inquilino',
  );
  const garantes = (contract.persons || []).filter((p) => p.role === 'Garante');

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Back link */}
      <Link
        href={`${localePrefix}/contracts`}
        className="text-sm text-brand-600 hover:text-brand-700"
      >
        ← {tCommon('back')}
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <ContractStatusBadge status={contract.status} size="md" />
              <span className="text-sm px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium">
                {tContracts(`types.${contract.contractType}`)}
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-900">
              {contract.property?.title || t('title')}
            </h1>
            <p className="text-sm text-slate-500">
              {formatDate(contract.startDate)}
              {contract.endDate && ` — ${formatDate(contract.endDate)}`}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs text-slate-500 mb-1">{t('rentAmount')}</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">
              {formatCurrency(contract.rentAmount, contract.currency)}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        {contract.status === 'Activo' && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-2">
            {isAdmin && (
              <button
                onClick={handleTerminate}
                disabled={actionLoading === 'terminate'}
                className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading === 'terminate' && (
                  <Spinner className="w-3 h-3 text-white" />
                )}
                {t('terminate')}
              </button>
            )}
          </div>
        )}

        {/* Generate Document button */}
        {canManage && (
          <div
            className={`mt-4 ${
              contract.status !== 'Activo' ? 'pt-4 border-t border-slate-100' : ''
            } flex flex-wrap gap-2`}
          >
            <button
              onClick={() => setGenerateDocOpen(true)}
              className="px-4 py-2 rounded-lg bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 transition-colors flex items-center gap-2"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
              {t('generateDocument')}
            </button>
          </div>
        )}

        {/* Feedback messages */}
        {actionError && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <p className="text-sm text-red-700">{actionError}</p>
          </div>
        )}
        {actionSuccess && (
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <p className="text-sm text-emerald-700">{actionSuccess}</p>
          </div>
        )}
      </div>

      {/* Property section */}
      {contract.property && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">
            {t('propertyTitle')}
          </h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900">
                {contract.property.title}
              </p>
              {contract.property.street && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {[contract.property.street, contract.property.city]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              )}
              {contract.property.type && (
                <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                  {contract.property.type}
                </span>
              )}
            </div>
            <Link
              href={`${localePrefix}/properties/${contract.property.id}`}
              className="text-sm text-brand-600 hover:text-brand-700"
            >
              {t('viewProperty')} →
            </Link>
          </div>
        </div>
      )}

      {/* Persons section */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">
          {t('persons')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {propietarios.map((p) => (
            <Link
              key={p.id}
              href={`${localePrefix}/persons/${p.person.id}`}
              className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {p.person.firstName} {p.person.lastName}
                </p>
                <p className="text-xs text-blue-600">{t('propietario')}</p>
              </div>
            </Link>
          ))}
          {inquilinos.map((p) => (
            <Link
              key={p.id}
              href={`${localePrefix}/persons/${p.person.id}`}
              className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 hover:bg-emerald-100 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {p.person.firstName} {p.person.lastName}
                </p>
                <p className="text-xs text-emerald-600">{t('inquilino')}</p>
              </div>
            </Link>
          ))}
          {garantes.map((p) => (
            <Link
              key={p.id}
              href={`${localePrefix}/persons/${p.person.id}`}
              className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 hover:bg-amber-100 transition-colors"
            >
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {p.person.firstName} {p.person.lastName}
                </p>
                <p className="text-xs text-amber-600">
                  {tContracts('detail.garantes')}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Pricing section */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">
          {t('pricing')}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-slate-500 mb-0.5">{t('rent')}</p>
            <p className="text-sm font-semibold text-slate-900 tabular-nums">
              {formatCurrency(contract.rentAmount, contract.currency)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">{t('currency')}</p>
            <p className="text-sm font-semibold text-slate-900">
              {contract.currency || '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">{t('deposit')}</p>
            <p className="text-sm font-semibold text-slate-900 tabular-nums">
              {formatCurrency(contract.depositAmount, contract.currency)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">
              {t('adjustmentType')}
            </p>
            <p className="text-sm font-semibold text-slate-900">
              {contract.adjustmentType
                ? tContracts(`adjustmentTypes.${contract.adjustmentType}`)
                : '—'}
            </p>
          </div>
          {contract.adjustmentPeriod && (
            <div>
              <p className="text-xs text-slate-500 mb-0.5">
                {t('adjustmentPeriod')}
              </p>
              <p className="text-sm font-semibold text-slate-900">
                {tContracts(`adjustmentPeriods.${contract.adjustmentPeriod}`)}
              </p>
            </div>
          )}
          {contract.customAdjustmentPct != null && (
            <div>
              <p className="text-xs text-slate-500 mb-0.5">
                {t('customPercentage')}
              </p>
              <p className="text-sm font-semibold text-slate-900">
                {contract.customAdjustmentPct}%
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Guarantees section */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">
          {t('guarantees')}
        </h2>
        {(contract.guarantees || []).length === 0 ? (
          <p className="text-sm text-slate-400 italic">{t('noGuarantees')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(contract.guarantees || []).map((g) => (
              <div key={g.id} className="bg-slate-50 rounded-lg p-3 space-y-2">
                <GuaranteeBadge type={g.type} endDate={g.endDate} size="md" />
                {g.description && (
                  <p className="text-xs text-slate-600">{g.description}</p>
                )}
                {g.amount != null && (
                  <p className="text-sm font-semibold text-slate-900 tabular-nums">
                    {formatCurrency(g.amount, contract.currency)}
                  </p>
                )}
                {g.issuer && (
                  <p className="text-xs text-slate-500">{g.issuer}</p>
                )}
                {g.policyNumber && (
                  <p className="text-xs text-slate-500 font-mono">
                    {g.policyNumber}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="text-xs text-slate-400 flex gap-4">
        <span>
          {t('createdAt')}: {formatDate(contract.createdAt)}
        </span>
        <span>
          {t('updatedAt')}: {formatDate(contract.updatedAt)}
        </span>
      </div>

      {/* Generate Document Modal */}
      <GenerateDocumentModal
        open={generateDocOpen}
        contractId={contract.id}
        onClose={() => setGenerateDocOpen(false)}
      />
    </div>
  );
}
