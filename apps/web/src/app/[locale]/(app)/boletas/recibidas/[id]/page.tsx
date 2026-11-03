'use client';

import { useParams } from 'next/navigation';
import { BillDocumentDetailScreen } from '@/components/bill-documents/bill-document-detail';

export default function ReceivedBillPage() {
  const { id } = useParams<{ id: string }>();
  return <BillDocumentDetailScreen id={id} />;
}
