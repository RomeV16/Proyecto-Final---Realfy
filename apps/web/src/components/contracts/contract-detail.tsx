'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ContractStatusBadge } from './contract-status-badge';
import { GuaranteeBadge } from './guarantee-badge';
import { AdjustmentTimeline } from './adjustment-timeline';
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

interface ContractAdjustment {
  id: string;
  periodNumber: number;
  scheduledDate: string;
  previousAmount?: string | number | null;
  newAmount?: string | number | null;
  percentageChange?: string | number | null;
  adjustmentType: string;
  status: string;
}

interface AdjustmentSchedule {
  id: string;
  periodNumber: number;
  scheduledDate: string;
  status: string;
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
  adjustments: ContractAdjustment[];
  schedules: AdjustmentSchedule[];
}

interface ContractDetailProps {
  contractId: string;
}

/* ──────────── Ajustes Tab Types ──────────── */

interface PreviewAdjustment {
  period: string;
  indexType: string;
  factor: number;
  currentRent: number;
  projectedRent: number;
  projectedDelta: number;
}

/* ──────────── Ajustes Tab Component ──────────── */

function AjustesTab({
  contractId,
  adjustments,
  currency,
}: {
  contractId: string;
  adjustments: ContractAdjustment[];
  currency?: string;
}) {
  const t = useTranslations('contracts.adjustments');
  const tTypes = useTranslations('contracts.adjustmentTypes');
  const tCommon = useTranslations('common');

  const [preview, setPreview] = useState<PreviewAdjustment | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState('');
  const [noAdjustmentConfig, setNoAdjustmentConfig] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError('');
    setNoAdjustmentConfig(false);

    apiClient<PreviewAdjustment>(`/contracts/${contractId}/preview-adjustment`, {
      method: 'POST',
    })
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (
          err instanceof ApiRequestError &&
          (err.statusCode === 404 || err.statusCode === 422)
        ) {
          setNoAdjustmentConfig(true);
        } else {
          setPreviewError(
            err instanceof ApiRequestError ? err.message : tCommon('error'),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [contractId, tCommon]);

  function fmtCurrency(amount: number | string | null | undefined): string {
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

  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('es-AR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  }

  const appliedAdjustments = (adjustments || []).filter(
    (a) => a.status === 'Applied',
  );

  return (
    <div className="space-y-6">
      {/* ── Próximo ajuste proyectado ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">
          {t('nextProjected')}
        </h2>

        {previewLoading && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="space-y-1">
                  <Skeleton width="80px" height="12px" />
                  <Skeleton width="100px" height="18px" />
                </div>
              ))}
            </div>
          </div>
        )}

        {!previewLoading && noAdjustmentConfig && (
          <EmptyState
            title={t('noConfig')}
            subtitle={t('noConfigHint')}
          />
        )}

        {!previewLoading && previewError && (
          <EmptyState title={tCommon('error')} subtitle={previewError} />
        )}

        {!previewLoading && preview && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-slate-500 mb-0.5">{t('period')}</p>
              <p className="text-sm font-semibold text-slate-900">
                {preview.period}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">{t('indexType')}</p>
              <p className="text-sm font-semibold text-slate-900">
                {preview.indexType}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">{t('factor')}</p>
              <p className="text-sm font-semibold text-slate-900 tabular-nums">
                {Number(preview.factor).toFixed(4)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">{t('currentRent')}</p>
              <p className="text-sm font-semibold text-slate-900 tabular-nums">
                {fmtCurrency(preview.currentRent)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">
                {t('projectedRent')}
              </p>
              <p className="text-sm font-bold text-slate-900 tabular-nums">
                {fmtCurrency(preview.projectedRent)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">
                {t('projectedDelta')}
              </p>
              <p
                className={`text-sm font-semibold tabular-nums ${
                  preview.projectedDelta >= 0 ? 'text-red-600' : 'text-emerald-600'
                }`}
              >
                {preview.projectedDelta >= 0 ? '+' : ''}
                {fmtCurrency(preview.projectedDelta)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Historial de ajustes ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">
          {t('history')}
        </h2>

        {appliedAdjustments.length === 0 ? (
          <EmptyState
            title={t('historyEmpty')}
            subtitle={t('historyEmptyHint')}
          />
        ) : (
          <>
            {/* Table ≥ md */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left pb-2 pr-4 text-xs font-medium text-slate-500">
                      {t('col.period')}
                    </th>
                    <th className="text-left pb-2 pr-4 text-xs font-medium text-slate-500">
                      {t('col.type')}
                    </th>
                    <th className="text-right pb-2 pr-4 text-xs font-medium text-slate-500">
                      {t('col.prevRent')}
                    </th>
                    <th className="text-right pb-2 pr-4 text-xs font-medium text-slate-500">
                      {t('col.newRent')}
                    </th>
                    <th className="text-right pb-2 text-xs font-medium text-slate-500">
                      {t('col.change')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {appliedAdjustments.map((adj) => {
                    const pct =
                      adj.percentageChange != null
                        ? Number(adj.percentageChange)
                        : null;
                    return (
                      <tr
                        key={adj.id}
                        className="hover:bg-slate-50/50 transition-colors"
                      >
                        <td className="py-2.5 pr-4 text-slate-700">
                          {fmtDate(adj.scheduledDate)}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                            {tTypes(adj.adjustmentType)}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">
                          {fmtCurrency(adj.previousAmount)}
                        </td>
                        <td className="py-2.5 pr-4 text-right tabular-nums font-semibold text-slate-900">
                          {fmtCurrency(adj.newAmount)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          {pct != null ? (
                            <span
                              className={`text-xs font-medium ${
                                pct >= 0 ? 'text-red-600' : 'text-emerald-600'
                              }`}
                            >
                              {pct >= 0 ? '+' : ''}
                              {pct.toFixed(1)}%
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cards < md */}
            <div className="md:hidden space-y-3">
              {appliedAdjustments.map((adj) => {
                const pct =
                  adj.percentageChange != null
                    ? Number(adj.percentageChange)
                    : null;
                return (
                  <div
                    key={adj.id}
                    className="bg-slate-50 rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">
                        {fmtDate(adj.scheduledDate)}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                        {tTypes(adj.adjustmentType)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-slate-500 tabular-nums">
                        {fmtCurrency(adj.previousAmount)}
                      </span>
                      <svg
                        className="w-3.5 h-3.5 text-slate-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                        />
                      </svg>
                      <span className="font-semibold text-slate-900 tabular-nums">
                        {fmtCurrency(adj.newAmount)}
                      </span>
                      {pct != null && (
                        <span
                          className={`text-xs font-medium ${
                            pct >= 0 ? 'text-red-600' : 'text-emerald-600'
                          }`}
                        >
                          {pct >= 0 ? '+' : ''}
                          {pct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
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
  const tPropTypes = useTranslations('properties.types');
  const tCommon = useTranslations('common');
  const tAdjustments = useTranslations('contracts.adjustments');
  const { user } = useAuth();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [generateDocOpen, setGenerateDocOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'resumen' | 'ajustes'>('resumen');

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

  async function handleCalculateAdjustment() {
    if (!contract) return;
    const nextSchedule = contract.schedules?.find((s) => s.status === 'Pending');
    if (!nextSchedule) return;
    setActionLoading('calculate');
    setActionError('');
    setActionSuccess('');
    try {
      await apiClient(`/contracts/${contract.id}/adjustments/calculate`, {
        method: 'POST',
        body: JSON.stringify({ scheduleId: nextSchedule.id }),
      });
      setActionSuccess(t('calculateSuccess'));
      fetchContract();
    } catch (err) {
      setActionError(
        err instanceof ApiRequestError ? err.message : t('calculateError'),
      );
    } finally {
      setActionLoading('');
    }
  }

  async function handleApplyAdjustment(adjId: string) {
    if (!contract) return;
    setActionLoading('apply');
    setActionError('');
    setActionSuccess('');
    try {
      await apiClient(`/contracts/${contract.id}/adjustments/${adjId}/apply`, {
        method: 'POST',
      });
      setActionSuccess(t('applySuccess'));
      fetchContract();
    } catch (err) {
      setActionError(
        err instanceof ApiRequestError ? err.message : t('applyError'),
      );
    } finally {
      setActionLoading('');
    }
  }

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
  const nextPendingSchedule = (contract.schedules || []).find(
    (s) => s.status === 'Pending',
  );
  const calculatedAdj = (contract.adjustments || []).find(
    (a) => a.status === 'Calculated',
  );

  const tabs = [
    { id: 'resumen' as const, label: tAdjustments('tabResumen') },
    { id: 'ajustes' as const, label: tAdjustments('tabAjustes') },
  ];

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

        {/* Actions — one stable bar, design-system buttons */}
        {(canManage || (contract.status === 'Activo' && isAdmin)) && (
          <div className="mt-5 pt-5 border-t border-[var(--color-border)] flex flex-wrap items-center gap-2.5">
            {contract.status === 'Activo' && canManage && nextPendingSchedule && (
              <Button
                variant="primary"
                onClick={handleCalculateAdjustment}
                disabled={actionLoading === 'calculate'}
              >
                {actionLoading === 'calculate' && <Spinner className="w-4 h-4 text-white" />}
                {t('calculateAdjustment')}
              </Button>
            )}
            {contract.status === 'Activo' && isAdmin && calculatedAdj && (
              <Button
                variant="accent"
                onClick={() => handleApplyAdjustment(calculatedAdj.id)}
                disabled={actionLoading === 'apply'}
              >
                {actionLoading === 'apply' && <Spinner className="w-4 h-4 text-white" />}
                {t('applyAdjustment')}
              </Button>
            )}
            {canManage && (
              <Button variant="secondary" onClick={() => setGenerateDocOpen(true)}>
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
              </Button>
            )}
            {contract.status === 'Activo' && isAdmin && (
              <Button
                variant="danger"
                onClick={handleTerminate}
                disabled={actionLoading === 'terminate'}
                className="sm:ml-auto"
              >
                {actionLoading === 'terminate' && <Spinner className="w-4 h-4 text-white" />}
                {t('terminate')}
              </Button>
            )}
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

      {/* Tab strip */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Resumen ── */}
      {activeTab === 'resumen' && (
        <>
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
                      {tPropTypes(contract.property.type)}
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

          {/* Adjustment timeline */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">
              {t('adjustmentHistory')}
            </h2>
            <AdjustmentTimeline
              adjustments={contract.adjustments || []}
              schedules={contract.schedules || []}
            />
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
        </>
      )}

      {/* ── Tab: Ajustes ── */}
      {activeTab === 'ajustes' && (
        <AjustesTab
          contractId={contract.id}
          adjustments={contract.adjustments || []}
          currency={contract.currency}
        />
      )}

      {/* Generate Document Modal */}
      <GenerateDocumentModal
        open={generateDocOpen}
        contractId={contract.id}
        onClose={() => setGenerateDocOpen(false)}
      />
    </div>
  );
}
