'use client';

import { useParams } from 'next/navigation';
import { InvoiceDetail } from '@/components/invoices/invoice-detail';
import { ReadGate } from '@/components/ui/read-gate';

export default function InvoiceDetailPage() {
  const params = useParams();
  const invoiceId = params.id as string;

  return (
    <ReadGate resource="invoices">
      <InvoiceDetail invoiceId={invoiceId} />
    </ReadGate>
  );
}
