'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCan } from '@/lib/permissions';
import { Tabs } from '@/components/ui/tabs';
import { AccountsPanel } from './accounts-panel';
import { CustodyPanel } from './custody-panel';
import { MovementsPanel } from './movements-panel';
import { ReceiptsPanel } from './receipts-panel';
import { useCashAccounts } from './use-cash-data';

const TABS = ['accounts', 'movements', 'custody', 'receipts'] as const;
type Tab = (typeof TABS)[number];

/**
 * Caja de la inmobiliaria: las cuentas (caja, banco y la custodia de cada locador) con sus saldos, el libro de
 * movimientos, la entrega del efectivo en custodia y los recibos de cobro para reimprimir.
 */
export function CashCenter() {
  const t = useTranslations('cash');
  const canView = useCan('cash.view');
  const canManage = useCan('cash.manage');
  const canAccounts = useCan('cash.accounts');
  const [tab, setTab] = useState<Tab>('accounts');
  const accounts = useCashAccounts(canView, true);

  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  const items = accounts.data?.items ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </header>

      <Tabs tabs={TABS} value={tab} onChange={setTab} label={t('title')} labelOf={(key) => t(`tabs.${key}`)}>
        {tab === 'accounts' && (
          <AccountsPanel
            data={accounts.data}
            error={accounts.error}
            canAccounts={canAccounts}
            onChanged={accounts.reload}
          />
        )}
        {tab === 'movements' && <MovementsPanel accounts={items} canManage={canManage} onChanged={accounts.reload} />}
        {tab === 'custody' && (
          <CustodyPanel
            accounts={items}
            loading={accounts.data === null && accounts.error == null}
            error={accounts.error}
            canManage={canManage}
            onChanged={accounts.reload}
          />
        )}
        {tab === 'receipts' && <ReceiptsPanel />}
      </Tabs>
    </div>
  );
}
