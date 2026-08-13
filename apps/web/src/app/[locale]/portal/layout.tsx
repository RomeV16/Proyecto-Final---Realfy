'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PortalAuthProvider, usePortalAuth } from '@/lib/portal-auth-context';
import { cn } from '@/lib/cn';

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

function useLocalePrefix() {
  const pathname = usePathname();
  return pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
}

function PortalHeader() {
  const t = useTranslations();
  const { person, logout } = usePortalAuth();

  return (
    <header className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-brand-500 text-white font-bold text-sm shrink-0">
          R
        </div>
        <div className="min-w-0">
          <p className="micro">{t('portal.common.brand')}</p>
          <p className="text-sm font-semibold text-[var(--color-text)] truncate">
            {person ? `${person.firstName} ${person.lastName}` : ''}
          </p>
        </div>
      </div>
      {person && (
        <button
          onClick={() => logout()}
          className="text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          {t('portal.nav.logout')}
        </button>
      )}
    </header>
  );
}

function PortalNav() {
  const t = useTranslations();
  const pathname = usePathname();
  const prefix = useLocalePrefix();

  const items = [
    { href: `${prefix}/portal`, label: t('portal.nav.dashboard'), exact: true },
    {
      href: `${prefix}/portal/liquidaciones`,
      label: t('portal.nav.liquidaciones'),
      exact: false,
    },
    {
      href: `${prefix}/portal/tickets`,
      label: t('portal.nav.tickets'),
      exact: false,
    },
  ];

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <nav className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-2 sm:px-4">
      <div className="max-w-lg mx-auto flex items-center gap-1">
        {items.map((item) => {
          const active = isActive(item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative flex-1 text-center px-3 py-3 text-sm font-medium transition-colors',
                active
                  ? 'text-brand-600'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]',
              )}
            >
              {item.label}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function PortalChrome({ children }: { children: React.ReactNode }) {
  const { person, isLoading } = usePortalAuth();

  // Auth pages (login / set-password) render their own full-screen surface.
  if (!isLoading && !person) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg)]">
      <PortalHeader />
      {person && <PortalNav />}
      <main className="flex-1 p-4 overflow-y-auto">{children}</main>
    </div>
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
        <PortalChrome>{children}</PortalChrome>
      </QueryClientProvider>
    </PortalAuthProvider>
  );
}
