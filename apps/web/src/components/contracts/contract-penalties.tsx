'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { formatDate, formatMoneyFixed } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Badge } from '@/components/ui/entity-card';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Skeleton } from '@/components/ui/skeleton';
import { WaiveDialog } from '@/components/penalties/waive-dialog';

interface PenaltyRow {
  id: string;
  amount: string;
  appliedOn: string;
  daysOverdue: number;
  status: 'active' | 'waived';
  waiveReason?: string | null;
  settledLiquidacionId?: string | null;
  liquidacion?: { id: string; period: string };
}

type Target = { kind: 'one'; row: PenaltyRow } | { kind: 'all' };

/**
 * Punitorios de un contrato: lo devengado en cada corrida, si ya se cobró en una
 * liquidación o se condonó. Quien gestiona puede condonar uno o todos, con un
 * motivo que queda en la auditoría.
 */
export function ContractPenalties({ contractId, currency }: { contractId: string; currency?: string }) {
  const t = useTranslations('punitorios');
  const canWaive = useCan('penalties.waive');
  const [rows, setRows] = useState<PenaltyRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [target, setTarget] = useState<Target | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiClient<PenaltyRow[]>(`/penalties?contractId=${encodeURIComponent(contractId)}`);
      setRows(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [contractId]);

  useEffect(() => {
    if (canWaive) void load();
  }, [canWaive, load]);

  // Los condonables son los activos que todavía no se cobraron en una liquidación.
  const waivable = (rows ?? []).filter((r) => r.status === 'active' && !r.settledLiquidacionId);
  const waivableTotal = waivable.reduce((acc, r) => acc + Number(r.amount), 0);

  async function confirm(reason: string) {
    if (!target) return;
    if (target.kind === 'one') {
      await apiClient(`/penalties/${target.row.id}/waive`, { method: 'POST', body: JSON.stringify({ reason }) });
    } else {
      await apiClient(`/contracts/${contractId}/penalties/waive-all`, { method: 'POST', body: JSON.stringify({ reason }) });
    }
    setTarget(null);
    toast.success(t('waive.done'));
    await load();
  }

  if (!canWaive || (rows !== null && rows.length === 0 && error == null)) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6" aria-labelledby="contract-penalties-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="contract-penalties-title" className="text-sm font-semibold text-slate-900">
          {t('contract.title')}
        </h2>
        {canWaive && waivable.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setTarget({ kind: 'all' })}>
            {t('contract.waiveAll')}
          </Button>
        )}
      </div>
      {error != null && <ErrorNotice error={error} fallback={t('contract.loadError')} />}
      {rows === null && error == null && <Skeleton className="h-16 w-full" />}
      {rows !== null && rows.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => {
            const open = row.status === 'active' && !row.settledLiquidacionId;
            return (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="space-y-0.5">
                  <p className="font-medium text-slate-900">
                    {formatMoneyFixed(row.amount, currency)}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      {t('contract.accrued', { date: formatDate(row.appliedOn, 'medium'), days: row.daysOverdue })}
                    </span>
                  </p>
                  {row.waiveReason && <p className="text-xs text-slate-500">{t('contract.reason', { reason: row.waiveReason })}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {row.status === 'waived' ? (
                    <Badge variant="neutral">{t('status.waived')}</Badge>
                  ) : row.settledLiquidacionId ? (
                    <Badge variant="info">{t('status.billed')}</Badge>
                  ) : (
                    <Badge variant="warning">{t('status.pending')}</Badge>
                  )}
                  {canWaive && open && (
                    <Button variant="ghost" size="sm" onClick={() => setTarget({ kind: 'one', row })}>
                      {t('waive.action')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <WaiveDialog
        open={target !== null}
        title={target?.kind === 'all' ? t('waive.titleAll') : t('waive.title')}
        body={
          target?.kind === 'all'
            ? t('waive.bodyAll', { count: waivable.length, amount: formatMoneyFixed(waivableTotal, currency) })
            : t('waive.body', { amount: target?.kind === 'one' ? formatMoneyFixed(target.row.amount, currency) : '' })
        }
        onClose={() => setTarget(null)}
        onConfirm={confirm}
      />
    </section>
  );
}
