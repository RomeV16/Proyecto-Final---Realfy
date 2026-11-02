'use client';

import { OwnerBalances } from '@/components/owner-accounts/owner-balances';
import { ReadGate } from '@/components/ui/read-gate';

export default function OwnersPage() {
  return (
    <ReadGate resource="renditions">
      <OwnerBalances />
    </ReadGate>
  );
}
