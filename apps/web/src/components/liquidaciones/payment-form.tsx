'use client';

import { useTranslations } from 'next-intl';
import { Spinner } from '@/components/ui/spinner';
import { PaymentMethod } from '@realfy/shared';
import { useState } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';

interface PaymentFormProps {
  liquidacionId: string;
  remainingBalance: number;
  onSuccess: () => void;
  onClose: () => void;
}

export function PaymentForm({ liquidacionId, remainingBalance, onSuccess, onClose }: PaymentFormProps) {
  const t = useTranslations('liquidaciones.payments');
  const tMethods = useTranslations('liquidaciones.paymentMethods');
  const tCommon = useTranslations('common');

  const [amount, setAmount] = useState(remainingBalance > 0 ? String(remainingBalance) : '');
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().split('T')[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      setError(t('invalidAmount'));
      return;
    }
    if (!method) {
      setError(t('methodRequired'));
      return;
    }

    setSubmitting(true);
    try {
      await apiClient(`/liquidaciones/${liquidacionId}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: parsedAmount,
          method,
          reference: reference || undefined,
          notes: notes || undefined,
          paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
        }),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('registerError'));
    } finally {
      setSubmitting(false);
    }
  }

  const formatCurrency = (val: number) =>
    '$ ' + val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-zoom-in">
        {/* Remaining balance header */}
        <div className="bg-slate-50 px-6 py-4 border-b border-slate-100">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t('remainingBalance')}</p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
            {formatCurrency(remainingBalance)}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">{t('title')}</h2>

          {/* Amount */}
          <div>
            <label htmlFor="payment-amount" className="block text-xs font-medium text-slate-500 mb-1">
              {t('amount')} *
            </label>
            <input
              id="payment-amount"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t('amountPlaceholder')}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              required
            />
          </div>

          {/* Method */}
          <div>
            <label htmlFor="payment-method" className="block text-xs font-medium text-slate-500 mb-1">
              {t('method')} *
            </label>
            <select
              id="payment-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              required
            >
              <option value="">{t('method')}</option>
              {Object.values(PaymentMethod).map((m) => (
                <option key={m} value={m}>{tMethods(m)}</option>
              ))}
            </select>
          </div>

          {/* Reference */}
          <div>
            <label htmlFor="payment-reference" className="block text-xs font-medium text-slate-500 mb-1">
              {t('reference')}
            </label>
            <input
              id="payment-reference"
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t('referencePlaceholder')}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>

          {/* Paid at */}
          <div>
            <label htmlFor="payment-date" className="block text-xs font-medium text-slate-500 mb-1">
              {t('paidAt')}
            </label>
            <input
              id="payment-date"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="payment-notes" className="block text-xs font-medium text-slate-500 mb-1">
              {t('notes')}
            </label>
            <textarea
              id="payment-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('notesPlaceholder')}
              rows={2}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {tCommon('cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting && <Spinner className="w-4 h-4 text-white" />}
              {t('registerPayment')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
