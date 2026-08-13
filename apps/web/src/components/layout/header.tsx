'use client';

import { useTranslations, useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useState, useRef, useEffect } from 'react';
import { Icon } from '@/components/ui/icon';
import Link from 'next/link';
import { SEGMENT_LABELS } from './segment-labels';

interface HeaderProps {
  onMenuToggle: () => void;
}

/** Convert a URL segment to TitleCase as a fallback label. */
function toTitleCase(segment: string): string {
  return segment
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Strip leading locale prefix and split into non-empty segments. */
function parseSegments(pathname: string, locales: string[]): string[] {
  let path = pathname;
  for (const locale of locales) {
    if (path.startsWith(`/${locale}/`) || path === `/${locale}`) {
      path = path.slice(locale.length + 1) || '/';
      break;
    }
  }
  return path.split('/').filter(Boolean);
}

const LOCALES = ['es', 'en'];

export function Header({ onMenuToggle }: HeaderProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const initials = user
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : '??';

  // Breadcrumb logic — drop record-id segments so detail pages never show a
  // raw UUID (e.g. /contracts/<uuid> shows just "Contratos").
  const isIdSegment = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(s) || /^\d+$/.test(s);
  const segments = parseSegments(pathname, LOCALES).filter(
    (s) => !isIdSegment(s),
  );
  const localePrefix = (() => {
    for (const l of LOCALES) {
      if (pathname.startsWith(`/${l}/`) || pathname === `/${l}`) {
        return `/${l}`;
      }
    }
    return '';
  })();

  // es-AR falls back to 'es' label map
  const labelMap = SEGMENT_LABELS[locale] ?? SEGMENT_LABELS['es'];

  const crumbs = segments.map((seg, i) => {
    const href = `${localePrefix}/${segments.slice(0, i + 1).join('/')}`;
    const label = labelMap[seg] ?? toTitleCase(seg);
    return { seg, href, label };
  });

  const lastCrumb = crumbs[crumbs.length - 1];
  const parentHref =
    crumbs.length > 1
      ? crumbs[crumbs.length - 2].href
      : `${localePrefix}/dashboard`;

  return (
    <header className="h-16 sticky top-0 z-30 bg-[color-mix(in_srgb,var(--color-surface)_85%,transparent)] backdrop-blur-[8px] border-b border-[var(--color-border)] flex items-center justify-between px-4 lg:px-6 shrink-0">
      {/* Left: hamburger (mobile) + breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-[var(--color-bg)] transition-colors shrink-0"
          aria-label="Toggle menu"
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
                aria-label="Go back"
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
            aria-label="Breadcrumb"
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
          href={`${localePrefix}/notifications`}
          aria-label={t('nav.notifications')}
          title={t('nav.notifications')}
          className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-sunken)] transition-colors"
        >
          <Icon name="bell" size={19} />
        </Link>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-[var(--color-bg)] transition-colors"
            aria-expanded={dropdownOpen}
            aria-haspopup="true"
          >
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-semibold">
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
          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-[var(--color-surface)] rounded-xl shadow-lg border border-[var(--color-border)] py-1 z-50 animate-slide-down">
              <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
                <p className="text-sm font-medium text-[var(--color-text)] truncate">
                  {user ? `${user.firstName} ${user.lastName}` : ''}
                </p>
                <p className="text-xs text-[var(--color-muted)] truncate">
                  {user?.email || ''}
                </p>
              </div>
              <Link
                href={`${localePrefix}/perfil`}
                onClick={() => setDropdownOpen(false)}
                className="block px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-bg)] transition-colors"
              >
                {t('common.profile')}
              </Link>
              <Link
                href={`${localePrefix}/configuracion`}
                onClick={() => setDropdownOpen(false)}
                className="block px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-bg)] transition-colors"
              >
                {t('nav.settings')}
              </Link>
              <div className="border-t border-[var(--color-border)] mt-1">
                <button
                  onClick={logout}
                  className="w-full text-left px-4 py-2 text-sm text-[var(--color-danger)] hover:bg-red-50 transition-colors"
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
