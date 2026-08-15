'use client';

import { useTranslations } from 'next-intl';
import { useState, useEffect, useCallback } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { ValuationMethod, Currency } from '@realfy/shared';
import { EntityRow } from '@/components/ui/entity-card';
import { RowListSkeleton } from '@/components/ui/card-grid';
import { Icon } from '@/components/ui/icon';
import { Sparkline, TrendDelta } from '@/components/ui/micro-viz';

/* ──────────── Types ──────────── */

interface Valuation {
  id: string;
  valuationDate: string;
  value: number | string;
  currency: string;
  method: string;
  appraiser?: string | null;
  notes?: string | null;
  createdAt: string;
}

interface ValuationsResponse {
  items: Valuation[];
  total: number;
  page: number;
  limit: number;
}

interface ComparableProperty {
  id: string;
  title: string;
  type: string;
  city?: string;
  rooms?: number;
  totalArea?: number;
  latestValuation?: {
    value: number;
    currency: string;
    valuationDate: string;
  } | null;
}

interface PropertyValuationsProps {
  propertyId: string;
  canEdit: boolean;
}

/* ──────────── Helpers ──────────── */

function formatPrice(value: number | string, currency: string): string {
  const symbol = currency === 'USD' ? 'US$' : '$';
  return `${symbol} ${Number(value).toLocaleString('es-AR')}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function pctChange(curr: number, prev: number): number {
  if (!prev) return 0;
  return Number((((curr - prev) / prev) * 100).toFixed(1));
}

/* ──────────── Component ──────────── */

export function PropertyValuations({ propertyId, canEdit }: PropertyValuationsProps) {
  const t = useTranslations('properties.valuations');

  const [valuations, setValuations] = useState<Valuation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    valuationDate: new Date().toISOString().slice(0, 10),
    value: '',
    currency: Currency.ARS as string,
    method: ValuationMethod.Comparativo as string,
    appraiser: '',
    notes: '',
  });

  // Comparable state
  const [showComparables, setShowComparables] = useState(false);
  const [comparables, setComparables] = useState<ComparableProperty[]>([]);
  const [loadingComparables, setLoadingComparables] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadValuations = useCallback(async () => {
    try {
      setError('');
      const res = await apiClient<ValuationsResponse>(
        `/properties/${propertyId}/valuations?limit=50`,
      );
      setValuations(res.items || []);
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError(t('errorLoading'));
    } finally {
      setLoading(false);
    }
  }, [propertyId, t]);

  useEffect(() => {
    loadValuations();
  }, [loadValuations]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiClient(`/properties/${propertyId}/valuations`, {
        method: 'POST',
        body: JSON.stringify({
          propertyId,
          valuationDate: formData.valuationDate,
          value: Number(formData.value),
          currency: formData.currency,
          method: formData.method,
          appraiser: formData.appraiser || null,
          notes: formData.notes || null,
        }),
      });
      setShowForm(false);
      setFormData({
        valuationDate: new Date().toISOString().slice(0, 10),
        value: '',
        currency: Currency.ARS,
        method: ValuationMethod.Comparativo,
        appraiser: '',
        notes: '',
      });
      await loadValuations();
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError(t('errorSaving'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError('');
    try {
      await apiClient(`/properties/${propertyId}/valuations/${id}`, {
        method: 'DELETE',
      });
      await loadValuations();
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError(t('errorDeleting'));
    } finally {
      setDeletingId(null);
    }
  }

  async function loadComparables() {
    if (showComparables) {
      setShowComparables(false);
      return;
    }
    setLoadingComparables(true);
    setError('');
    try {
      const res = await apiClient<ComparableProperty[]>(
        `/properties/${propertyId}/valuations/comparables`,
      );
      setComparables(res);
      setShowComparables(true);
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError(t('errorLoading'));
    } finally {
      setLoadingComparables(false);
    }
  }

  if (loading) {
    return <RowListSkeleton count={3} />;
  }

  // Oldest → newest for the trend header.
  const chronological = [...valuations].sort(
    (a, b) => new Date(a.valuationDate).getTime() - new Date(b.valuationDate).getTime(),
  );
  const sparkData = chronological.map((v) => Number(v.value));
  const latest = chronological[chronological.length - 1];
  const first = chronological[0];
  const overallPct = chronological.length > 1 ? pctChange(Number(latest.value), Number(first.value)) : null;

  // Newest → oldest for the row list.
  const sorted = [...chronological].reverse();

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-danger)_28%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-danger)_8%,var(--color-surface))] p-3 text-sm text-[color-mix(in_oklab,var(--color-danger)_75%,var(--color-text))]">
          {error}
        </div>
      )}

      {/* Trend header — a real series, so the sparkline earns its place */}
      {sparkData.length > 1 && latest && (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-[var(--color-bg)] px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-lg font-bold tabular-nums text-[var(--color-text)]">
              {formatPrice(latest.value, latest.currency)}
            </p>
            {overallPct != null && overallPct !== 0 && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <TrendDelta value={overallPct} />
                <span className="text-[11px] text-[var(--color-muted)]">{t('vsFirstValuation')}</span>
              </div>
            )}
          </div>
          <Sparkline data={sparkData} width={96} height={32} tone="brand" />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-[var(--radius-lg)] bg-[var(--color-brand-500)] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[var(--color-brand-600)]"
          >
            {t('add')}
          </button>
        )}
        <button
          onClick={loadComparables}
          disabled={loadingComparables}
          className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg)] disabled:opacity-50"
        >
          {loadingComparables ? '…' : showComparables ? t('hideComparables') : t('showComparables')}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{t('date')}</label>
              <input
                type="date"
                value={formData.valuationDate}
                onChange={(e) => setFormData({ ...formData, valuationDate: e.target.value })}
                required
                className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{t('value')}</label>
              <input
                type="number"
                value={formData.value}
                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                required
                min="1"
                step="0.01"
                placeholder="0.00"
                className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{t('currency')}</label>
              <select
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              >
                {Object.values(Currency).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{t('method')}</label>
              <select
                value={formData.method}
                onChange={(e) => setFormData({ ...formData, method: e.target.value })}
                className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              >
                {Object.values(ValuationMethod).map((m) => (
                  <option key={m} value={m}>{t(`methods.${m}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{t('appraiser')}</label>
              <input
                type="text"
                value={formData.appraiser}
                onChange={(e) => setFormData({ ...formData, appraiser: e.target.value })}
                maxLength={300}
                className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{t('notes')}</label>
              <input
                type="text"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                maxLength={5000}
                className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="rounded-[var(--radius-lg)] bg-[var(--color-brand-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-brand-600)] disabled:opacity-50"
            >
              {saving ? t('saving') : t('save')}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg)]"
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      )}

      {/* Valuations list */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-2xl)] bg-[var(--color-bg)]">
            <Icon name="wallet" className="h-6 w-6 text-[var(--color-muted)]" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-[var(--color-muted)]">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((v, idx) => {
            const older = sorted[idx + 1];
            const pct = older ? pctChange(Number(v.value), Number(older.value)) : null;

            return (
              <EntityRow
                key={v.id}
                leading={
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: 'color-mix(in oklab, var(--color-brand-500) 14%, var(--color-surface))',
                      color: 'var(--color-brand-600)',
                    }}
                  >
                    <Icon name="wallet" className="h-4.5 w-4.5" strokeWidth={1.75} />
                  </span>
                }
                title={formatPrice(v.value, v.currency)}
                subtitle={`${formatDate(v.valuationDate)} · ${t(`methods.${v.method}`)}${v.appraiser ? ` · ${v.appraiser}` : ''}`}
                meta={v.notes ? <p className="truncate text-xs text-[var(--color-muted)]">{v.notes}</p> : undefined}
                trailing={pct != null && pct !== 0 ? <TrendDelta value={pct} /> : undefined}
                actions={
                  canEdit && (
                    <EntityRow.Action
                      onClick={() => handleDelete(v.id)}
                      variant="quiet"
                      className="hover:text-[var(--color-danger)]"
                      disabled={deletingId === v.id}
                    >
                      {deletingId === v.id ? t('deleting') : t('delete')}
                    </EntityRow.Action>
                  )
                }
              />
            );
          })}
        </div>
      )}

      {/* Comparable properties */}
      {showComparables && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-[var(--color-text)]">{t('comparables')}</h4>
          {comparables.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--color-muted)]">{t('comparablesEmpty')}</p>
          ) : (
            <div className="space-y-2">
              {comparables.map((cp) => (
                <div
                  key={cp.id}
                  className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-brand-500)_18%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-brand-500)_5%,var(--color-surface))] p-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-medium text-[var(--color-text)]">{cp.title}</p>
                    <div className="flex items-center gap-3 text-xs text-[var(--color-muted)]">
                      <span>{cp.type}</span>
                      {cp.city && <span>· {cp.city}</span>}
                      {cp.rooms != null && <span>· {cp.rooms} amb.</span>}
                      {cp.totalArea != null && <span>· {cp.totalArea} m²</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {cp.latestValuation ? (
                      <div>
                        <span className="text-sm font-semibold tabular-nums text-[var(--color-text)]">
                          {formatPrice(cp.latestValuation.value, cp.latestValuation.currency)}
                        </span>
                        <p className="text-[11px] text-[var(--color-muted)]">
                          {formatDate(cp.latestValuation.valuationDate)}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--color-muted)]">{t('noValuation')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
