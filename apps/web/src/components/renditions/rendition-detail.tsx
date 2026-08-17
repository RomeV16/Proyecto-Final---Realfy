'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { Spinner } from '@/components/ui/spinner';
import { RendicionStatus, RendicionLineItemType } from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { EntityRow, Badge } from '@/components/ui/entity-card';

/* ──────────── Types ──────────── */

interface LineItem {
  id: string;
  type: RendicionLineItemType;
  description: string;
  amount: string | number;
  isDebit: boolean;
}

interface RenditionDetail {
  id: string;
  status: RendicionStatus;
  month: number;
  year: number;
  rentCollected: string | number;
  commissionAmount: string | number;
  adminFeeAmount: string | number;
  deductionTotal: string | number;
  netDeposit: string | number;
  notes?: string | null;
  sentAt?: string | null;
  depositedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  ownerName?: string;
  contract?: {
    id: string;
    property?: { id: string; title: string; street?: string; city?: string };
  };
  lineItems: LineItem[];
}

interface RenditionDetailProps {
  renditionId: string;
}

/* ──────────── Status Badge ──────────── */

const statusColors: Record<string, string> = {
  Borrador: 'bg-slate-100 text-slate-600',
  Aprobada: 'bg-blue-100 text-blue-700',
  Enviada: 'bg-amber-100 text-amber-700',
  Depositada: 'bg-emerald-100 text-emerald-700',
};

function RenditionStatusBadge({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const t = useTranslations('renditions.statuses');
  const sizeClasses = size === 'md' ? 'px-3 py-1 text-sm' : 'px-2.5 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${sizeClasses} ${statusColors[status] || 'bg-slate-100 text-slate-600'}`}>
      {t(status as keyof typeof statusColors)}
    </span>
  );
}

/* ──────────── Helpers ──────────── */

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

const LINE_ITEM_ICONS: Record<string, string> = {
  [RendicionLineItemType.Alquiler]: '🏠',
  [RendicionLineItemType.Comision]: '💼',
  [RendicionLineItemType.AdminFee]: '🧾',
  [RendicionLineItemType.Deduccion]: '🏷️',
  [RendicionLineItemType.Ajuste]: '📊',
};

/* ──────────── Main Component ──────────── */

export function RenditionDetail({ renditionId }: RenditionDetailProps) {
  const t = useTranslations('renditions');
  const tMonths = useTranslations('renditions.months');
  const tLineItems = useTranslations('renditions.lineItems');
  const tLineItemTypes = useTranslations('renditions.lineItemTypes');
  const tCommon = useTranslations('common');
  const { user } = useAuth();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const canManage = ['Admin', 'Gerente', 'Liquidaciones'].includes(user?.role || '');

  const [rendition, setRendition] = useState<RenditionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Notes editing
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState('');

  // Add line item form
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemType, setNewItemType] = useState<RendicionLineItemType>(RendicionLineItemType.Deduccion);
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemAmount, setNewItemAmount] = useState('');
  const [newItemIsDebit, setNewItemIsDebit] = useState(true);

  const fetchRendition = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient<RenditionDetail>(`/renditions/${renditionId}`);
      setRendition(data);
      setNotesValue(data.notes || '');
    } catch {
      setRendition(null);
    } finally {
      setLoading(false);
    }
  }, [renditionId]);

  useEffect(() => {
    fetchRendition();
  }, [fetchRendition]);

  async function handleTransition(targetStatus: RendicionStatus) {
    if (!rendition) return;
    setActionLoading('transition');
    setFeedback(null);
    try {
      await apiClient(`/renditions/${rendition.id}/transition`, {
        method: 'PATCH',
        body: JSON.stringify({ status: targetStatus }),
      });
      setFeedback({ type: 'success', message: t('transitions.success') });
      fetchRendition();
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof ApiRequestError ? err.message : t('transitions.error') });
    } finally {
      setActionLoading('');
    }
  }

  async function handleDownloadPdf() {
    if (!rendition) return;
    setActionLoading('pdf');
    try {
      window.open(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/renditions/${rendition.id}/pdf`, '_blank');
    } finally {
      setActionLoading('');
    }
  }

  async function handleSendEmail() {
    if (!rendition || !confirm(t('email.confirmSend'))) return;
    setActionLoading('email');
    setFeedback(null);
    try {
      await apiClient(`/renditions/${rendition.id}/send`, { method: 'POST' });
      setFeedback({ type: 'success', message: t('email.sendSuccess') });
      fetchRendition();
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof ApiRequestError ? err.message : t('email.sendError') });
    } finally {
      setActionLoading('');
    }
  }

  async function handleSaveNotes() {
    if (!rendition) return;
    setActionLoading('notes');
    setFeedback(null);
    try {
      await apiClient(`/renditions/${rendition.id}/notes`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: notesValue }),
      });
      setFeedback({ type: 'success', message: t('notes.saveSuccess') });
      setEditingNotes(false);
      fetchRendition();
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof ApiRequestError ? err.message : t('notes.saveError') });
    } finally {
      setActionLoading('');
    }
  }

  async function handleAddLineItem(e: React.FormEvent) {
    e.preventDefault();
    if (!rendition) return;
    setActionLoading('addItem');
    setFeedback(null);
    try {
      await apiClient(`/renditions/${rendition.id}/line-items`, {
        method: 'POST',
        body: JSON.stringify({
          type: newItemType,
          description: newItemDesc,
          amount: Number(newItemAmount),
          isDebit: newItemIsDebit,
        }),
      });
      setFeedback({ type: 'success', message: t('lineItems.addSuccess') });
      setShowAddItem(false);
      setNewItemDesc('');
      setNewItemAmount('');
      fetchRendition();
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof ApiRequestError ? err.message : t('lineItems.addError') });
    } finally {
      setActionLoading('');
    }
  }

  async function handleRemoveLineItem(itemId: string) {
    if (!rendition || !confirm(t('lineItems.removeConfirm'))) return;
    setActionLoading('removeItem');
    setFeedback(null);
    try {
      await apiClient(`/renditions/${rendition.id}/line-items/${itemId}`, { method: 'DELETE' });
      setFeedback({ type: 'success', message: t('lineItems.removeSuccess') });
      fetchRendition();
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof ApiRequestError ? err.message : t('lineItems.removeError') });
    } finally {
      setActionLoading('');
    }
  }

  /* ──── Loading / Error States ──── */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!rendition) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h2 className="text-lg font-semibold text-slate-900">{t('errors.notFound')}</h2>
        <Link href={`${localePrefix}/renditions`} className="mt-4 text-sm text-brand-600 hover:text-brand-700">
          ← {tCommon('back')}
        </Link>
      </div>
    );
  }

  const isDraft = rendition.status === RendicionStatus.Borrador;
  const periodLabel = `${tMonths(String(rendition.month) as '1')} ${rendition.year}`;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Back link */}
      <Link href={`${localePrefix}/renditions`} className="text-sm text-brand-600 hover:text-brand-700">
        ← {tCommon('back')}
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <RenditionStatusBadge status={rendition.status} size="md" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">
              {t('detail.title')} — {periodLabel}
            </h1>
            <div className="text-sm text-slate-500 space-y-0.5">
              {rendition.contract?.property && (
                <p>{rendition.contract.property.title}</p>
              )}
              {rendition.ownerName && (
                <p>{t('detail.owner')}: {rendition.ownerName}</p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleDownloadPdf}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {t('pdf.download')}
            </button>
            {canManage && (
              <button
                onClick={handleSendEmail}
                disabled={actionLoading === 'email'}
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {actionLoading === 'email' ? (
                  <Spinner className="w-3 h-3 text-slate-500" />
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                  </svg>
                )}
                {t('email.send')}
              </button>
            )}
          </div>
        </div>

        {/* Transition buttons */}
        {canManage && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-2">
            {rendition.status === RendicionStatus.Borrador && (
              <button
                onClick={() => handleTransition(RendicionStatus.Aprobada)}
                disabled={!!actionLoading}
                className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading === 'transition' && <Spinner className="w-3 h-3 text-white" />}
                {t('transitions.approve')}
              </button>
            )}
            {rendition.status === RendicionStatus.Aprobada && (
              <>
                <button
                  onClick={() => handleTransition(RendicionStatus.Enviada)}
                  disabled={!!actionLoading}
                  className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {actionLoading === 'transition' && <Spinner className="w-3 h-3 text-white" />}
                  {t('transitions.send')}
                </button>
                <button
                  onClick={() => handleTransition(RendicionStatus.Borrador)}
                  disabled={!!actionLoading}
                  className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:text-slate-900"
                >
                  {t('transitions.backToDraft')}
                </button>
              </>
            )}
            {rendition.status === RendicionStatus.Enviada && (
              <button
                onClick={() => handleTransition(RendicionStatus.Depositada)}
                disabled={!!actionLoading}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading === 'transition' && <Spinner className="w-3 h-3 text-white" />}
                {t('transitions.markDeposited')}
              </button>
            )}
            {rendition.status === RendicionStatus.Depositada && rendition.depositedAt && (
              <p className="text-sm text-slate-500">
                {t('depositedAt')}: {formatDate(rendition.depositedAt)}
              </p>
            )}
          </div>
        )}

        {/* Timestamps */}
        {rendition.sentAt && (
          <p className="text-xs text-slate-400 mt-2">
            {t('sentAt')}: {formatDate(rendition.sentAt)}
          </p>
        )}

        {/* Feedback */}
        {feedback && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            {feedback.message}
          </div>
        )}
      </div>

      {/* Summary Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">{t('summary.title')}</h2>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-600">{t('summary.rentCollected')}</span>
            <span className="text-sm font-medium text-slate-900 tabular-nums">{formatCurrency(rendition.rentCollected)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-600">{t('summary.commission')}</span>
            <span className="text-sm text-red-600 tabular-nums">- {formatCurrency(rendition.commissionAmount)}</span>
          </div>
          {Number(rendition.adminFeeAmount) > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">{t('summary.adminFee')}</span>
              <span className="text-sm text-red-600 tabular-nums">- {formatCurrency(rendition.adminFeeAmount)}</span>
            </div>
          )}
          {Number(rendition.deductionTotal) > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">{t('summary.deductions')}</span>
              <span className="text-sm text-red-600 tabular-nums">- {formatCurrency(rendition.deductionTotal)}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-2 border-t border-slate-200">
            <span className="text-base font-bold text-slate-900">{t('summary.netDeposit')}</span>
            <span className="text-lg font-bold text-emerald-600 tabular-nums">{formatCurrency(rendition.netDeposit)}</span>
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900">{t('lineItems.title')}</h2>
          {isDraft && canManage && (
            <button
              onClick={() => setShowAddItem(true)}
              className="text-sm text-brand-600 hover:text-brand-700 flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {t('lineItems.add')}
            </button>
          )}
        </div>

        {(rendition.lineItems || []).length === 0 ? (
          <p className="text-sm text-slate-400 italic">{t('lineItems.empty')}</p>
        ) : (
          <div className="space-y-2.5">
            {(rendition.lineItems || []).map((li) => (
              <EntityRow
                key={li.id}
                accent={li.isDebit ? 'danger' : 'none'}
                leading={
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full text-lg"
                    style={{
                      backgroundColor: li.isDebit
                        ? 'color-mix(in oklab, var(--color-danger) 12%, var(--color-surface))'
                        : 'var(--color-surface-sunken)',
                    }}
                  >
                    {LINE_ITEM_ICONS[li.type] || '📄'}
                  </span>
                }
                title={li.description}
                meta={
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={li.isDebit ? 'danger' : 'neutral'}>{tLineItemTypes(li.type)}</Badge>
                  </div>
                }
                trailing={
                  <EntityRow.Amount
                    value={`${li.isDebit ? '- ' : ''}${formatCurrency(li.amount)}`}
                    tone={li.isDebit ? 'danger' : 'default'}
                  />
                }
                actions={
                  isDraft && canManage ? (
                    <EntityRow.Action
                      icon="close"
                      variant="quiet"
                      onClick={() => handleRemoveLineItem(li.id)}
                      title={tLineItems('remove')}
                      className="text-[var(--color-danger)] hover:bg-[color-mix(in_oklab,var(--color-danger)_10%,var(--color-surface))]"
                    >
                      <span className="sr-only">{tLineItems('remove')}</span>
                    </EntityRow.Action>
                  ) : undefined
                }
              />
            ))}
          </div>
        )}

        {/* Add line item form */}
        {showAddItem && isDraft && (
          <form onSubmit={handleAddLineItem} className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('lineItems.type')}</label>
                <select
                  value={newItemType}
                  onChange={(e) => setNewItemType(e.target.value as RendicionLineItemType)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                >
                  {Object.values(RendicionLineItemType).map((lt) => (
                    <option key={lt} value={lt}>{t(`lineItemTypes.${lt}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('lineItems.description')}</label>
                <input
                  type="text"
                  value={newItemDesc}
                  onChange={(e) => setNewItemDesc(e.target.value)}
                  placeholder={t('lineItems.descriptionPlaceholder')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('lineItems.amount')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newItemAmount}
                  onChange={(e) => setNewItemAmount(e.target.value)}
                  placeholder={t('lineItems.amountPlaceholder')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  required
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={newItemIsDebit}
                onChange={(e) => setNewItemIsDebit(e.target.checked)}
                className="rounded border-slate-300"
              />
              {t('lineItems.isDebit')}
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={actionLoading === 'addItem'}
                className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50"
              >
                {t('lineItems.add')}
              </button>
              <button
                type="button"
                onClick={() => setShowAddItem(false)}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
              >
                {tCommon('cancel')}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Notes section */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-900">{t('notes.title')}</h2>
          {!editingNotes && canManage && (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-sm text-brand-600 hover:text-brand-700"
            >
              {t('notes.edit')}
            </button>
          )}
        </div>
        {editingNotes ? (
          <div className="space-y-3">
            <textarea
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              placeholder={t('notes.placeholder')}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveNotes}
                disabled={actionLoading === 'notes'}
                className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading === 'notes' && <Spinner className="w-3 h-3 text-white" />}
                {t('notes.save')}
              </button>
              <button
                onClick={() => { setEditingNotes(false); setNotesValue(rendition.notes || ''); }}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
              >
                {tCommon('cancel')}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            {rendition.notes || <span className="text-slate-400 italic">{t('notes.placeholder')}</span>}
          </p>
        )}
      </div>

      {/* Metadata */}
      <div className="text-xs text-slate-400 flex gap-4">
        <span>{t('detail.createdAt')}: {formatDate(rendition.createdAt)}</span>
        <span>{t('detail.updatedAt')}: {formatDate(rendition.updatedAt)}</span>
      </div>
    </div>
  );
}
