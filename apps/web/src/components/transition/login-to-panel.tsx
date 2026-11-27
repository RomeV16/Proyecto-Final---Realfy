'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DashboardSkeleton } from '@/components/dashboard/dashboard-skeleton';
import { useNavCollapse } from '@/components/layout/nav-collapse';
import { stripLocale } from '@/components/layout/nav-progress';
import { useVisibleNavSections } from '@/components/layout/nav-items';
import { SEGMENT_LABELS } from '@/components/layout/segment-labels';
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
} from '@/components/layout/sidebar-chrome';
import { Icon } from '@/components/ui/icon';
import { transition, useTransitionState } from '@/lib/transition-store';

const EASE = [0.22, 1, 0.36, 1] as const;

/** Shortest time the cover holds before revealing the app underneath. */
export const HOLD_MS = 2100;
export const HOLD_MS_REDUCED = 450;
/** Once the panel route is on screen, a beat for it to paint before the cover lifts. */
export const SETTLE_MS = 200;
/** The cover never stays longer than this, whatever happens to the navigation. */
export const MAX_WAIT_MS = 10000;

/** True once the browser is on a panel screen (not the login nor the bare locale root). */
export function isPanelPath(pathname: string | null): boolean {
  const path = stripLocale(pathname ?? '/');
  return path !== '/' && path !== '' && !path.startsWith('/auth');
}

/** The cover fades in over the login form instead of cutting to an empty screen. */
const COVER_IN_S = 0.2;

/** The panel opens on the dashboard, so that is the row the cover marks active. */
const ACTIVE_KEY = 'dashboard';

type Offset = { x?: number; y?: number };

/**
 * Cinematic login → panel transition. Mounted once per locale layout but backed
 * by a module store, so it survives the auth → app route change.
 *
 * The cover is a replica of the app shell, not a stylised stand-in: it reuses
 * the sidebar chrome, the nav registry and the dashboard skeleton that the real
 * screen renders. Same rows, same icons, same paddings, same greeting — so when
 * the cover fades the navigation underneath is already exactly where the eye
 * left it and nothing appears to reload.
 */
export function LoginToPanel() {
  const { active, data, runId } = useTransitionState();
  const reduceMotion = useReducedMotion();
  const t = useTranslations('nav') as unknown as (key: string) => string;
  const sections = useVisibleNavSections(data.role);
  const { isCollapsed } = useNavCollapse();
  const locale = useLocale();
  const arrived = isPanelPath(usePathname());
  const [held, setHeld] = useState(false);

  // The cover holds for a minimum time and, past that, until the panel route is actually on
  // screen: lifting it on a timer alone showed an empty page when the panel was slow to load.
  useEffect(() => {
    if (!active) return;
    setHeld(false);
    const hold = setTimeout(() => setHeld(true), reduceMotion ? HOLD_MS_REDUCED : HOLD_MS);
    const giveUp = setTimeout(() => transition.end(), MAX_WAIT_MS);
    return () => {
      clearTimeout(hold);
      clearTimeout(giveUp);
    };
  }, [active, runId, reduceMotion]);

  useEffect(() => {
    if (!active || !held || !arrived) return;
    const timer = setTimeout(() => transition.end(), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [active, held, arrived]);

  const firstName = data.firstName || '';
  const lastName = data.lastName || '';
  const initials =
    `${firstName[0] || ''}${lastName[0] || ''}`.toUpperCase();
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  const dashboardLabel =
    (SEGMENT_LABELS[locale] ?? SEGMENT_LABELS['es'])[ACTIVE_KEY] ?? 'Panel';

  /**
   * Entrance props for one piece of the assembly. Under reduced motion every
   * piece resolves to a single short opacity step with no offset and no stagger.
   */
  const enter = (delay: number, duration: number, offset: Offset = {}) =>
    reduceMotion
      ? {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.2 },
        }
      : {
          initial: { opacity: 0, ...offset },
          animate: { opacity: 1, x: 0, y: 0 },
          transition: { duration, delay, ease: EASE },
        };

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={`ltp-${runId}`}
          className="fixed inset-0 z-[200] flex overflow-hidden bg-[var(--color-bg)]"
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { duration: reduceMotion ? 0 : COVER_IN_S, ease: 'easeOut' },
          }}
          exit={{
            opacity: 0,
            transition: { duration: reduceMotion ? 0.2 : 0.6, ease: EASE },
          }}
        >
          {/* Icon rail (md → lg) — the app shows one at this width, so the
              cover must too or the whole page shifts 4rem on hand-off. */}
          <motion.aside
            className={RAIL_ASIDE_CLASS}
            {...enter(0.15, 0.7, { x: -48 })}
          >
            <RailBrand />
            <div className={RAIL_NAV_CLASS}>
              {sections.map((section, s) => (
                <div key={section.key} className="space-y-1">
                  {s > 0 && <SidebarSectionDivider />}
                  {section.items.map((item) => (
                    <motion.div
                      key={item.key}
                      className={railItemClass(item.key === ACTIVE_KEY)}
                      {...enter(0.5 + s * 0.06, 0.4, { x: -8 })}
                    >
                      <Icon name={item.icon} size={20} />
                    </motion.div>
                  ))}
                </div>
              ))}
            </div>
          </motion.aside>

          {/* Expanded sidebar (lg and up) */}
          <motion.aside
            className={`${SIDEBAR_ASIDE_CLASS} w-64`}
            {...enter(0.15, 0.7, { x: -60 })}
          >
            <SidebarBrand />

            <div className={SIDEBAR_NAV_CLASS}>
              {sections.map((section, s) => {
                const folded = s > 0 && isCollapsed(section.key);
                return (
                  <motion.div key={section.key} {...enter(0.5 + s * 0.07, 0.45, { x: -12 })}>
                    {s > 0 && (
                      <SidebarSectionHeader label={t(`sections.${section.key}`)} collapsed={folded} />
                    )}
                    <div className="space-y-0.5">
                      {(folded ? [] : section.items).map((item) => {
                        const isActive = item.key === ACTIVE_KEY;
                        return (
                          <div key={item.key} className={sidebarItemClass(isActive)}>
                            {isActive && <SidebarActiveBar />}
                            <SidebarItemIcon name={item.icon} active={isActive} />
                            <span className="flex-1">{t(item.key)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <div className={SIDEBAR_FOOTER_CLASS}>
              <div className={SIDEBAR_FOOTER_BUTTON_CLASS}>
                <Icon name="collapse" size={20} />
              </div>
            </div>
          </motion.aside>

          {/* Main column — same header bar and same page padding as the shell */}
          <div className="flex-1 flex flex-col min-w-0">
            <motion.div
              className="h-16 bg-[color-mix(in_srgb,var(--color-surface)_85%,transparent)] backdrop-blur-[8px] border-b border-[var(--color-border)] flex items-center justify-between px-4 lg:px-6 shrink-0"
              {...enter(0.55, 0.6, { y: -22 })}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="lg:hidden p-2 -ml-2 rounded-lg shrink-0">
                  <Icon
                    name="menu"
                    size={20}
                    className="text-[var(--color-muted)]"
                  />
                </span>
                <span className="text-sm font-semibold text-[var(--color-text)] truncate max-w-[180px]">
                  {dashboardLabel}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--color-muted)]">
                  <Icon name="bell" size={19} />
                </span>
                <span className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                  <span className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-semibold">
                    {initials}
                  </span>
                  <span className="hidden sm:block text-sm font-medium text-[var(--color-text)] max-w-[120px] truncate">
                    {fullName}
                  </span>
                  <Icon
                    name="chevronDown"
                    size={16}
                    strokeWidth={2}
                    className="text-[var(--color-muted)]"
                  />
                </span>
              </div>
            </motion.div>

            <div className="flex-1 p-4 lg:p-6 overflow-y-auto">
              <motion.div {...enter(0.78, 0.75, { y: 24 })}>
                <DashboardSkeleton firstName={firstName} />
              </motion.div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
