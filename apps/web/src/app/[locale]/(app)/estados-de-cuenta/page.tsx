'use client';

import { OwnerStatements } from '@/components/owner-accounts/owner-statements';
import { ReadGate } from '@/components/ui/read-gate';

export default function OwnerStatementsPage() {
  return (
    <ReadGate resource="renditions">
      <OwnerStatements />
    </ReadGate>
  );
}
