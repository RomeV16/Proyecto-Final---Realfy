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
  { key: 'notifications', href: '/notifications', icon: 'bell' },
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
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-white/[0.08]">
        <div className="w-8 h-8 rounded-md bg-brand-500 flex items-center justify-center text-white font-display italic text-base shrink-0">
          R
        </div>
        {!collapsed && (
          <span className="font-display italic text-[1.3rem] leading-none text-[#f0e6d4] tracking-tight">
            Realfy
          </span>
        )}
      </div>

      <nav className="flex-1 py-5 px-3 space-y-0.5 overflow-y-auto">
        {!collapsed && (
          <p className="px-3 pb-2.5 text-[0.62rem] uppercase tracking-[0.18em] text-white/30 font-medium">
            Gestión
          </p>
        )}
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.key}
              href={`${localePrefix}${item.href}`}
              aria-label={collapsed ? t(item.key) : undefined}
              className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-300 [transition-timing-function:var(--ease-luxe)] ${
                active
                  ? 'bg-white/[0.07] text-white font-medium'
                  : 'text-sidebar-text hover:bg-white/[0.04] hover:text-white'
              } ${collapsed ? 'justify-center' : ''}`}
              title={collapsed ? t(item.key) : undefined}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-brand-500" />
              )}
              <span
                className={`relative transition-colors duration-300 ${
                  active ? 'text-brand-400' : 'text-current group-hover:text-brand-300'
                }`}
              >
                <Icon name={item.icon} size={19} />
              </span>
              {!collapsed && <span className="flex-1">{t(item.key)}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-white/[0.08]">
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
