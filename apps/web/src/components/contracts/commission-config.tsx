'use client';

import { useTranslations } from 'next-intl';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Skeleton } from '@/components/ui/skeleton';
import { useState, useEffect, useCallback } from 'react';
import { CommissionType } from '@realfy/shared';

/* ──────────── Types ──────────── */

interface CommissionData {
  id: string;
  contractId: string;
  commissionType: CommissionType;
  percentage?: number | null;
  fixedAmount?: string | number | null;
  adminFee?: string | number | null;
  notes?: string | null;
}

interface CommissionConfigProps {
  contractId: string;
}

/* ──────────── Component ──────────── */

export function CommissionConfig({ contractId }: CommissionConfigProps) {
  const t = useTranslations('commissions');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [existing, setExisting] = useState<CommissionData | null>(null);

  // Form state
  const [commissionType, setCommissionType] = useState<CommissionType | ''>('');
  const [percentage, setPercentage] = useState('');
  const [fixedAmount, setFixedAmount] = useState('');
  const [adminFee, setAdminFee] = useState('');
  const [notes, setNotes] = useState('');

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchCommission = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient<CommissionData>(`/contracts/${contractId}/commission`);
      setExisting(data);
      if (data) {
        setCommissionType(data.commissionType);
        setPercentage(data.percentage != null ? String(data.percentage) : '');
        setFixedAmount(data.fixedAmount != null ? String(data.fixedAmount) : '');
        setAdminFee(data.adminFee != null ? String(data.adminFee) : '');
        setNotes(data.notes || '');
      }
    } catch (err) {
      // 404 means no commission yet, which is fine
      if (err instanceof ApiRequestError && err.statusCode === 404) {
        setExisting(null);
      } else {
        setFeedback({ type: 'error', message: t('loadError') });
      }
    } finally {
      setLoading(false);
    }
  }, [contractId, t]);

  useEffect(() => {
    fetchCommission();
  }, [fetchCommission]);

  const showPercentage = commissionType === CommissionType.FixedPercent || commissionType === CommissionType.Mixed;
  const showFixedAmount = commissionType === CommissionType.FixedAmount || commissionType === CommissionType.Mixed;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const body: Record<string, unknown> = {
        commissionType,
        adminFee: adminFee ? Number(adminFee) : 0,
        notes: notes || undefined,
      };
      if (showPercentage) body.percentage = Number(percentage);
      if (showFixedAmount) body.fixedAmount = Number(fixedAmount);

      const data = await apiClient<CommissionData>(`/contracts/${contractId}/commission`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setExisting(data);
      setFeedback({ type: 'success', message: t('saveSuccess') });
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof ApiRequestError ? err.message : t('saveError') });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(t('deleteConfirm'))) return;
    setDeleting(true);
    setFeedback(null);
    try {
      await apiClient(`/contracts/${contractId}/commission`, { method: 'DELETE' });
      setExisting(null);
      setCommissionType('');
      setPercentage('');
      setFixedAmount('');
      setAdminFee('');
      setNotes('');
      setFeedback({ type: 'success', message: t('deleteSuccess') });
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof ApiRequestError ? err.message : t('deleteError') });
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">{t('title')}</h2>
        <div className="space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h2 className="text-sm font-semibold text-slate-900 mb-3">{t('title')}</h2>

      <form onSubmit={handleSave} className="space-y-4">
        {/* Commission Type */}
        <div>
          <label htmlFor="commission-type" className="block text-xs font-medium text-slate-500 mb-1">
            {t('type')}
          </label>
          <select
            id="commission-type"
            value={commissionType}
            onChange={(e) => setCommissionType(e.target.value as CommissionType)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            required
          >
            <option value="">{t('typePlaceholder')}</option>
            {Object.values(CommissionType).map((ct) => (
              <option key={ct} value={ct}>{t(`types.${ct}`)}</option>
            ))}
          </select>
        </div>

        {/* Percentage — shown for FixedPercent and Mixed */}
        {showPercentage && (
          <div>
            <label htmlFor="commission-percentage" className="block text-xs font-medium text-slate-500 mb-1">
              {t('percentage')}
            </label>
            <input
              id="commission-percentage"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={percentage}
              onChange={(e) => setPercentage(e.target.value)}
              placeholder={t('percentagePlaceholder')}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              required
            />
          </div>
        )}

        {/* Fixed Amount — shown for FixedAmount and Mixed */}
        {showFixedAmount && (
          <div>
            <label htmlFor="commission-fixed-amount" className="block text-xs font-medium text-slate-500 mb-1">
              {t('fixedAmount')}
            </label>
            <input
              id="commission-fixed-amount"
              type="number"
              step="0.01"
              min="0"
              value={fixedAmount}
              onChange={(e) => setFixedAmount(e.target.value)}
              placeholder={t('fixedAmountPlaceholder')}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              required
            />
          </div>
        )}

        {/* Admin Fee */}
        <div>
          <label htmlFor="commission-admin-fee" className="block text-xs font-medium text-slate-500 mb-1">
            {t('adminFee')}
          </label>
          <input
            id="commission-admin-fee"
            type="number"
            step="0.01"
            min="0"
            value={adminFee}
            onChange={(e) => setAdminFee(e.target.value)}
            placeholder={t('adminFeePlaceholder')}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="commission-notes" className="block text-xs font-medium text-slate-500 mb-1">
            {t('notes')}
          </label>
          <textarea
            id="commission-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('notesPlaceholder')}
            rows={2}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none"
          />
        </div>

        {/* Feedback */}
        {feedback && (
          <div className={`rounded-lg px-3 py-2 text-sm ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            {feedback.message}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" variant="primary" size="sm" disabled={saving || !commissionType}>
            {saving && <Spinner className="w-3 h-3 text-white" />}
            {saving ? t('saving') : t('save')}
          </Button>

          {existing && (
            <Button type="button" variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
              {deleting && <Spinner className="w-3 h-3 text-white" />}
              {deleting ? t('deleting') : t('delete')}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
