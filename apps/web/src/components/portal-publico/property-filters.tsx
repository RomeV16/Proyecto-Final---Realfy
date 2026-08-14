'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PropertyType, PropertyOperationType } from '@realfy/shared';

/**
 * Filtros de la grilla pública. Al cambiar, actualizan la query string y
 * navegan a la misma ruta — la página (Server Component) vuelve a pedir la
 * lista con los nuevos parámetros, así que el fetch sigue corriendo en el
 * servidor y este componente solo maneja la interacción.
 */
export function PropertyFilters({
  initialOperation,
  initialType,
  initialCity,
}: {
  initialOperation: string;
  initialType: string;
  initialCity: string;
}) {
  const t = useTranslations('properties');
  const tFilters = useTranslations('portalPublico.filters');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function applyFilter(key: 'operation' | 'type' | 'city', value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete('page');
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  const hasFilters = Boolean(initialOperation || initialType || initialCity);

  return (
    <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="filter-operation" className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            {tFilters('operationLabel')}
          </label>
          <select
            id="filter-operation"
            value={initialOperation}
            onChange={(e) => applyFilter('operation', e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)]"
          >
            <option value="">{tFilters('operationPlaceholder')}</option>
            {Object.values(PropertyOperationType).map((op) => (
              <option key={op} value={op}>
                {t(`operationTypes.${op}`)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-type" className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            {tFilters('typeLabel')}
          </label>
          <select
            id="filter-type"
            value={initialType}
            onChange={(e) => applyFilter('type', e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)]"
          >
            <option value="">{tFilters('typePlaceholder')}</option>
            {Object.values(PropertyType).map((pt) => (
              <option key={pt} value={pt}>
                {t(`types.${pt}`)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filter-city" className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            {tFilters('cityLabel')}
          </label>
          <input
            id="filter-city"
            type="text"
            defaultValue={initialCity}
            placeholder={tFilters('cityPlaceholder')}
            onBlur={(e) => applyFilter('city', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilter('city', e.currentTarget.value);
            }}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)]"
          />
        </div>

        <div className="flex items-end">
          {hasFilters && (
            <button
              type="button"
              onClick={() => router.push(pathname)}
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]"
            >
              {tFilters('clear')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
