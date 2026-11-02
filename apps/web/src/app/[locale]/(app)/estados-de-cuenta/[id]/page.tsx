'use client';

import { useParams } from 'next/navigation';
import { OwnerStatementDetail } from '@/components/owner-accounts/owner-statement-detail';
import { ReadGate } from '@/components/ui/read-gate';

export default function OwnerStatementPage() {
  const params = useParams();
  return (
    <ReadGate resource="renditions">
      <OwnerStatementDetail statementId={params.id as string} />
    </ReadGate>
  );
}
