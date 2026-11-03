'use client';

import { useParams } from 'next/navigation';
import { CaseDetail } from '@/components/collections/case-detail';

export default function CollectionCasePage() {
  const params = useParams();
  return <CaseDetail id={params.id as string} />;
}
