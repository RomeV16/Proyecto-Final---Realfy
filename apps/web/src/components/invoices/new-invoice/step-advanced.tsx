'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

export interface TributoRow {
  id: number;
  desc: string;
  baseImp: number;
  alic: number;
  importe: number;
}

export interface OpcionalRow {
  id: number;
  valor: string;
}

export interface CbtesAsocRow {
  tipo: number;
  ptoVta: number;
  nro: number;
  cuit?: string;
  fecha?: string;
}

export interface StepAdvancedData {
  periodoDesde: string;
  periodoHasta: string;
  fchServDesde: string;
  fchServHasta: string;
  fchVtoPago: string;
  tributos: TributoRow[];
  opcionales: OpcionalRow[];
  cbtesAsoc: CbtesAsocRow[];
}

interface Props {
  value: StepAdvancedData;
  onChange: (v: StepAdvancedData) => void;
  onBack: () => void;
  onPreview: () => void;
  concepto: number;         // 1 = productos, 2/3 = services → fchServ required
  isNc?: boolean;
}

const EMPTY_TRIB: TributoRow = { id: 0, desc: '', baseImp: 0, alic: 0, importe: 0 };
const EMPTY_OPC: OpcionalRow = { id: 0, valor: '' };
const EMPTY_CBTE: CbtesAsocRow = { tipo: 0, ptoVta: 1, nro: 0 };

export function StepAdvanced({ value, onChange, onBack, onPreview, concepto, isNc }: Props) {
  const t = useTranslations('invoices.newInvoice.step4');

  const serviceRequired = concepto !== 1;
  const serviceError =
    serviceRequired && (!value.fchServDesde || !value.fchServHasta || !value.fchVtoPago);

  const isValid = !serviceError;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{t('title')}</h2>
        <p className="text-sm text-slate-500 mt-0.5">{t('subtitle')}</p>
      </div>

      {/* Período asociado */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">
          {t('periodo')}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="periodoDesde" className="block text-xs font-medium text-slate-500 mb-1">{t('desde')}</label>
            <input
              id="periodoDesde"
              type="date"
              value={value.periodoDesde}
              onChange={(e) => onChange({ ...value, periodoDesde: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
          <div>
            <label htmlFor="periodoHasta" className="block text-xs font-medium text-slate-500 mb-1">{t('hasta')}</label>
            <input
              id="periodoHasta"
              type="date"
              value={value.periodoHasta}
              onChange={(e) => onChange({ ...value, periodoHasta: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
        </div>
      </section>

      {/* Fechas servicio */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">{t('fchServ')}</h3>
          {serviceRequired && <span className="text-xs text-red-600">{t('required')}</span>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="fchServDesde" className="block text-xs font-medium text-slate-500 mb-1">
              {t('fchServDesde')} {serviceRequired ? '*' : ''}
            </label>
            <input
              id="fchServDesde"
              type="date"
              value={value.fchServDesde}
              onChange={(e) => onChange({ ...value, fchServDesde: e.target.value })}
              required={serviceRequired}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
          <div>
            <label htmlFor="fchServHasta" className="block text-xs font-medium text-slate-500 mb-1">
              {t('fchServHasta')} {serviceRequired ? '*' : ''}
            </label>
            <input
              id="fchServHasta"
              type="date"
              value={value.fchServHasta}
              onChange={(e) => onChange({ ...value, fchServHasta: e.target.value })}
              required={serviceRequired}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
          <div>
            <label htmlFor="fchVtoPago" className="block text-xs font-medium text-slate-500 mb-1">
              {t('fchVtoPago')} {serviceRequired ? '*' : ''}
            </label>
            <input
              id="fchVtoPago"
              type="date"
              value={value.fchVtoPago}
              onChange={(e) => onChange({ ...value, fchVtoPago: e.target.value })}
              required={serviceRequired}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
        </div>
        {serviceRequired && serviceError && (
          <p className="text-xs text-red-600" role="alert">{t('serviceRequiredError')}</p>
        )}
      </section>

      {/* Tributos */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            {t('tributos')}
          </h3>
          <button
            type="button"
            onClick={() => onChange({ ...value, tributos: [...value.tributos, { ...EMPTY_TRIB }] })}
            className="text-xs text-brand-600 hover:text-brand-700 transition-colors"
          >
            + {t('addTributo')}
          </button>
        </div>
        {value.tributos.length === 0 ? (
          <p className="text-xs text-slate-400">{t('noTributos')}</p>
        ) : (
          <div className="space-y-2">
            {value.tributos.map((trib, idx) => (
              <div key={idx} className="grid grid-cols-5 gap-2 items-end">
                <div>
                  <label className="block text-xs text-slate-400 mb-0.5">{t('tribId')}</label>
                  <input type="number" value={trib.id} onChange={(e) => {
                    const t2 = [...value.tributos]; t2[idx] = { ...t2[idx], id: Number(e.target.value) }; onChange({ ...value, tributos: t2 });
                  }} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-0.5">{t('tribDesc')}</label>
                  <input type="text" value={trib.desc} onChange={(e) => {
                    const t2 = [...value.tributos]; t2[idx] = { ...t2[idx], desc: e.target.value }; onChange({ ...value, tributos: t2 });
                  }} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-0.5">{t('tribImporte')}</label>
                  <input type="number" min="0" step="0.01" value={trib.importe} onChange={(e) => {
                    const t2 = [...value.tributos]; t2[idx] = { ...t2[idx], importe: parseFloat(e.target.value) || 0 }; onChange({ ...value, tributos: t2 });
                  }} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-0.5">{t('tribAlic')}</label>
                  <input type="number" min="0" step="0.01" value={trib.alic} onChange={(e) => {
                    const t2 = [...value.tributos]; t2[idx] = { ...t2[idx], alic: parseFloat(e.target.value) || 0 }; onChange({ ...value, tributos: t2 });
                  }} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
                </div>
                <button type="button" onClick={() => {
                  const t2 = value.tributos.filter((_, i) => i !== idx); onChange({ ...value, tributos: t2 });
                }} className="text-xs text-red-500 hover:text-red-700 pb-1.5">×</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Opcionales */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            {t('opcionales')}
          </h3>
          <button type="button" onClick={() => onChange({ ...value, opcionales: [...value.opcionales, { ...EMPTY_OPC }] })} className="text-xs text-brand-600 hover:text-brand-700 transition-colors">
            + {t('addOpcional')}
          </button>
        </div>
        {value.opcionales.length === 0 ? (
          <p className="text-xs text-slate-400">{t('noOpcionales')}</p>
        ) : (
          <div className="space-y-2">
            {value.opcionales.map((opc, idx) => (
              <div key={idx} className="flex gap-2 items-end">
                <div className="w-24">
                  <label className="block text-xs text-slate-400 mb-0.5">ID</label>
                  <input type="number" value={opc.id} onChange={(e) => {
                    const o2 = [...value.opcionales]; o2[idx] = { ...o2[idx], id: Number(e.target.value) }; onChange({ ...value, opcionales: o2 });
                  }} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-0.5">{t('opcValor')}</label>
                  <input type="text" value={opc.valor} onChange={(e) => {
                    const o2 = [...value.opcionales]; o2[idx] = { ...o2[idx], valor: e.target.value }; onChange({ ...value, opcionales: o2 });
                  }} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
                </div>
                <button type="button" onClick={() => {
                  const o2 = value.opcionales.filter((_, i) => i !== idx); onChange({ ...value, opcionales: o2 });
                }} className="text-xs text-red-500 hover:text-red-700 pb-1.5">×</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Comprobantes asociados (NC/ND) */}
      {isNc && (
        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">
              {t('cbtesAsoc')}
            </h3>
            <button type="button" onClick={() => onChange({ ...value, cbtesAsoc: [...value.cbtesAsoc, { ...EMPTY_CBTE }] })} className="text-xs text-brand-600 hover:text-brand-700 transition-colors">
              + {t('addCbte')}
            </button>
          </div>
          {value.cbtesAsoc.map((cbte, idx) => (
            <div key={idx} className="grid grid-cols-4 gap-2 items-end">
              <div>
                <label className="block text-xs text-slate-400 mb-0.5">{t('cbteTipo')}</label>
                <input type="number" value={cbte.tipo} onChange={(e) => {
                  const c2 = [...value.cbtesAsoc]; c2[idx] = { ...c2[idx], tipo: Number(e.target.value) }; onChange({ ...value, cbtesAsoc: c2 });
                }} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-0.5">{t('cbtePtoVta')}</label>
                <input type="number" value={cbte.ptoVta} onChange={(e) => {
                  const c2 = [...value.cbtesAsoc]; c2[idx] = { ...c2[idx], ptoVta: Number(e.target.value) }; onChange({ ...value, cbtesAsoc: c2 });
                }} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-0.5">{t('cbteNro')}</label>
                <input type="number" value={cbte.nro} onChange={(e) => {
                  const c2 = [...value.cbtesAsoc]; c2[idx] = { ...c2[idx], nro: Number(e.target.value) }; onChange({ ...value, cbtesAsoc: c2 });
                }} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30" />
              </div>
              <button type="button" onClick={() => {
                const c2 = value.cbtesAsoc.filter((_, i) => i !== idx); onChange({ ...value, cbtesAsoc: c2 });
              }} className="text-xs text-red-500 hover:text-red-700 pb-1.5">×</button>
            </div>
          ))}
        </section>
      )}

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
          {t('back')}
        </button>
        <button
          type="button"
          onClick={onPreview}
          disabled={!isValid}
          className="px-6 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('preview')}
        </button>
      </div>
    </div>
  );
}
