'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Icon, type IconName } from '@/components/ui/icon';

interface NavItem {
  key: string;
  href: string;
  icon: IconName;
}

const navItems: NavItem[] = [
  { key: 'dashboard', href: '/dashboard', icon: 'dashboard' },
  { key: 'properties', href: '/properties', icon: 'properties' },
  { key: 'persons', href: '/persons', icon: 'persons' },
  { key: 'contracts', href: '/contracts', icon: 'contracts' },
  { key: 'liquidaciones', href: '/liquidaciones', icon: 'liquidaciones' },
  { key: 'pagos', href: '/pagos', icon: 'liquidaciones' },
  { key: 'delinquency', href: '/delinquency', icon: 'delinquency' },
  { key: 'tickets', href: '/tickets', icon: 'tickets' },
  { key: 'providers', href: '/providers', icon: 'providers' },
  { key: 'notifications', href: '/notifications', icon: 'bell' },
];

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNav({ open, onClose }: MobileNavProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const isActive = (href: string) => {
    const fullPath = `${localePrefix}${href}`;
    return pathname === fullPath || pathname.startsWith(`${fullPath}/`);
  };

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/50 z-40 lg:hidden transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[calc(100vw-3rem)] bg-sidebar-bg transform transition-transform duration-300 ease-in-out lg:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <div className="flex items-center justify-between px-4 h-16 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-white font-bold text-sm">
              {user?.firstName?.[0]?.toUpperCase() || 'R'}
            </div>
            <span className="font-semibold text-white text-sm tracking-tight">
              Realfy
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-sidebar-text hover:bg-sidebar-hover transition-colors"
            aria-label="Close menu"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.key}
                href={`${localePrefix}${item.href}`}
                onClick={onClose}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${
                  active
                    ? 'bg-brand-500/15 text-brand-400 font-medium'
                    : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
                }`}
              >
                <span className={active ? 'text-brand-400' : ''}>
                  <Icon name={item.icon} size={20} />
                </span>
                <span className="flex-1">{t(item.key)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-white/10">
          {user && (
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-semibold">
                {user.firstName[0]}
                {user.lastName[0]}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-xs text-sidebar-text truncate">
                  {user.email}
                </p>
              </div>
            </div>
          )}
          <button
            onClick={() => {
              onClose();
              logout();
            }}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Icon name="logout" size={20} />
            <span>{t('logout')}</span>
          </button>
        </div>
      </div>
    </>
  );
}
