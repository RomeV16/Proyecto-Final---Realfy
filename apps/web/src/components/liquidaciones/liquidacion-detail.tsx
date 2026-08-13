'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import {
  LiquidacionStatus,
  LineItemType,
  getValidLiquidacionTransitions,
} from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { LiquidacionStatusBadge } from './liquidacion-status-badge';
import { PaymentForm } from './payment-form';

/* ──────────── Types ──────────── */

interface LineItem {
  id: string;
  type: string;
  description: string;
  amount: string | number;
  meta?: { daysOverdue?: number } | null;
}

interface Payment {
  id: string;
  amount: string | number;
  method: string;
  reference?: string;
  notes?: string;
  paidAt: string;
}

interface LiquidacionData {
  id: string;
  status: string;
  period?: string;
  month?: number;
  year?: number;
  dueDate?: string;
  total?: string | number;
  subtotal?: string | number;
  totalAmount?: string | number;
  currency?: string;
  createdAt: string;
  updatedAt: string;
  contract?: {
    id: string;
    property?: { id: string; title: string; street?: string; city?: string };
  };
  lineItems: LineItem[];
  payments: Payment[];
}

interface LiquidacionDetailProps {
  liquidacionId: string;
}

/* ──────────── Helpers ──────────── */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

function formatCurrency(amount: string | number | undefined | null): string {
  if (amount == null) return '—';
  return '$ ' + Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const LINE_ITEM_ICONS: Record<string, string> = {
  [LineItemType.Alquiler]: '🏠',
  [LineItemType.Ajuste]: '📊',
  [LineItemType.Extra]: '➕',
  [LineItemType.Descuento]: '🏷️',
};

function transitionVariant(target: string): 'primary' | 'secondary' | 'danger' {
  if (target === LiquidacionStatus.Anulada) return 'danger';
  if (target === LiquidacionStatus.Borrador) return 'secondary';
  return 'primary';
}

/* ──────────── Main Component ──────────── */

export function LiquidacionDetail({ liquidacionId }: LiquidacionDetailProps) {
  const t = useTranslations('liquidaciones');
  const tDetail = useTranslations('liquidaciones.detail');
  const tLineItems = useTranslations('liquidaciones.lineItems');
  const tTotals = useTranslations('liquidaciones.totals');
  const tTransitions = useTranslations('liquidaciones.transitions');
  const tPayments = useTranslations('liquidaciones.payments');
  const tMethods = useTranslations('liquidaciones.paymentMethods');
  const tTypes = useTranslations('liquidaciones.lineItemTypes');
  const tMonths = useTranslations('liquidaciones.months');
  const tErrors = useTranslations('liquidaciones.errors');
  const tCommon = useTranslations('common');
  const { user } = useAuth();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [data, setData] = useState<LiquidacionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showLineItemForm, setShowLineItemForm] = useState(false);
  const [editingLineItem, setEditingLineItem] = useState<LineItem | null>(null);

  // Line item form state
  const [liType, setLiType] = useState('');
  const [liDescription, setLiDescription] = useState('');
  const [liAmount, setLiAmount] = useState('');

  const canAct = ['Admin', 'Gerente', 'Ventas', 'Liquidaciones'].includes(user?.role || '');
  const readOnly = ['Lectura', 'Soporte', 'Marketing'].includes(user?.role || '');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient<LiquidacionData>(`/liquidaciones/${liquidacionId}`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [liquidacionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Computed
  const totalAmount = data ? Number(data.totalAmount || data.total || data.subtotal || 0) : 0;
  const paidAmount = data ? (data.payments || []).reduce((s, p) => s + Number(p.amount), 0) : 0;
  const remainingBalance = totalAmount - paidAmount;
  const isEditable = data && [LiquidacionStatus.Borrador, LiquidacionStatus.Revision].includes(data.status as LiquidacionStatus);
  const validTransitions = data ? getValidLiquidacionTransitions(data.status as LiquidacionStatus) : [];

  const subtotal = data ? (data.lineItems || []).filter(li => li.type !== LineItemType.Descuento).reduce((s, li) => s + Number(li.amount), 0) : 0;
  const discounts = data ? (data.lineItems || []).filter(li => li.type === LineItemType.Descuento).reduce((s, li) => s + Number(li.amount), 0) : 0;

  /* ──── Actions ──── */

  async function handleTransition(targetStatus: LiquidacionStatus) {
    if (targetStatus === LiquidacionStatus.Anulada) {
      if (!confirm(tTransitions('confirmAnulada'))) return;
    }
    setActionLoading(targetStatus);
    setFeedback(null);
    try {
      await apiClient(`/liquidaciones/${liquidacionId}/transition`, {
        method: 'POST',
        body: JSON.stringify({ status: targetStatus }),
      });
      setFeedback({ type: 'success', msg: tTransitions('success') });
      fetchData();
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof ApiRequestError ? err.message : tTransitions('error') });
    } finally {
      setActionLoading('');
    }
  }

  function openAddLineItem() {
    setEditingLineItem(null);
    setLiType('');
    setLiDescription('');
    setLiAmount('');
    setShowLineItemForm(true);
  }

  function openEditLineItem(li: LineItem) {
    setEditingLineItem(li);
    setLiType(li.type);
    setLiDescription(li.description);
    setLiAmount(String(li.amount));
    setShowLineItemForm(true);
  }

  async function handleSaveLineItem(e: React.FormEvent) {
    e.preventDefault();
    setActionLoading('lineItem');
    setFeedback(null);
    try {
      if (editingLineItem) {
        await apiClient(`/liquidaciones/${liquidacionId}/line-items/${editingLineItem.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ type: liType, description: liDescription, amount: parseFloat(liAmount) }),
        });
        setFeedback({ type: 'success', msg: tLineItems('updateSuccess') });
      } else {
        await apiClient(`/liquidaciones/${liquidacionId}/line-items`, {
          method: 'POST',
          body: JSON.stringify({ type: liType, description: liDescription, amount: parseFloat(liAmount) }),
        });
        setFeedback({ type: 'success', msg: tLineItems('addSuccess') });
      }
      setShowLineItemForm(false);
      fetchData();
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof ApiRequestError ? err.message : tLineItems('addError') });
    } finally {
      setActionLoading('');
    }
  }

  async function handleRemoveLineItem(lineItemId: string) {
    if (!confirm(tLineItems('removeConfirm'))) return;
    setActionLoading('removeLineItem');
    setFeedback(null);
    try {
      await apiClient(`/liquidaciones/${liquidacionId}/line-items/${lineItemId}`, { method: 'DELETE' });
      setFeedback({ type: 'success', msg: tLineItems('removeSuccess') });
      fetchData();
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof ApiRequestError ? err.message : tLineItems('removeError') });
    } finally {
      setActionLoading('');
    }
  }

  /* ──── Render ──── */

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
        <Link href={`${localePrefix}/liquidaciones`} className="mt-4 text-sm text-brand-600 hover:text-brand-700">
          {'\u2190'} {tCommon('back')}
        </Link>
      </div>
    );
  }

  // Derive month/year from period ISO date if not provided directly
  const periodDate = data.period ? new Date(data.period) : null;
  const month = data.month ?? (periodDate ? periodDate.getUTCMonth() + 1 : undefined);
  const year = data.year ?? (periodDate ? periodDate.getUTCFullYear() : undefined);
  const periodLabel = month ? `${tMonths(String(month))} ${year}` : '—';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Back link */}
      <Link href={`${localePrefix}/liquidaciones`} className="text-sm text-brand-600 hover:text-brand-700">
        {'\u2190'} {tCommon('back')}
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <LiquidacionStatusBadge status={data.status} size="md" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">{periodLabel}</h1>
            {data.contract?.property && (
              <p className="text-sm text-slate-500">
                {data.contract.property.title}
                {data.contract.property.street && ` — ${[data.contract.property.street, data.contract.property.city].filter(Boolean).join(', ')}`}
              </p>
            )}
            {data.dueDate && (
              <p className="text-xs text-slate-400">{tDetail('dueDate')}: {formatDate(data.dueDate)}</p>
            )}
          </div>

          <div className="text-right space-y-2">
            <p className="text-xs text-slate-500">{tTotals('total')}</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">{formatCurrency(totalAmount)}</p>
          </div>
        </div>

        {/* Transition action buttons */}
        {!readOnly && validTransitions.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-2">
            {validTransitions.map((target) => (
              <Button
                key={target}
                variant={transitionVariant(target)}
                size="sm"
                onClick={() => handleTransition(target)}
                disabled={!!actionLoading}
              >
                {actionLoading === target && <Spinner className="w-4 h-4" />}
                {tTransitions(target)}
              </Button>
            ))}
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div className={`mt-3 rounded-lg px-3 py-2 border ${feedback.type === 'success' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
            <p className={`text-sm ${feedback.type === 'success' ? 'text-emerald-700' : 'text-red-700'}`}>{feedback.msg}</p>
          </div>
        )}
      </div>

      {/* Contract info */}
      {data.contract && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 mb-1">{tDetail('contract')}</h2>
              {data.contract.property && (
                <p className="text-sm text-slate-600">{data.contract.property.title}</p>
              )}
            </div>
            <Link href={`${localePrefix}/contracts/${data.contract.id}`}
              className="text-sm text-brand-600 hover:text-brand-700"
            >
              {tDetail('viewContract')} {'\u2192'}
            </Link>
          </div>
        </div>
      )}

      {/* Line items */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900">{tLineItems('title')}</h2>
          {isEditable && canAct && (
            <button
              onClick={openAddLineItem}
              className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {tLineItems('add')}
            </button>
          )}
        </div>

        {(data.lineItems || []).length === 0 ? (
          <p className="text-sm text-slate-400 italic">{tLineItems('empty')}</p>
        ) : (
          <div className="space-y-2">
            {(data.lineItems || []).map((li) => (
              <div
                key={li.id}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-lg group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg flex-shrink-0">{LINE_ITEM_ICONS[li.type] || '📄'}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-slate-500 px-1.5 py-0.5 rounded bg-slate-200">
                        {tTypes(li.type)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 mt-0.5 truncate">
                      {li.description.replace(/\s*\[pid:[^\]]+\]/, '')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-sm font-semibold tabular-nums ${li.type === LineItemType.Descuento ? 'text-red-600' : 'text-slate-900'}`}>
                    {li.type === LineItemType.Descuento ? '- ' : ''}{formatCurrency(li.amount)}
                  </span>
                  {isEditable && canAct && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEditLineItem(li)}
                        className="p-1 rounded text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                        title={tLineItems('edit')}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleRemoveLineItem(li.id)}
                        className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title={tLineItems('remove')}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Totals */}
        {(data.lineItems || []).length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-1.5">
            <div className="flex justify-between text-sm text-slate-500">
              <span>{tTotals('subtotal')}</span>
              <span className="tabular-nums">{formatCurrency(subtotal)}</span>
            </div>
            {discounts > 0 && (
              <div className="flex justify-between text-sm text-red-500">
                <span>{tTotals('discounts')}</span>
                <span className="tabular-nums">- {formatCurrency(discounts)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-slate-900 pt-1 border-t border-slate-100">
              <span>{tTotals('total')}</span>
              <span className="tabular-nums">{formatCurrency(totalAmount)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Line item form modal */}
      {showLineItemForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowLineItemForm(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-zoom-in">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              {editingLineItem ? t('lineItemForm.editTitle') : t('lineItemForm.title')}
            </h3>
            <form onSubmit={handleSaveLineItem} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{t('lineItemForm.type')}</label>
                <select
                  value={liType}
                  onChange={(e) => setLiType(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                  required
                >
                  <option value="">{tLineItems('selectType')}</option>
                  {Object.values(LineItemType).map((t2) => (
                    <option key={t2} value={t2}>{tTypes(t2)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{t('lineItemForm.description')}</label>
                <input
                  type="text"
                  value={liDescription}
                  onChange={(e) => setLiDescription(e.target.value)}
                  placeholder={tLineItems('descriptionPlaceholder')}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{t('lineItemForm.amount')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={liAmount}
                  onChange={(e) => setLiAmount(e.target.value)}
                  placeholder={tLineItems('amountPlaceholder')}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                  required
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLineItemForm(false)}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  {t('lineItemForm.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === 'lineItem'}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading === 'lineItem' && <Spinner className="w-3 h-3 text-white" />}
                  {t('lineItemForm.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payments section */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-900">{tPayments('title')}</h2>
          {!readOnly && canAct && [LiquidacionStatus.Enviada, LiquidacionStatus.Vencida].includes(data.status as LiquidacionStatus) && (
            <Button
              variant="accent"
              size="sm"
              onClick={() => setShowPaymentForm(true)}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              {tPayments('registerPayment')}
            </Button>
          )}
        </div>

        {(data.payments || []).length === 0 ? (
          <p className="text-sm text-slate-400 italic">{tPayments('empty')}</p>
        ) : (
          <div className="space-y-2">
            {(data.payments || []).map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{tMethods(p.method)}</p>
                  {p.reference && <p className="text-xs text-slate-500 font-mono truncate">{p.reference}</p>}
                  <p className="text-xs text-slate-400">{formatDate(p.paidAt)}</p>
                </div>
                <span className="text-sm font-semibold text-emerald-700 tabular-nums">{formatCurrency(p.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Remaining balance */}
        <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
          <span className="text-sm font-medium text-slate-600">{tPayments('remainingBalance')}</span>
          <span className={`text-lg font-bold tabular-nums ${remainingBalance <= 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
            {remainingBalance <= 0 ? tPayments('fullyPaid') : formatCurrency(remainingBalance)}
          </span>
        </div>
      </div>

      {/* PaymentForm modal */}
      {showPaymentForm && (
        <PaymentForm
          liquidacionId={liquidacionId}
          remainingBalance={remainingBalance}
          onSuccess={() => {
            setShowPaymentForm(false);
            setFeedback({ type: 'success', msg: tPayments('registerSuccess') });
            fetchData();
          }}
          onClose={() => setShowPaymentForm(false)}
        />
      )}

      {/* Metadata */}
      <div className="text-xs text-slate-400 flex gap-4">
        <span>{tDetail('createdAt')}: {formatDate(data.createdAt)}</span>
        <span>{tDetail('updatedAt')}: {formatDate(data.updatedAt)}</span>
      </div>
    </div>
  );
}
