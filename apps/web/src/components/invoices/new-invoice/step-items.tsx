'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { ParamCacheItem } from '@/lib/schemas/invoices';

export interface LineItem {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  alicuotaIvaId: number;
}

export interface ComputedAmounts {
  impNeto: number;
  impIva: number;
  impTotal: number;
  impTotConc: number;
  impOpEx: number;
  impTrib: number;
  monId: string;
  monCotiz: number;
}

export interface StepItemsData {
  items: LineItem[];
  amounts: ComputedAmounts;
}

/* ── AFIP alícuotas IVA (static fallback) ── */

const ALICUOTAS_STATIC: ParamCacheItem[] = [
  { id: 1, desc: 'No Gravado (0%)' },
  { id: 2, desc: 'Exento (0%)' },
  { id: 3, desc: '0%' },
  { id: 4, desc: '10.5%' },
  { id: 5, desc: '21%' },
  { id: 6, desc: '27%' },
  { id: 8, desc: '5%' },
  { id: 9, desc: '2.5%' },
];

const IVA_RATES: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 10.5, 5: 21, 6: 27, 8: 5, 9: 2.5 };

function calcLine(item: LineItem): { subtotal: number; iva: number; total: number } {
  const subtotal = item.cantidad * item.precioUnitario;
  const rate = IVA_RATES[item.alicuotaIvaId] ?? 0;
  const iva = subtotal * rate / 100;
  return { subtotal, iva, total: subtotal + iva };
}

function fmt(n: number): string {
  return '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  value: StepItemsData;
  onChange: (v: StepItemsData) => void;
  onNext: () => void;
  onBack: () => void;
  alicuotaOptions: ParamCacheItem[];
}

const EMPTY_ITEM: LineItem = { descripcion: '', cantidad: 1, precioUnitario: 0, alicuotaIvaId: 5 };

export function StepItems({ value, onChange, onNext, onBack, alicuotaOptions }: Props) {
  const t = useTranslations('invoices.newInvoice.step3');
  const [showManual, setShowManual] = useState(false);

  const alicuotas = alicuotaOptions.length > 0 ? alicuotaOptions : ALICUOTAS_STATIC;

  // Compute totals from items
  const computed = useMemo(() => {
    let impNeto = 0;
    let impIva = 0;
    for (const item of value.items) {
      const { subtotal, iva } = calcLine(item);
      impNeto += subtotal;
      impIva += iva;
    }
    return { impNeto, impIva, impTotal: impNeto + impIva + value.amounts.impTotConc + value.amounts.impOpEx + value.amounts.impTrib };
  }, [value.items, value.amounts.impTotConc, value.amounts.impOpEx, value.amounts.impTrib]);

  // Detect mismatch
  const mismatch = Math.abs(value.amounts.impTotal - computed.impTotal) > 0.01;

  function updateItem(idx: number, patch: Partial<LineItem>) {
    const newItems = value.items.map((it, i) => i === idx ? { ...it, ...patch } : it);
    const newComputed = newItems.reduce((acc, it) => {
      const { subtotal, iva } = calcLine(it);
      return { impNeto: acc.impNeto + subtotal, impIva: acc.impIva + iva };
    }, { impNeto: 0, impIva: 0 });
    const impTotal = newComputed.impNeto + newComputed.impIva + value.amounts.impTotConc + value.amounts.impOpEx + value.amounts.impTrib;
    onChange({
      items: newItems,
      amounts: { ...value.amounts, ...newComputed, impTotal },
    });
  }

  function addItem() {
    const newItems = [...value.items, { ...EMPTY_ITEM }];
    onChange({ ...value, items: newItems });
  }

  function removeItem(idx: number) {
    const newItems = value.items.filter((_, i) => i !== idx);
    const newComputed = newItems.reduce((acc, it) => {
      const { subtotal, iva } = calcLine(it);
      return { impNeto: acc.impNeto + subtotal, impIva: acc.impIva + iva };
    }, { impNeto: 0, impIva: 0 });
    const impTotal = newComputed.impNeto + newComputed.impIva + value.amounts.impTotConc + value.amounts.impOpEx + value.amounts.impTrib;
    onChange({ items: newItems, amounts: { ...value.amounts, ...newComputed, impTotal } });
  }

  function updateAmounts(patch: Partial<ComputedAmounts>) {
    const merged = { ...value.amounts, ...patch };
    // Recompute impTotal from items + overrides
    const fromItems = value.items.reduce((acc, it) => {
      const { subtotal, iva } = calcLine(it);
      return { impNeto: acc.impNeto + subtotal, impIva: acc.impIva + iva };
    }, { impNeto: 0, impIva: 0 });
    merged.impNeto = fromItems.impNeto;
    merged.impIva = fromItems.impIva;
    merged.impTotal = fromItems.impNeto + fromItems.impIva + merged.impTotConc + merged.impOpEx + merged.impTrib;
    onChange({ ...value, amounts: merged });
  }

  const isValid = value.items.length > 0 && value.items.every((it) => it.descripcion && it.cantidad > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{t('title')}</h2>
        <p className="text-sm text-slate-500 mt-0.5">{t('subtitle')}</p>
      </div>

      {/* Line items */}
      <div className="space-y-3">
        {value.items.map((item, idx) => {
          const { subtotal, iva, total } = calcLine(item);
          return (
            <div key={idx} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">{t('item')} {idx + 1}</span>
                {value.items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors"
                    aria-label={t('removeItem')}
                  >
                    {t('removeItem')}
                  </button>
                )}
              </div>

              <div>
                <label htmlFor={`desc-${idx}`} className="block text-xs font-medium text-slate-500 mb-1">{t('descripcion')} *</label>
                <input
                  id={`desc-${idx}`}
                  type="text"
                  value={item.descripcion}
                  onChange={(e) => updateItem(idx, { descripcion: e.target.value })}
                  required
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor={`qty-${idx}`} className="block text-xs font-medium text-slate-500 mb-1">{t('cantidad')} *</label>
                  <input
                    id={`qty-${idx}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={item.cantidad}
                    onChange={(e) => updateItem(idx, { cantidad: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                  />
                </div>
                <div>
                  <label htmlFor={`price-${idx}`} className="block text-xs font-medium text-slate-500 mb-1">{t('precioUnitario')}</label>
                  <input
                    id={`price-${idx}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.precioUnitario}
                    onChange={(e) => updateItem(idx, { precioUnitario: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                  />
                </div>
                <div>
                  <label htmlFor={`iva-${idx}`} className="block text-xs font-medium text-slate-500 mb-1">{t('alicuotaIva')}</label>
                  <select
                    id={`iva-${idx}`}
                    value={item.alicuotaIvaId}
                    onChange={(e) => updateItem(idx, { alicuotaIvaId: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                  >
                    {alicuotas.map((a) => (
                      <option key={a.id} value={a.id}>{a.desc}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Line summary */}
              <div className="flex justify-end gap-4 text-xs text-slate-500 pt-1 border-t border-slate-100">
                <span>{t('subtotal')}: <strong className="text-slate-700 tabular-nums">{fmt(subtotal)}</strong></span>
                <span>{t('iva')}: <strong className="text-slate-700 tabular-nums">{fmt(iva)}</strong></span>
                <span>{t('total')}: <strong className="text-slate-900 tabular-nums">{fmt(total)}</strong></span>
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={addItem}
          className="w-full py-2.5 rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-500 hover:border-brand-300 hover:text-brand-600 transition-colors"
        >
          + {t('addItem')}
        </button>
      </div>

      {/* Totals */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">{t('impNeto')}</span>
          <span className="font-mono tabular-nums text-slate-900">{fmt(computed.impNeto)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">{t('impIva')}</span>
          <span className="font-mono tabular-nums text-slate-900">{fmt(computed.impIva)}</span>
        </div>
        <div className="flex justify-between text-base font-semibold border-t border-slate-200 pt-2 mt-2">
          <span className="text-slate-900">{t('impTotal')}</span>
          <span className="font-mono tabular-nums text-slate-900">{fmt(computed.impTotal)}</span>
        </div>
      </div>

      {/* Manual overrides (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setShowManual(!showManual)}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
          aria-expanded={showManual}
        >
          <svg className={`w-4 h-4 transition-transform ${showManual ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
          {t('manualOverrides')}
        </button>

        {showManual && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white rounded-xl border border-slate-200 p-4">
            {[
              { key: 'impTotConc' as const, label: t('impTotConc') },
              { key: 'impOpEx' as const, label: t('impOpEx') },
              { key: 'impTrib' as const, label: t('impTrib') },
            ].map(({ key, label }) => (
              <div key={key}>
                <label htmlFor={key} className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                <input
                  id={key}
                  type="number"
                  min="0"
                  step="0.01"
                  value={value.amounts[key]}
                  onChange={(e) => updateAmounts({ [key]: parseFloat(e.target.value) || 0 })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                />
              </div>
            ))}
            <div>
              <label htmlFor="monId" className="block text-xs font-medium text-slate-500 mb-1">{t('monId')}</label>
              <select
                id="monId"
                value={value.amounts.monId}
                onChange={(e) => updateAmounts({ monId: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              >
                <option value="PES">ARS (PES)</option>
                <option value="DOL">USD (DOL)</option>
              </select>
            </div>
            {value.amounts.monId !== 'PES' && (
              <div>
                <label htmlFor="monCotiz" className="block text-xs font-medium text-slate-500 mb-1">{t('monCotiz')}</label>
                <input
                  id="monCotiz"
                  type="number"
                  min="0.000001"
                  step="0.01"
                  value={value.amounts.monCotiz}
                  onChange={(e) => updateAmounts({ monCotiz: parseFloat(e.target.value) || 1 })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {mismatch && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm" role="alert">
          {t('amountMismatch')}
        </div>
      )}

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
          {t('back')}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!isValid}
          className="px-6 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('next')}
        </button>
      </div>
    </div>
  );
}
