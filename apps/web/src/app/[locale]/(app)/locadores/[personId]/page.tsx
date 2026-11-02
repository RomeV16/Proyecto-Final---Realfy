'use client';

import { Suspense, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OwnerLedger } from '@/components/owner-accounts/owner-ledger';
import { LessorInvoicingTab } from '@/components/invoices/lessor/lessor-invoicing-tab';
import { ReadGate } from '@/components/ui/read-gate';
import { Tabs } from '@/components/ui/tabs';
import { useCan } from '@/lib/permissions';

const TABS = ['ledger', 'invoicing'] as const;
type Tab = (typeof TABS)[number];

function Ledger() {
  const t = useTranslations('lessorInvoicing');
  const params = useParams();
  const search = useSearchParams();
  const personId = params.personId as string;
  const canInvoicing = useCan('lessorInvoicing.view');
  const [tab, setTab] = useState<Tab>('ledger');
  const ledger = <OwnerLedger personId={personId} initialCurrency={search.get('currency') || 'ARS'} />;
  if (!canInvoicing) return ledger;
  return (
    <Tabs tabs={TABS} value={tab} onChange={setTab} label={t('tabs.label')} labelOf={(k) => t(`tabs.${k}`)}>
      <div className="pt-6">{tab === 'ledger' ? ledger : <LessorInvoicingTab personId={personId} />}</div>
    </Tabs>
  );
}

export default function OwnerLedgerPage() {
  return (
    <ReadGate resource="renditions">
      <Suspense fallback={null}>
        <Ledger />
      </Suspense>
    </ReadGate>
  );
}
