'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AcceptInvitationForm } from '@/components/auth/accept-invitation-form';

function Content() {
  return <AcceptInvitationForm token={useSearchParams().get('token')} />;
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  );
}
