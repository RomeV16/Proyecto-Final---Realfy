'use client';

import { useParams } from 'next/navigation';
import { ContractDetailView } from '@/components/contracts/contract-detail';

export default function ContractDetailPage() {
  const params = useParams();
  const contractId = params.id as string;

  return <ContractDetailView contractId={contractId} />;
}
