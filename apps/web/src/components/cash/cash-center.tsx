'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCan } from '@/lib/permissions';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Tabs } from '@/components/ui/tabs';
import { AccountsPanel } from './accounts-panel';
import { CashBalance } from './cash-balance';
import { CustodyPanel } from './custody-panel';
import { MovementsPanel } from './movements-panel';
import { ReceiptsPanel } from './receipts-panel';
import { useCashAccounts } from './use-cash-data';

const TABS = ['movements', 'accounts', 'custody', 'receipts'] as const;
type Tab = (typeof TABS)[number];

/**
 * Caja de la inmobiliaria: el saldo actual arriba y, debajo, el libro de caja, las cuentas (caja, banco y la
 * custodia de cada locador), la entrega del efectivo en custodia y los recibos de cobro para reimprimir.
 */
export function CashCenter() {
  const t = useTranslations('cash');
  const canView = useCan('cash.view');
  const canManage = useCan('cash.manage');
  const canAccounts = useCan('cash.accounts');
  const [tab, setTab] = useState<Tab>('movements');
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
        <h1 className="h1">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </header>

      <CashBalance data={accounts.data} failed={accounts.error != null} onViewAccounts={() => setTab('accounts')} />

      <Tabs tabs={TABS} value={tab} onChange={setTab} label={t('title')} labelOf={(key) => t(`tabs.${key}`)}>
        {tab === 'accounts' && (
          <AccountsPanel
            data={accounts.data}
            error={accounts.error}
            canAccounts={canAccounts}
            onChanged={accounts.reload}
          />
        )}
        {tab === 'movements' && (
          <>
            {accounts.error != null && <ErrorNotice error={accounts.error} fallback={t('loadError')} className="mb-4" />}
            <MovementsPanel
              accounts={items}
              ready={accounts.data !== null || accounts.error != null}
              canManage={canManage}
              onChanged={accounts.reload}
            />
          </>
        )}
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
