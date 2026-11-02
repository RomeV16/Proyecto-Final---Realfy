'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FeeKind } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api-client';
import type { Fee } from '@/lib/fees';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { FeeCreateDialog } from './fee-create-dialog';
import { FeeTable } from './fee-table';

/** Honorarios de un contrato, en su detalle: el de alta, los de renovación y su cobro. */
export function ContractFees({ contractId }: { contractId: string }) {
  const t = useTranslations('fees');
  const canView = useCan('fees.view');
  const canManage = useCan('fees.manage');
  const [items, setItems] = useState<Fee[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient<{ items: Fee[] }>(`/fees?contractId=${contractId}&limit=50`);
        if (!cancelled) {
          setItems(res?.items ?? []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, contractId, version]);

  if (!canView) return null;
  const refresh = () => setVersion((v) => v + 1);

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{t('contract.title')}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/honorarios" className="text-sm text-[var(--color-brand-600)] hover:underline">
            {t('contract.viewAll')}
          </Link>
          {canManage && (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={() => setCreating(FeeKind.Renovacion)}>
                {t('contract.addRenewal')}
              </Button>
              <Button type="button" size="sm" onClick={() => setCreating(FeeKind.AltaAlquiler)}>
                {t('contract.addAlta')}
              </Button>
            </>
          )}
        </div>
      </div>
      <FeeTable items={items ?? []} loading={items === null && error == null} error={error} onChanged={refresh} hideProperty />
      {creating && (
        <FeeCreateDialog initialKind={creating} contractId={contractId} onClose={() => setCreating(null)} onSaved={refresh} />
      )}
    </section>
  );
}
