'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth-context';
import { useState, useRef, useEffect } from 'react';
import { Icon } from '@/components/ui/icon';
import { useDocumentTitle } from '@/lib/use-document-title';
import { SEGMENT_LABELS } from './segment-labels';

interface HeaderProps {
  onMenuToggle: () => void;
}

/** Lo que dura el desvanecido del menú de usuario al cerrarse. */
const MENU_OUT_MS = 120;

/** Convert a URL segment to TitleCase as a fallback label. */
function toTitleCase(segment: string): string {
  return segment
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Split a locale-less pathname into non-empty segments. */
function parseSegments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

export function Header({ onMenuToggle }: HeaderProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // El menú sigue montado un instante después de cerrarse, para que se desvanezca en vez de cortarse.
  const [menuMounted, setMenuMounted] = useState(false);
  useEffect(() => {
    if (dropdownOpen) {
      setMenuMounted(true);
      return;
    }
    const timer = setTimeout(() => setMenuMounted(false), MENU_OUT_MS);
    return () => clearTimeout(timer);
  }, [dropdownOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDropdownOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  /* Sin usuario todavia el avatar queda vacio: un '??' se lee como un dato
     roto durante el primer pintado. */
  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '';

  // es-AR falls back to 'es' label map
  const labelMap = SEGMENT_LABELS[locale] ?? SEGMENT_LABELS['es'];

  // Breadcrumb logic — drop record-id segments so detail pages never show a
  // raw id (e.g. /contracts/<uuid> shows just "Contratos"). Un segmento sin
  // etiqueta que trae dígitos es un identificador (uuid, cuid o número).
  const isIdSegment = (s: string) => !(s in labelMap) && /\d/.test(s);
  const allSegments = parseSegments(pathname);

  // Cada miga enlaza a su ruta real, con los identificadores intermedios.
  const crumbs = allSegments
    .map((seg, i) => ({
      seg,
      href: `/${allSegments.slice(0, i + 1).join('/')}`,
      label: labelMap[seg] ?? toTitleCase(seg),
    }))
    .filter((crumb) => !isIdSegment(crumb.seg));

  const lastCrumb = crumbs[crumbs.length - 1];
  useDocumentTitle(lastCrumb?.label);
  const parentHref =
    crumbs.length > 1
      ? crumbs[crumbs.length - 2].href
      : '/dashboard';

  return (
    <header className="h-16 sticky top-0 z-30 bg-[color-mix(in_srgb,var(--color-surface)_85%,transparent)] backdrop-blur-[8px] border-b border-[var(--color-border)] flex items-center justify-between px-4 lg:px-6 shrink-0">
      {/* Left: hamburger (mobile) + breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onMenuToggle}
          className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-[var(--color-bg)] transition-colors shrink-0"
          aria-label={t('nav.aria.openMenu')}
        >
          <Icon name="menu" size={20} className="text-[var(--color-muted)]" />
        </button>

        {/* Mobile breadcrumb: back arrow + last segment only */}
        {lastCrumb && (
          <div className="flex items-center gap-1 md:hidden min-w-0">
            {crumbs.length > 1 && (
              <button
                onClick={() => router.push(parentHref)}
                className="p-1 rounded-md hover:bg-[var(--color-bg)] transition-colors shrink-0"
                aria-label={t('nav.aria.back')}
              >
                <Icon name="arrowLeft" size={16} className="text-[var(--color-muted)]" />
              </button>
            )}
            <span className="text-sm font-semibold text-[var(--color-text)] truncate">
              {lastCrumb.label}
            </span>
          </div>
        )}

        {/* Desktop breadcrumb: full chain */}
        {crumbs.length > 0 && (
          <nav
            aria-label={t('nav.aria.breadcrumb')}
            className="hidden md:flex items-center gap-1 min-w-0"
          >
            {crumbs.map((crumb, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <span
                  key={crumb.href}
                  className="flex items-center gap-1 min-w-0"
                >
                  {i > 0 && (
                    <Icon
                      name="chevronRight"
                      size={14}
                      className="text-[var(--color-muted)] shrink-0"
                    />
                  )}
                  {isLast ? (
                    <span className="text-sm font-semibold text-[var(--color-text)] truncate max-w-[180px]">
                      {crumb.label}
                    </span>
                  ) : (
                    <Link
                      href={crumb.href}
                      className="text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors truncate max-w-[140px]"
                    >
                      {crumb.label}
                    </Link>
                  )}
                </span>
              );
            })}
          </nav>
        )}
      </div>

      {/* Right: notifications + user menu */}
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/notifications"
          aria-label={t('nav.notifications')}
          title={t('nav.notifications')}
          className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-sunken)] transition-colors"
        >
          <Icon name="bell" size={19} />
        </Link>

        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--color-bg)] transition-colors"
            aria-expanded={dropdownOpen}
            aria-haspopup="true"
            aria-label={user ? `${t('nav.aria.userMenu')}: ${user.firstName} ${user.lastName}` : t('nav.aria.userMenu')}
          >
            <div aria-hidden="true" className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-semibold">
              {initials}
            </div>
            <span className="hidden sm:block text-sm font-medium text-[var(--color-text)] max-w-[120px] truncate">
              {user ? `${user.firstName} ${user.lastName}` : ''}
            </span>
            <Icon
              name="chevronDown"
              size={16}
              strokeWidth={2}
              className={`text-[var(--color-muted)] transition-transform duration-200 ${
                dropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Dropdown */}
          {(dropdownOpen || menuMounted) && (
            <div
              aria-hidden={!dropdownOpen}
              className={`absolute right-0 mt-2 w-48 bg-[var(--color-surface)] rounded-xl shadow-lg border border-[var(--color-border)] py-1 z-50 ${
                dropdownOpen
                  ? 'animate-slide-down'
                  : 'pointer-events-none animate-[overlay-out_0.12s_ease-in_forwards]'
              }`}
            >
              <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
                <p className="text-sm font-medium text-[var(--color-text)] truncate">
                  {user ? `${user.firstName} ${user.lastName}` : ''}
                </p>
                <p className="text-xs text-[var(--color-muted)] truncate">
                  {user?.email || ''}
                </p>
              </div>
              <Link
                href="/perfil"
                onClick={() => setDropdownOpen(false)}
                className="block px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-bg)] transition-colors"
              >
                {t('common.profile')}
              </Link>
              <Link
                href="/configuracion"
                onClick={() => setDropdownOpen(false)}
                className="block px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-bg)] transition-colors"
              >
                {t('nav.settings')}
              </Link>
              <div className="border-t border-[var(--color-border)] mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setDropdownOpen(false);
                    void logout();
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] transition-colors"
                >
                  {t('nav.logout')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
