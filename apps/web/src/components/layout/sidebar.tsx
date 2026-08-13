'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { navItems } from './nav-items';
import {
  RAIL_ASIDE_CLASS,
  RAIL_NAV_CLASS,
  RailBrand,
  SIDEBAR_ASIDE_CLASS,
  SIDEBAR_FOOTER_BUTTON_CLASS,
  SIDEBAR_FOOTER_CLASS,
  SIDEBAR_NAV_CLASS,
  SidebarActiveBar,
  SidebarBrand,
  SidebarItemIcon,
  SidebarSectionLabel,
  railItemClass,
  sidebarItemClass,
} from './sidebar-chrome';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface IconRailProps {
  isActive: (href: string) => boolean;
  localePrefix: string;
  t: (key: string) => string;
}

function IconRail({ isActive, localePrefix, t }: IconRailProps) {
  return (
    <aside aria-label="Navigation rail" className={RAIL_ASIDE_CLASS}>
      <RailBrand />
      <nav className={RAIL_NAV_CLASS} aria-label="Main navigation">
        {navItems.map((item) => {
          const label = t(item.key);
          return (
            <div key={item.key} className="relative group">
              <Link
                href={`${localePrefix}${item.href}`}
                aria-label={label}
                title={label}
                className={railItemClass(isActive(item.href))}
              >
                <Icon name={item.icon} size={20} />
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
        })}
      </nav>
    </aside>
  );
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();

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
        className={`${SIDEBAR_ASIDE_CLASS} transition-[width] duration-300 [transition-timing-function:var(--ease-luxe)] ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        <SidebarBrand collapsed={collapsed} />

        <nav className={SIDEBAR_NAV_CLASS}>
          {!collapsed && <SidebarSectionLabel />}
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.key}
                href={`${localePrefix}${item.href}`}
                aria-label={collapsed ? t(item.key) : undefined}
                className={sidebarItemClass(active, collapsed)}
                title={collapsed ? t(item.key) : undefined}
              >
                {active && <SidebarActiveBar />}
                <SidebarItemIcon name={item.icon} active={active} />
                {!collapsed && <span className="flex-1">{t(item.key)}</span>}
              </Link>
            );
          })}
        </nav>

        <div className={SIDEBAR_FOOTER_CLASS}>
          <button
            onClick={onToggle}
            className={SIDEBAR_FOOTER_BUTTON_CLASS}
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
