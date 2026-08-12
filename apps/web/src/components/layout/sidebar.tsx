'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
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
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface RailNavItemProps {
  href: string;
  icon: IconName;
  label: string;
  active: boolean;
}

function RailNavItem({ href, icon, label, active }: RailNavItemProps) {
  return (
    <div className="relative group">
      <Link
        href={href}
        aria-label={label}
        title={label}
        className={[
          'relative flex items-center justify-center w-10 h-10 mx-auto rounded-lg transition-colors duration-150',
          active
            ? 'bg-brand-500/15 text-brand-400'
            : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white',
        ].join(' ')}
      >
        <Icon name={icon} size={20} />
      </Link>
      <span
        aria-hidden="true"
        className={[
          'pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50',
          'whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium',
          'bg-sidebar-hover text-white shadow-lg',
          'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
        ].join(' ')}
      >
        {label}
      </span>
    </div>
  );
}

interface IconRailProps {
  isActive: (href: string) => boolean;
  localePrefix: string;
  t: (key: string) => string;
}

function IconRail({ isActive, localePrefix, t }: IconRailProps) {
  return (
    <aside
      aria-label="Navigation rail"
      className="hidden md:flex lg:hidden flex-col items-center bg-sidebar-bg text-sidebar-text w-16 min-h-screen shrink-0"
    >
      <div className="flex items-center justify-center h-16 w-full border-b border-white/10 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-white font-bold text-sm">
          R
        </div>
      </div>
      <nav className="flex-1 py-4 w-full space-y-1 overflow-y-auto" aria-label="Main navigation">
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <RailNavItem
              key={item.key}
              href={`${localePrefix}${item.href}`}
              icon={item.icon}
              label={t(item.key)}
              active={active}
            />
          );
        })}
      </nav>
    </aside>
  );
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const { user } = useAuth();

  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const isActive = (href: string) => {
    const fullPath = `${localePrefix}${href}`;
    return pathname === fullPath || pathname.startsWith(`${fullPath}/`);
  };

  return (
    <>
      <IconRail
        isActive={isActive}
        localePrefix={localePrefix}
        t={t as unknown as (key: string) => string}
      />

      <aside
        className={`hidden lg:flex flex-col bg-sidebar-bg text-sidebar-text transition-all duration-300 ease-in-out ${
          collapsed ? 'w-16' : 'w-64'
        } min-h-screen shrink-0`}
      >
      <div className="flex items-center gap-3 px-4 h-16 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
          {user?.firstName?.[0]?.toUpperCase() || 'R'}
        </div>
        {!collapsed && (
          <span className="font-semibold text-white truncate text-sm tracking-tight">
            Realfy
          </span>
        )}
      </div>

      <nav className="flex-1 py-4 px-2 space-y-1">
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.key}
              href={`${localePrefix}${item.href}`}
              aria-label={collapsed ? t(item.key) : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 ${
                active
                  ? 'bg-brand-500/15 text-brand-400 font-medium'
                  : 'hover:bg-sidebar-hover text-sidebar-text hover:text-white'
              } ${collapsed ? 'justify-center' : ''}`}
              title={collapsed ? t(item.key) : undefined}
            >
              <span className={`relative ${active ? 'text-brand-400' : ''}`}>
                <Icon name={item.icon} size={20} />
              </span>
              {!collapsed && <span className="flex-1">{t(item.key)}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="px-2 py-4 border-t border-white/10">
        <button
          onClick={onToggle}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full hover:bg-sidebar-hover transition-colors duration-150"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span
            className={`transition-transform duration-300 ${
              collapsed ? 'rotate-180' : ''
            }`}
          >
            <Icon name="collapse" size={20} />
          </span>
        </button>
      </div>
    </aside>
    </>
  );
}
