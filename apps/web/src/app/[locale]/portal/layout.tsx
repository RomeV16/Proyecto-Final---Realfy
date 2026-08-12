'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PortalAuthProvider, usePortalAuth } from '@/lib/portal-auth-context';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

function PortalHeader() {
  const t = useTranslations();
  const { person, logout } = usePortalAuth();

  return (
    <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-brand-500 text-white font-bold text-sm">
          R
        </div>
        <span className="text-sm font-semibold text-slate-900">
          {person ? `${person.firstName} ${person.lastName}` : ''}
        </span>
      </div>
      {person && (
        <button
          onClick={() => logout()}
          className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          {t('portal.header.logout')}
        </button>
      )}
    </header>
  );
}

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <PortalAuthProvider>
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen flex flex-col bg-slate-50">
          <PortalHeader />
          <main className="flex-1 p-4 overflow-y-auto">{children}</main>
        </div>
      </QueryClientProvider>
    </PortalAuthProvider>
  );
}
