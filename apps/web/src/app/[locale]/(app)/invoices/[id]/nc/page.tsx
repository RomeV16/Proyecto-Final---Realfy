'use client';

import { useParams } from 'next/navigation';
import { NcInvoiceForm } from '@/components/invoices/nc-invoice/nc-invoice-form';

export default function NcInvoicePage() {
  const params = useParams();
  const id = params.id as string;
  return <NcInvoiceForm originalInvoiceId={id} />;
}
