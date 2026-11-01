'use client';

import { useParams } from 'next/navigation';
import { ImportBatchDetail } from '@/components/settings/import-batches';

export default function ImportacionDetailPage() {
  const params = useParams();
  return <ImportBatchDetail id={params.id as string} />;
}
