'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { FeeCreateDialog } from './fee-create-dialog';
import { FeeInstallmentsPanel } from './fee-installments-panel';
import { FeeListPanel } from './fee-list-panel';
import { StaffCommissionsPanel } from './staff-commissions-panel';

type Tab = 'installments' | 'fees' | 'commissions';

/**
 * Honorarios: las cuotas para cobrar (a la caja o descontadas de la cuenta del locador), los honorarios cargados
 * con su detalle y, para la gerencia, las comisiones del personal.
 */
export function FeeCenter() {
  const t = useTranslations('fees');
  const canView = useCan('fees.view');
  const canManage = useCan('fees.manage');
  const canCommissions = useCan('fees.commissions');
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('installments');
  const [creating, setCreating] = useState(false);

  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  const tabs: Tab[] = canCommissions ? ['installments', 'fees', 'commissions'] : ['installments', 'fees'];
  const refresh = () => {
    for (const key of ['fees', 'fee-installments', 'staff-commissions']) void queryClient.invalidateQueries({ queryKey: [key] });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        {canManage && (
          <Button type="button" onClick={() => setCreating(true)}>
            {t('add')}
          </Button>
        )}
      </header>

      <Tabs tabs={tabs} value={tab} onChange={setTab} label={t('title')} labelOf={(key) => t(`tabs.${key}`)}>
        {tab === 'installments' && <FeeInstallmentsPanel />}
        {tab === 'fees' && <FeeListPanel />}
        {tab === 'commissions' && <StaffCommissionsPanel />}
      </Tabs>

      {creating && <FeeCreateDialog onClose={() => setCreating(false)} onSaved={refresh} />}
    </div>
  );
}
