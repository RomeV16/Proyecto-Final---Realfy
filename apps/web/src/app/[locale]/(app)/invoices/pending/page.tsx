'use client';

import { PendingLessorInvoices } from '@/components/invoices/lessor/pending-lessor-invoices';
import { ReadGate } from '@/components/ui/read-gate';

export default function PendingLessorInvoicesPage() {
  return (
    <ReadGate resource="invoices">
      <PendingLessorInvoices />
    </ReadGate>
  );
}
