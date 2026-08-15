'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { ParamCacheItem, PadronResult } from '@/lib/schemas/invoices';

export interface StepReceptorData {
  docTipo: number;
  docNro: string;
  razonSocial: string;
  condicionIvaReceptorId: number;
  domicilio: string;
}

const DOC_TIPOS_STATIC = [
  { id: 80, desc: 'CUIT' },
  { id: 96, desc: 'DNI' },
  { id: 99, desc: 'Consumidor Final' },
];

interface Props {
  value: StepReceptorData;
  onChange: (v: StepReceptorData) => void;
  onNext: () => void;
  onBack: () => void;
  condicionIvaOptions: ParamCacheItem[];
}

export function StepReceptor({ value, onChange, onNext, onBack, condicionIvaOptions }: Props) {
  const t = useTranslations('invoices.newInvoice.step2');
  const [mode, setMode] = useState<'manual' | 'contact'>('manual');
  const [padronLoading, setPadronLoading] = useState(false);
  const [padronError, setPadronError] = useState('');

  async function handlePadronLookup() {
    if (!value.docNro || value.docTipo !== 80) return;
    setPadronLoading(true);
    setPadronError('');
    try {
      const res = await apiClient<PadronResult>(`/invoices/padron/${value.docNro}`);
      onChange({
        ...value,
        razonSocial: res.razonSocial || value.razonSocial,
        domicilio: res.domicilio || value.domicilio,
      });
    } catch {
      setPadronError(t('padronError'));
    } finally {
      setPadronLoading(false);
    }
  }

  const ivaOptions: ParamCacheItem[] = condicionIvaOptions.length > 0
    ? condicionIvaOptions
    : [
        { id: 1, desc: 'IVA Responsable Inscripto' },
        { id: 4, desc: 'IVA Sujeto Exento' },
        { id: 5, desc: 'Consumidor Final' },
        { id: 6, desc: 'Responsable Monotributo' },
        { id: 7, desc: 'Sujeto No Categorizado' },
        { id: 9, desc: 'IVA Liberado – Ley Nº 19.640' },
        { id: 10, desc: 'IVA Responsable Inscripto – Agente de Percepción' },
        { id: 13, desc: 'Pequeño Contribuyente Eventual' },
        { id: 16, desc: 'Eventual Responsable Inscripto' },
      ];

  const isValid = value.docNro && value.razonSocial && value.condicionIvaReceptorId > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{t('title')}</h2>
        <p className="text-sm text-slate-500 mt-0.5">{t('subtitle')}</p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode('manual')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'manual' ? 'bg-brand-500 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
        >
          {t('modeManual')}
        </button>
        <button
          type="button"
          onClick={() => setMode('contact')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'contact' ? 'bg-brand-500 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'}`}
        >
          {t('modeContact')}
        </button>
      </div>

      {mode === 'contact' && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm">
          {t('contactNotAvailable')}
        </div>
      )}

      {mode === 'manual' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Doc tipo */}
          <div>
            <label htmlFor="docTipo" className="block text-xs font-medium text-slate-500 mb-1">
              {t('docTipo')} *
            </label>
            <select
              id="docTipo"
              value={value.docTipo}
              onChange={(e) => onChange({ ...value, docTipo: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              {DOC_TIPOS_STATIC.map((d) => (
                <option key={d.id} value={d.id}>{d.desc}</option>
              ))}
            </select>
          </div>

          {/* Doc nro + padron lookup */}
          <div>
            <label htmlFor="docNro" className="block text-xs font-medium text-slate-500 mb-1">{t('docNro')} *</label>
            <div className="flex gap-2">
              <input
                id="docNro"
                type="text"
                value={value.docNro}
                onChange={(e) => onChange({ ...value, docNro: e.target.value })}
                required
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              />
              {value.docTipo === 80 && (
                <button
                  type="button"
                  onClick={handlePadronLookup}
                  disabled={padronLoading || !value.docNro}
                  title={t('padronLookup')}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {padronLoading ? '…' : t('padronBtn')}
                </button>
              )}
            </div>
            {padronError && <p className="text-xs text-red-600 mt-1" role="alert">{padronError}</p>}
          </div>

          {/* Razón social */}
          <div className="sm:col-span-2">
            <label htmlFor="razonSocial" className="block text-xs font-medium text-slate-500 mb-1">{t('razonSocial')} *</label>
            <input
              id="razonSocial"
              type="text"
              value={value.razonSocial}
              onChange={(e) => onChange({ ...value, razonSocial: e.target.value })}
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>

          {/* Condición IVA receptor */}
          <div>
            <label htmlFor="condicionIvaReceptorId" className="block text-xs font-medium text-slate-500 mb-1">
              {t('condicionIva')} *
            </label>
            <select
              id="condicionIvaReceptorId"
              value={value.condicionIvaReceptorId || ''}
              onChange={(e) => onChange({ ...value, condicionIvaReceptorId: Number(e.target.value) })}
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{t('condicionIvaPlaceholder')}</option>
              {ivaOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.desc}</option>
              ))}
            </select>
          </div>

          {/* Domicilio (optional) */}
          <div>
            <label htmlFor="domicilio" className="block text-xs font-medium text-slate-500 mb-1">{t('domicilio')}</label>
            <input
              id="domicilio"
              type="text"
              value={value.domicilio}
              onChange={(e) => onChange({ ...value, domicilio: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
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
