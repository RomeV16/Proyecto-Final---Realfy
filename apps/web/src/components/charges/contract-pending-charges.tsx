'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api-client';
import type { ChargesResponse } from '@/lib/charges';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { ChargeQuickAdd } from './charge-quick-add';
import { ChargeTable } from './charge-table';
import { useChargeTargets } from './use-charge-targets';

/** Cargos pendientes de un contrato, en su detalle: lo que entrará en la próxima liquidación y lo que espera anticipo. */
export function ContractPendingCharges({ contractId }: { contractId: string }) {
  const t = useTranslations('charges');
  const canManage = useCan('charges.manage');
  const targets = useChargeTargets(canManage);
  const [data, setData] = useState<ChargesResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiClient<ChargesResponse>(`/charges?contractId=${contractId}&status=Pendiente&limit=50`));
    } catch (err) {
      setError(err);
    }
  }, [contractId]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const refresh = () => setVersion((v) => v + 1);

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{t('contract.title')}</h2>
        <div className="flex items-center gap-3">
          {canManage && (
            <>
              <Link href="/cargos" className="text-sm text-[var(--color-brand-600)] hover:underline">
                {t('contract.viewAll')}
              </Link>
              <Button type="button" size="sm" onClick={() => setShowAdd(true)}>
                {t('add')}
              </Button>
            </>
          )}
        </div>
      </div>
      <ChargeTable
        items={data?.items ?? []}
        loading={data === null && error == null}
        error={error}
        canManage={canManage}
        onChanged={refresh}
        hideProperty
      />
      {showAdd && (
        <ChargeQuickAdd
          contracts={targets.contracts}
          properties={targets.properties}
          contractId={contractId}
          onClose={() => setShowAdd(false)}
          onSaved={refresh}
        />
      )}
    </section>
  );
}
