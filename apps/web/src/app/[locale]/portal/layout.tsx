'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PortalAuthProvider, usePortalAuth } from '@/lib/portal-auth-context';
import { Icon, type IconName } from '@/components/ui/icon';
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
    <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <span className="wordmark shrink-0 text-[1.25rem]">Realfy</span>
        {person && (
          <span className="min-w-0 truncate border-l border-[var(--color-border)] pl-3 text-sm font-medium text-[var(--color-text)]">
            {person.firstName} {person.lastName}
          </span>
        )}
      </div>

      {person && (
        <button
          type="button"
          onClick={() => logout()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-lg)] px-2.5 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]"
        >
          <Icon name="logout" className="h-4 w-4" strokeWidth={1.9} />
          <span className="hidden sm:inline">{t('portal.nav.logout')}</span>
          <span className="sr-only sm:hidden">{t('portal.nav.logout')}</span>
        </button>
      )}
    </div>
  );
}

function PortalNav() {
  const t = useTranslations();
  const pathname = usePathname();
  const prefix = useLocalePrefix();

  const items: { href: string; label: string; icon: IconName; exact: boolean }[] = [
    { href: `${prefix}/portal`, label: t('portal.nav.home'), icon: 'dashboard', exact: true },
    {
      // The route keeps the API's name; the label is the tenant's.
      href: `${prefix}/portal/liquidaciones`,
      label: t('portal.nav.invoices'),
      icon: 'invoices',
      exact: false,
    },
    {
      href: `${prefix}/portal/tickets`,
      label: t('portal.nav.claims'),
      icon: 'tickets',
      exact: false,
    },
  ];

  return (
    <nav className="px-2 sm:px-4">
      <div className="mx-auto flex max-w-4xl items-center gap-1">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex flex-1 items-center justify-center gap-1.5 px-2 py-3 text-sm font-medium transition-colors',
                active
                  ? 'text-brand-600'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]',
              )}
            >
              <Icon name={item.icon} className="h-4 w-4 shrink-0" strokeWidth={1.9} />
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
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <div className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <PortalHeader />
        {person && <PortalNav />}
      </div>
      <main className="flex-1 px-4 py-6 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">{children}</div>
      </main>
    </div>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <PortalAuthProvider>
      <QueryClientProvider client={queryClient}>
        <PortalChrome>{children}</PortalChrome>
      </QueryClientProvider>
    </PortalAuthProvider>
  );
}
