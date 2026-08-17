'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { useState, useEffect, useCallback } from 'react';

/* ──────────── Types ──────────── */

interface ScoreConfig {
  guaranteeWeight: number;
  jobStabilityWeight: number;
  referencesWeight: number;
  paymentHistoryWeight: number;
  manualRatingWeight: number;
}

const WEIGHT_KEYS = [
  'guaranteeWeight',
  'jobStabilityWeight',
  'referencesWeight',
  'paymentHistoryWeight',
  'manualRatingWeight',
] as const;

type WeightKey = (typeof WEIGHT_KEYS)[number];

/* ──────────── Main Page ──────────── */

export default function ScoringConfigPage() {
  const t = useTranslations('scoring');
  const tCommon = useTranslations('common');
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [weights, setWeights] = useState<Record<WeightKey, number>>({
    guaranteeWeight: 20,
    jobStabilityWeight: 20,
    referencesWeight: 20,
    paymentHistoryWeight: 20,
    manualRatingWeight: 20,
  });

  // RBAC gate: solo Admin/Gerente pueden ver y editar la configuración de puntaje.
  const canAccess = user?.role === 'Admin' || user?.role === 'Gerente';

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiClient<ScoreConfig>('/scoring/config');
      setWeights({
        guaranteeWeight: data.guaranteeWeight,
        jobStabilityWeight: data.jobStabilityWeight,
        referencesWeight: data.referencesWeight,
        paymentHistoryWeight: data.paymentHistoryWeight,
        manualRatingWeight: data.manualRatingWeight,
      });
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (canAccess) loadConfig();
    else setLoading(false);
  }, [canAccess, loadConfig]);

  async function handleSave() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const data = await apiClient<ScoreConfig>('/scoring/config', {
        method: 'PATCH',
        body: JSON.stringify(weights),
      });
      setWeights({
        guaranteeWeight: data.guaranteeWeight,
        jobStabilityWeight: data.jobStabilityWeight,
        referencesWeight: data.referencesWeight,
        paymentHistoryWeight: data.paymentHistoryWeight,
        manualRatingWeight: data.manualRatingWeight,
      });
      setSuccess(t('saveSuccess'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  function handleWeightChange(key: WeightKey, value: number) {
    setWeights((prev) => ({ ...prev, [key]: Math.max(0, Math.min(100, value)) }));
  }

  if (!canAccess) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
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

  const totalWeight = WEIGHT_KEYS.reduce((sum, k) => sum + weights[k], 0);

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)] tracking-tight">{t('title')}</h1>
        <p className="text-sm text-[var(--color-muted)] mt-0.5">{t('description')}</p>
      </div>

      {/* Feedback */}
      {error && (
        <div className="p-3 rounded-lg bg-[color-mix(in_oklab,var(--color-danger)_10%,var(--color-surface))] border border-[color-mix(in_oklab,var(--color-danger)_28%,var(--color-border))] text-[var(--color-danger)] text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-[color-mix(in_oklab,var(--color-success)_10%,var(--color-surface))] border border-[color-mix(in_oklab,var(--color-success)_28%,var(--color-border))] text-[var(--color-success)] text-sm">
          {success}
        </div>
      )}

      {/* Pesos de factores */}
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-5 space-y-5">
        <h2 className="text-base font-semibold text-[var(--color-text)] pb-2 border-b border-[var(--color-border)]">
          {t('weightsTitle')}
        </h2>

        {WEIGHT_KEYS.map((key) => {
          const labelKey = key.replace('Weight', '');
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor={key} className="text-sm font-medium text-[var(--color-text)]">
                  {t(`factors.${labelKey}`)}
                </label>
                <span className="text-sm font-mono text-[var(--color-muted)] tabular-nums">
                  {weights[key]}
                </span>
              </div>
              <input
                id={key}
                type="range"
                min={0}
                max={100}
                value={weights[key]}
                onChange={(e) => handleWeightChange(key, parseInt(e.target.value, 10))}
                className="w-full h-2 bg-[var(--color-bg)] rounded-lg appearance-none cursor-pointer accent-brand-500"
              />
            </div>
          );
        })}

        {/* Total de referencia */}
        <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-between">
          <span className="text-sm text-[var(--color-muted)]">{t('totalWeight')}</span>
          <span className="text-sm font-semibold text-[var(--color-text)] tabular-nums">{totalWeight}</span>
        </div>
      </div>

      {/* Guardar */}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="px-6 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? '...' : tCommon('save')}
        </button>
      </div>
    </div>
  );
}
