'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { Icon } from '@/components/ui/icon';
import { BillReviewNavBadge } from './bill-review-nav-badge';
import { InboxNavBadge } from './inbox-nav-badge';
import { useNavCollapse } from './nav-collapse';
import { isNavItemActive, useVisibleNavSections, type NavSection } from './nav-items';
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
  SidebarSectionDivider,
  SidebarSectionHeader,
  railItemClass,
  sidebarItemClass,
} from './sidebar-chrome';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface IconRailProps {
  sections: NavSection[];
  isActive: (href: string) => boolean;
  t: (key: string) => string;
}

function IconRail({ sections, isActive, t }: IconRailProps) {
  return (
    <aside className={RAIL_ASIDE_CLASS}>
      <RailBrand />
      <nav className={RAIL_NAV_CLASS} aria-label={t('aria.main')}>
        {sections.map((section, index) => (
          <div key={section.key} className="space-y-1">
            {index > 0 && <SidebarSectionDivider />}
            {section.items.map((item) => {
              const label = t(item.key);
              const active = isActive(item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-label={label}
                  title={label}
                  aria-current={active ? 'page' : undefined}
                  className={railItemClass(active)}
                >
                  <Icon name={item.icon} size={20} />
                  {item.badge === 'inbox' && <InboxNavBadge floating />}
                  {item.badge === 'billReview' && <BillReviewNavBadge floating />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const t = useTranslations('nav');
  const label = t as unknown as (key: string) => string;
  const pathname = usePathname();
  const sections = useVisibleNavSections();
  const { isCollapsed, toggle } = useNavCollapse();
  const items = sections.flatMap((section) => section.items);

  const isActive = (href: string) => {
    return isNavItemActive(pathname, href, items);
  };

  // Al entrar directo a una pantalla del final del menú, su ítem queda a la vista.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector('[aria-current="page"]');
    if (!nav || !current) return;
    const frame = nav.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.top < frame.top || item.bottom > frame.bottom) {
      nav.scrollTop += item.top - frame.top - (frame.height - item.height) / 2;
    }
  }, [pathname, sections.length]);

  const toggleLabel = collapsed ? t('aria.expandSidebar') : t('aria.collapseSidebar');

  return (
    <>
      <IconRail sections={sections} isActive={isActive} t={label} />

      <aside
        className={`${SIDEBAR_ASIDE_CLASS} transition-[width] duration-300 [transition-timing-function:var(--ease-luxe)] ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        <SidebarBrand collapsed={collapsed} />

        <nav ref={navRef} className={SIDEBAR_NAV_CLASS} aria-label={t('aria.main')}>
          {sections.map((section, index) => {
            // La primera sección (inicio) no lleva título ni se pliega.
            const foldable = index > 0 && !collapsed;
            const folded = foldable && isCollapsed(section.key);
            const listId = `nav-section-${section.key}`;
            // Plegada, la sección sigue mostrando el ítem de la pantalla actual.
            const shown = folded ? section.items.filter((item) => isActive(item.href)) : section.items;
            return (
              <div key={section.key}>
                {index > 0 && collapsed && <SidebarSectionDivider />}
                {foldable && (
                  <SidebarSectionHeader
                    label={label(`sections.${section.key}`)}
                    collapsed={folded}
                    controls={listId}
                    onToggle={() => toggle(section.key)}
                  />
                )}
                <div id={listId} className="space-y-0.5">
                  {shown.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        aria-label={collapsed ? label(item.key) : undefined}
                        aria-current={active ? 'page' : undefined}
                        className={sidebarItemClass(active, collapsed)}
                        title={collapsed ? label(item.key) : undefined}
                      >
                        {active && <SidebarActiveBar />}
                        <SidebarItemIcon name={item.icon} active={active} />
                        {!collapsed && <span className="flex-1">{label(item.key)}</span>}
                        {item.badge === 'inbox' && <InboxNavBadge floating={collapsed} />}
                        {item.badge === 'billReview' && <BillReviewNavBadge floating={collapsed} />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className={SIDEBAR_FOOTER_CLASS}>
          <button
            type="button"
            onClick={onToggle}
            className={SIDEBAR_FOOTER_BUTTON_CLASS}
            aria-label={toggleLabel}
            title={toggleLabel}
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
