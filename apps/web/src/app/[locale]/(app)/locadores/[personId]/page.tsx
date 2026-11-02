'use client';

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { OwnerLedger } from '@/components/owner-accounts/owner-ledger';
import { ReadGate } from '@/components/ui/read-gate';

function Ledger() {
  const params = useParams();
  const search = useSearchParams();
  return <OwnerLedger personId={params.personId as string} initialCurrency={search.get('currency') || 'ARS'} />;
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
