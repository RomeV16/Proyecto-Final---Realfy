'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/lib/auth-context';
import { ErrorBoundary } from '@/components/error-boundary';
import { AppLayout } from '@/components/layout/app-layout';
import { GlobalLoadingBar } from '@/components/layout/global-loading-bar';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000, // 30s — avoid re-fetching on every mount
        retry: 1,
      },
    },
  });
}

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // useState ensures one QueryClient per component lifecycle (safe with React 19 SSR)
  const [queryClient] = useState(makeQueryClient);

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <GlobalLoadingBar />
          <AppLayout>{children}</AppLayout>
        </ErrorBoundary>
      </QueryClientProvider>
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}
