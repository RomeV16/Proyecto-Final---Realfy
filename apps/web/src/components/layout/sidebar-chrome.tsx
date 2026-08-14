import { Icon, type IconName } from '@/components/ui/icon';

/**
 * Geometry and skin of the navigation column, extracted so that the real
 * sidebar and the login → panel transition render byte-identical chrome.
 *
 * The transition paints a sidebar on top of the app while it boots; if that
 * copy differs by a single border, section label or icon, the hand-off reads
 * as the navigation reloading. Everything visually load-bearing therefore
 * lives here and is consumed by both.
 */

/* ── Expanded sidebar (lg and up) ── */

/* La columna se ancla a la altura de la ventana y scrollea por dentro: con
   `min-h-screen` crecia con el contenido de la pagina y tanto la navegacion
   como el boton de colapsar se iban con el scroll. */
export const SIDEBAR_ASIDE_CLASS =
  'hidden lg:flex flex-col bg-sidebar-bg text-sidebar-text sticky top-0 h-screen shrink-0';

export const SIDEBAR_BRAND_CLASS =
  'flex items-center gap-2.5 px-5 h-16 border-b border-white/[0.08] shrink-0';

export const SIDEBAR_NAV_CLASS =
  'flex-1 py-5 px-3 space-y-0.5 overflow-y-auto';

export const SIDEBAR_FOOTER_CLASS = 'px-3 py-4 border-t border-white/[0.08]';

export const SIDEBAR_FOOTER_BUTTON_CLASS =
  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full hover:bg-sidebar-hover transition-colors duration-150';

/** Row skin for one nav entry. Identical for links and for static replicas. */
export function sidebarItemClass(active: boolean, collapsed = false): string {
  return [
    'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm',
    'transition-colors duration-300 [transition-timing-function:var(--ease-luxe)]',
    active
      ? 'bg-white/[0.07] text-white font-medium'
      : 'text-sidebar-text hover:bg-white/[0.04] hover:text-white',
    collapsed ? 'justify-center' : '',
  ].join(' ');
}

export function SidebarBrand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className={SIDEBAR_BRAND_CLASS}>
      <div className="w-8 h-8 rounded-md bg-brand-500 flex items-center justify-center text-white font-display italic text-base shrink-0">
        R
      </div>
      {!collapsed && (
        <span className="font-display italic text-[1.3rem] leading-none text-[#f0e6d4] tracking-tight">
          Realfy
        </span>
      )}
    </div>
  );
}

/** Section heading above the nav list — occupies real vertical space, so the
 *  transition has to render it too or every row below shifts on hand-off. */
export function SidebarSectionLabel() {
  return (
    <p className="px-3 pb-2.5 text-[0.62rem] uppercase tracking-[0.18em] text-white/30 font-medium">
      Gestión
    </p>
  );
}

/** Brand marker on the active row. */
export function SidebarActiveBar() {
  return (
    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-brand-500" />
  );
}

export function SidebarItemIcon({
  name,
  active,
}: {
  name: IconName;
  active: boolean;
}) {
  return (
    <span
      className={`relative transition-colors duration-300 ${
        active ? 'text-brand-400' : 'text-current group-hover:text-brand-300'
      }`}
    >
      <Icon name={name} size={19} />
    </span>
  );
}

/* ── Icon rail (md → lg) ── */

export const RAIL_ASIDE_CLASS =
  'hidden md:flex lg:hidden flex-col items-center bg-sidebar-bg text-sidebar-text w-16 sticky top-0 h-screen shrink-0';

export const RAIL_NAV_CLASS = 'flex-1 py-4 w-full space-y-1 overflow-y-auto';

export function railItemClass(active: boolean): string {
  return [
    'relative flex items-center justify-center w-10 h-10 mx-auto rounded-lg transition-colors duration-150',
    active
      ? 'bg-brand-500/15 text-brand-400'
      : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white',
  ].join(' ');
}

export function RailBrand() {
  return (
    <div className="flex items-center justify-center h-16 w-full border-b border-white/10 shrink-0">
      <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-white font-bold text-sm">
        R
      </div>
    </div>
  );
}
