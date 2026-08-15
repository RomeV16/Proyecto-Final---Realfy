'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { ArcaIssuerDTO, ArcaPdvDTO, ParamCacheItem } from '@/lib/schemas/invoices';
import { FiscalCondition } from '@realfy/shared';

/* ── AFIP voucher types by fiscal condition ── */

const TIPOS_BY_FC: Record<string, number[]> = {
  [FiscalCondition.ResponsableInscripto]: [1, 2, 3, 4, 6, 7, 8, 9],
  [FiscalCondition.Monotributista]: [11, 12, 13, 15],
  [FiscalCondition.Exento]: [1, 6, 11, 51],
  [FiscalCondition.ConsumidorFinal]: [11, 6],
  [FiscalCondition.NoResponsable]: [1, 6, 11],
};

/* ── Fallback static tipo list ── */

const TIPOS_STATIC: Record<number, string> = {
  1: 'Factura A', 2: 'Nota de Débito A', 3: 'Nota de Crédito A',
  4: 'Recibo A', 6: 'Factura B', 7: 'Nota de Débito B',
  8: 'Nota de Crédito B', 9: 'Recibo B', 11: 'Factura C',
  12: 'Nota de Débito C', 13: 'Nota de Crédito C', 15: 'Recibo C',
  51: 'Factura M',
};

const CONCEPTOS = [
  { id: 1, desc: 'Productos' },
  { id: 2, desc: 'Servicios' },
  { id: 3, desc: 'Productos y Servicios' },
];

export interface StepIssuerData {
  issuerId: string;
  pdvId: string;
  cbteTipo: number;
  concepto: number;
  cbteFch: string;
  issuerFiscalCondition: string;
}

interface Props {
  value: StepIssuerData;
  onChange: (v: StepIssuerData) => void;
  onNext: () => void;
}

export function StepIssuer({ value, onChange, onNext }: Props) {
  const t = useTranslations('invoices.newInvoice.step1');
  const tFc = useTranslations('persons.fiscalConditions');

  const [issuers, setIssuers] = useState<ArcaIssuerDTO[]>([]);
  const [pdvList, setPdvList] = useState<ArcaPdvDTO[]>([]);
  const [tiposCbte, setTiposCbte] = useState<ParamCacheItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [issuersRes, tiposRes] = await Promise.allSettled([
          apiClient<ArcaIssuerDTO[]>('/invoices/issuers'),
          apiClient<ParamCacheItem[]>('/invoices/param-cache/tiposCbte'),
        ]);
        const issuerList = issuersRes.status === 'fulfilled' ? issuersRes.value.filter((i) => i.isActive && i.delegationStatus === 'Active') : [];
        setIssuers(issuerList);
        if (tiposRes.status === 'fulfilled') {
          setTiposCbte(tiposRes.value);
        }
        // Auto-select first issuer
        if (!value.issuerId && issuerList.length > 0) {
          onChange({ ...value, issuerId: issuerList[0].id, issuerFiscalCondition: issuerList[0].fiscalCondition });
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When issuer changes, load pdv list
  useEffect(() => {
    if (!value.issuerId) { setPdvList([]); return; }
    const issuer = issuers.find((i) => i.id === value.issuerId);
    if (issuer) {
      setPdvList(issuer.puntosDeVenta);
      onChange({ ...value, issuerFiscalCondition: issuer.fiscalCondition });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.issuerId, issuers]);

  const selectedIssuer = issuers.find((i) => i.id === value.issuerId);
  const allowedTipos = selectedIssuer
    ? (TIPOS_BY_FC[selectedIssuer.fiscalCondition] ?? [1, 6, 11])
    : [];

  const tipoOptions: ParamCacheItem[] = tiposCbte.length > 0
    ? tiposCbte.filter((t) => allowedTipos.includes(t.id))
    : allowedTipos.map((id) => ({ id, desc: TIPOS_STATIC[id] ?? `Tipo ${id}` }));

  const today = new Date().toISOString().slice(0, 10);

  function handleIssuerChange(id: string) {
    const issuer = issuers.find((i) => i.id === id);
    onChange({
      ...value,
      issuerId: id,
      pdvId: '',
      cbteTipo: 0,
      issuerFiscalCondition: issuer?.fiscalCondition ?? '',
    });
  }

  const isValid = value.issuerId && value.pdvId && value.cbteTipo > 0 && value.cbteFch;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{t('title')}</h2>
        <p className="text-sm text-slate-500 mt-0.5">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Issuer */}
        <div className="sm:col-span-2">
          <label htmlFor="issuerId" className="block text-xs font-medium text-slate-500 mb-1">{t('issuer')} *</label>
          {issuers.length === 0 ? (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              {t('noIssuers')}
            </div>
          ) : (
            <select
              id="issuerId"
              value={value.issuerId}
              onChange={(e) => handleIssuerChange(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{t('issuerPlaceholder')}</option>
              {issuers.map((iss) => (
                <option key={iss.id} value={iss.id}>
                  {iss.businessName}{iss.isSelf ? ' (Mi inmobiliaria)' : ''} — {iss.cuit}
                </option>
              ))}
            </select>
          )}
          {selectedIssuer && (
            <p className="text-xs text-slate-400 mt-1">
              {tFc(selectedIssuer.fiscalCondition)} · Delegación: {selectedIssuer.delegationStatus}
            </p>
          )}
        </div>

        {/* PdV */}
        <div>
          <label htmlFor="pdvId" className="block text-xs font-medium text-slate-500 mb-1">
            {t('pdv')} *
          </label>
          <select
            id="pdvId"
            value={value.pdvId}
            onChange={(e) => onChange({ ...value, pdvId: e.target.value })}
            required
            disabled={!value.issuerId}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">{t('pdvPlaceholder')}</option>
            {pdvList.map((pdv) => (
              <option key={pdv.id} value={pdv.id}>
                {String(pdv.number).padStart(4, '0')}{pdv.nombre ? ` — ${pdv.nombre}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Tipo comprobante */}
        <div>
          <label htmlFor="cbteTipo" className="block text-xs font-medium text-slate-500 mb-1">
            {t('cbteTipo')} *
          </label>
          <select
            id="cbteTipo"
            value={value.cbteTipo || ''}
            onChange={(e) => onChange({ ...value, cbteTipo: Number(e.target.value) })}
            required
            disabled={!value.issuerId}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">{t('cbteTipoPlaceholder')}</option>
            {tipoOptions.map((tipo) => (
              <option key={tipo.id} value={tipo.id}>{tipo.desc}</option>
            ))}
          </select>
        </div>

        {/* Concepto */}
        <div>
          <label htmlFor="concepto" className="block text-xs font-medium text-slate-500 mb-1">
            {t('concepto')}
          </label>
          <select
            id="concepto"
            value={value.concepto}
            onChange={(e) => onChange({ ...value, concepto: Number(e.target.value) })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          >
            {CONCEPTOS.map((c) => (
              <option key={c.id} value={c.id}>{c.desc}</option>
            ))}
          </select>
        </div>

        {/* Fecha comprobante */}
        <div>
          <label htmlFor="cbteFch" className="block text-xs font-medium text-slate-500 mb-1">{t('cbteFch')}</label>
          <input
            id="cbteFch"
            type="date"
            value={value.cbteFch}
            max={today}
            onChange={(e) => onChange({ ...value, cbteFch: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
        </div>
      </div>

      <div className="flex justify-end">
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
