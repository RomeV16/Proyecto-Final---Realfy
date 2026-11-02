'use client';

import { Suspense } from 'react';
import { FollowUpsScreen } from '@/components/follow-ups/follow-ups-screen';

export default function FollowUpsPage() {
  // La pantalla lee `?contractId=` de la dirección: sin Suspense no se puede prerenderizar.
  return (
    <Suspense>
      <FollowUpsScreen />
    </Suspense>
  );
}
