'use client';

import { useTranslations } from 'next-intl';
import { PersonRole } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { PersonRoleBadge } from './person-role-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { inputStyles } from '@/components/ui/input';
import { ExportButtons } from '../import/export-buttons';
import { useCan } from '@/lib/permissions';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { ErrorNotice } from '@/components/ui/error-notice';
import { PaginationBar } from '@/components/ui/pagination';
import { cn } from '@/lib/cn';

/* ──────────── Types ──────────── */

interface PersonRoleAssignment {
  id: string;
  role: string;
}

interface PersonItem {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  cuit?: string | null;
  dni?: string | null;
  roles: PersonRoleAssignment[];
  isActive: boolean;
  createdAt: string;
}

/* ──────────── Filters ──────────── */

const INITIAL_FILTERS = { search: '', role: '' };

const LIMIT = 20;

const GRID = 'sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_1rem]';

const CONTACT_LINK =
  'relative z-[1] inline-flex max-w-full items-center gap-1.5 rounded text-[var(--color-text)] underline-offset-2 hover:text-[var(--color-brand-600)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';

/* ──────────── Row ──────────── */

function PersonRow({ person }: { person: PersonItem }) {
  const t = useTranslations('persons');
  const fullName = `${person.firstName} ${person.lastName}`.trim();
  const document = person.cuit
    ? t('directory.cuit', { value: person.cuit })
    : person.dni
      ? t('directory.dni', { value: person.dni })
      : null;
  // Los roles repetidos (propietario de dos inmuebles) se muestran una sola vez.
  const roles = [...new Set(person.roles.map((r) => r.role))];

  return (
    <li
      className={cn(
        'group relative grid grid-cols-1 items-center gap-x-5 gap-y-2 px-4 py-3.5 transition-colors sm:px-5',
        'hover:bg-[var(--color-surface-sunken)]',
        GRID,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={fullName} seed={person.id} size="md" />
        <div className="min-w-0">
          <Link
            href={`/persons/${person.id}`}
            className="block truncate text-sm font-semibold text-[var(--color-text)] after:absolute after:inset-0 group-hover:text-[var(--color-brand-600)] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand-500"
          >
            {fullName}
          </Link>
          {document && <p className="truncate text-xs tabular-nums text-[var(--color-muted)]">{document}</p>}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5 pl-[3.25rem] sm:pl-0">
        {roles.length > 0 ? (
          roles.map((role) => <PersonRoleBadge key={role} role={role} />)
        ) : (
          <span className="text-xs text-[var(--color-muted)]">{t('roles.noRoles')}</span>
        )}
      </div>

      <div className="flex min-w-0 flex-col items-start gap-0.5 pl-[3.25rem] text-xs sm:pl-0">
        {person.email && (
          <a href={`mailto:${person.email}`} className={CONTACT_LINK} title={t('directory.sendEmail')}>
            <Icon name="mail" className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" strokeWidth={1.75} />
            <span className="truncate">{person.email}</span>
          </a>
        )}
        {person.phone && (
          <a href={`tel:${person.phone.replace(/[^\d+]/g, '')}`} className={CONTACT_LINK} title={t('directory.call')}>
            <Icon name="phone" className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" strokeWidth={1.75} />
            <span className="truncate tabular-nums">{person.phone}</span>
          </a>
        )}
        {!person.email && !person.phone && (
          <span className="text-[var(--color-muted)]">{t('directory.noContact')}</span>
        )}
      </div>

      <Icon
        name="chevronRight"
        className="hidden h-4 w-4 text-[var(--color-muted)] transition-transform group-hover:translate-x-0.5 sm:block"
        strokeWidth={1.75}
      />
    </li>
  );
}

function DirectorySkeleton() {
  return (
    <ul aria-hidden="true" className="divide-y divide-[var(--color-border)]">
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className={cn('grid grid-cols-1 items-center gap-x-5 gap-y-2 px-4 py-3.5 sm:px-5', GRID)}>
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="hidden h-5 w-24 rounded-full sm:block" />
          <Skeleton className="hidden h-4 w-2/3 sm:block" />
          <span className="hidden sm:block" />
        </li>
      ))}
    </ul>
  );
}

/* ──────────── Main Component ──────────── */

export function PersonList() {
  const t = useTranslations('persons');
  const tFilters = useTranslations('persons.filters');
  const tCommon = useTranslations('common');

  const list = usePaginatedList<PersonItem, typeof INITIAL_FILTERS>({
    key: 'persons',
    path: '/persons',
    limit: LIMIT,
    initialFilters: INITIAL_FILTERS,
  });
  const { filters, hasFilters, items } = list;

  const canCreate = useCan('persons.manage');
  const surface =
    'overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">{t('title')}</h1>
          <p className="mt-0.5 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButtons entityPath="persons" />
          {canCreate && (
            <Link
              href={'/persons/new'}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600 active:bg-brand-700 sm:w-auto"
            >
              <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
              {t('newPerson')}
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Icon
            name="search"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]"
            strokeWidth={1.75}
          />
          <input
            id="filter-search"
            type="search"
            aria-label={tFilters('search')}
            value={filters.search}
            onChange={(e) => list.setFilter('search', e.target.value)}
            placeholder={tFilters('searchPlaceholder')}
            className={inputStyles({ className: 'pl-10' })}
          />
        </div>
        <div
          role="group"
          aria-label={tFilters('role')}
          className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1"
        >
          {['', ...Object.values(PersonRole)].map((role) => {
            const active = filters.role === role;
            return (
              <button
                key={role || 'all'}
                type="button"
                aria-pressed={active}
                onClick={() => list.setFilter('role', role)}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
                  active
                    ? 'border-[var(--color-text)] bg-[var(--color-text)] text-[var(--color-surface)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-text)]',
                )}
              >
                {role ? t(`directory.rolePlural.${role}`) : tFilters('allRoles')}
              </button>
            );
          })}
          {hasFilters && (
            <button
              type="button"
              onClick={list.reset}
              title={tFilters('clear')}
              className="ml-1 shrink-0 rounded-lg px-2 py-1.5 text-xs text-[var(--color-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline"
            >
              {t('directory.clear')}
            </button>
          )}
        </div>
      </div>

      {list.error != null && <ErrorNotice error={list.error} />}

      {list.error == null && list.isLoading && (
        <div role="status" aria-label={tCommon('loading')} className={surface}>
          <DirectorySkeleton />
        </div>
      )}

      {list.error == null &&
        !list.isLoading &&
        items.length === 0 &&
        (hasFilters ? (
          <EmptyState
            variant="filtered"
            iconName="search"
            title={tCommon('noResults')}
            subtitle={t('empty.filtered')}
            action={
              <button
                type="button"
                onClick={list.reset}
                className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg)]"
              >
                {tFilters('clear')}
              </button>
            }
          />
        ) : (
          <EmptyState
            iconName="persons"
            title={t('empty.title')}
            subtitle={t('empty.description')}
            steps={[t('empty.step1'), t('empty.step2'), t('empty.step3')]}
            action={
              canCreate && (
                <Link
                  href={'/persons/new'}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-brand-500)] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--color-brand-600)]"
                >
                  <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
                  {t('newPerson')}
                </Link>
              )
            }
          />
        ))}

      {list.error == null && !list.isLoading && items.length > 0 && (
        <section aria-label={t('title')} className={surface}>
          <div
            aria-hidden="true"
            className={cn(
              'hidden items-center gap-x-5 border-b border-[var(--color-border)] px-5 py-2.5 sm:grid',
              'text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]',
              GRID,
            )}
          >
            <span>{t('directory.columns.person')}</span>
            <span>{t('directory.columns.roles')}</span>
            <span>{t('directory.columns.contact')}</span>
            <span />
          </div>
          <ul
            className={cn(
              'divide-y divide-[var(--color-border)]',
              list.isFetching && 'pointer-events-none opacity-60 transition-opacity duration-200',
            )}
          >
            {items.map((person) => (
              <PersonRow key={person.id} person={person} />
            ))}
          </ul>
          <p className="border-t border-[var(--color-border)] px-5 py-2.5 text-xs text-[var(--color-muted)]">
            {t('directory.count', { count: list.total })}
          </p>
        </section>
      )}

      {/* Pagination */}
      {!list.isLoading && (
        <PaginationBar
          page={list.page}
          totalPages={list.totalPages}
          total={list.total}
          limit={LIMIT}
          onPageChange={list.setPage}
        />
      )}
    </div>
  );
}
