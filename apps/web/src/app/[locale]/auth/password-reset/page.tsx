'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PasswordResetForm } from '@/components/auth/password-reset-form';

function Content() {
  return <PasswordResetForm token={useSearchParams().get('token')} />;
}

export default function PasswordResetPage() {
  return (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  );
}
