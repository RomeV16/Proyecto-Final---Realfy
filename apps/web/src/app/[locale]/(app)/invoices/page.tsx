'use client';

import { InvoiceList } from '@/components/invoices/invoice-list';
import { ReadGate } from '@/components/ui/read-gate';

export default function InvoiceListPage() {
  return (
    <ReadGate resource="invoices">
      <InvoiceList />
    </ReadGate>
  );
}
