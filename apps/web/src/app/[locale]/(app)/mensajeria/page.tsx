'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { OutboxCenter } from '@/components/messaging/outbox-center';
import { outboxFiltersFromSearch } from '@/lib/messaging';

function Outbox() {
  const search = useSearchParams();
  // La clave reinicia los filtros si se llega con otra dirección sin desmontar la pantalla.
  return <OutboxCenter key={search?.toString() ?? ''} initialFilters={outboxFiltersFromSearch(search)} />;
}

export default function MessagingPage() {
  // La pantalla lee `?personId=` o `?relatedType=&relatedId=` de la dirección: sin Suspense no se puede prerenderizar.
  return (
    <Suspense fallback={null}>
      <Outbox />
    </Suspense>
  );
}
