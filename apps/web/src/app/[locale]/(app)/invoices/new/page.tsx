'use client';

import { Suspense } from 'react';
import { NewInvoiceForm } from '@/components/invoices/new-invoice/new-invoice-form';

export default function NewInvoicePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    }>
      <NewInvoiceForm />
    </Suspense>
  );
}
