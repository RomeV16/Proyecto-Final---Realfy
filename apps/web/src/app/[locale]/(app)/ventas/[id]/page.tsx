'use client';

import { useParams } from 'next/navigation';
import { SalesDetail } from '@/components/sales/sales-detail';

export default function SalesDetailPage() {
  const params = useParams();
  return <SalesDetail id={params.id as string} />;
}
