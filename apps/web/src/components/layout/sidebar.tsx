'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

interface NavItem {
  key: string;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', href: '/dashboard' },
  { key: 'properties', href: '/properties' },
  { key: 'persons', href: '/persons' },
  { key: 'contracts', href: '/contracts' },
  { key: 'liquidaciones', href: '/liquidaciones' },
  { key: 'invoices', href: '/invoices' },
  { key: 'leads', href: '/leads' },
  { key: 'reports', href: '/reports' },
  { key: 'settings', href: '/settings' },
];

/**
 * Determina el prefijo de locale (`/es`, `/en`, `/es-AR`...) a partir del pathname.
 */
function getLocalePrefix(pathname: string): string {
  return pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
}

export function Sidebar() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const localePrefix = getLocalePrefix(pathname);

  return (
    <aside className="w-60 shrink-0 border-r border-slate-200 bg-white">
      <div className="flex h-14 items-center px-6 text-lg font-bold text-slate-900">
        Realfy
      </div>
      <nav className="flex flex-col gap-1 px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const href = `${localePrefix}${item.href}`;
          const isActive = pathname.startsWith(href);
          return (
            <Link
              key={item.key}
              href={href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {t(item.key)}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
