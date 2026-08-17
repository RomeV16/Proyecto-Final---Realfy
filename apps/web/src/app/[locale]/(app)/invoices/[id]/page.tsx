'use client';

import { useParams } from 'next/navigation';
import { InvoiceDetail } from '@/components/invoices/invoice-detail';

export default function InvoiceDetailPage() {
  const params = useParams();
  const invoiceId = params.id as string;

  return <InvoiceDetail invoiceId={invoiceId} />;
}
