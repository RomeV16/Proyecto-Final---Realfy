'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

interface Payment {
  id: string;
  amount: string;
  currency: string;
  method: string;
  paidAt: string;
  liquidacion?: { period?: string };
}
interface Debt {
  pendiente: { count: number; monto: number };
  vencida: { count: number; monto: number };
}

const money = (n: number | string) =>
  '$' + Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 });

const periodLabel = (iso?: string) => {
  if (!iso) return '—';
  const s = new Date(iso).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const METHOD_LABELS: Record<string, string> = {
  Transferencia: 'Transferencia bancaria',
  Efectivo: 'Efectivo',
  MercadoPago: 'Mercado Pago',
  Cheque: 'Cheque',
};

export default function PagosPage() {
  const t = useTranslations('payments');
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [debt, setDebt] = useState<Debt | null>(null);

  useEffect(() => {
    apiClient<{ items: Payment[] }>('/payments?limit=30')
      .then((r) => setPayments(r.items))
      .catch(() => setPayments([]));
    apiClient<Debt>('/payments/debt')
      .then(setDebt)
      .catch(() => setDebt(null));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('subtitle')}</p>
      </div>

      {debt && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-sm text-slate-500">{t('pendingDebt')}</p>
            <p className="text-2xl font-bold text-amber-600 mt-1">{money(debt.pendiente.monto)}</p>
            <p className="text-xs text-slate-400 mt-1">{debt.pendiente.count} {t('settlements')}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-sm text-slate-500">{t('overdueDebt')}</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{money(debt.vencida.monto)}</p>
            <p className="text-xs text-slate-400 mt-1">{debt.vencida.count} {t('settlements')}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">{t('recentPayments')}</h2>
        </div>
        {payments === null ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : payments.length === 0 ? (
          <div className="p-8"><EmptyState title={t('noPayments')} /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-2 font-medium">{t('date')}</th>
                <th className="text-left px-5 py-2 font-medium">{t('period')}</th>
                <th className="text-left px-5 py-2 font-medium">{t('method')}</th>
                <th className="text-right px-5 py-2 font-medium">{t('amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5 text-slate-700">{new Date(p.paidAt).toLocaleDateString('es-AR')}</td>
                  <td className="px-5 py-2.5 text-slate-500">{periodLabel(p.liquidacion?.period)}</td>
                  <td className="px-5 py-2.5 text-slate-500">{METHOD_LABELS[p.method] ?? p.method}</td>
                  <td className="px-5 py-2.5 text-right font-medium text-slate-900 tabular-nums">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
