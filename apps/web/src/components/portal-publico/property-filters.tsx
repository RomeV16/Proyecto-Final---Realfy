'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PropertyType, PropertyOperationType } from '@realfy/shared';
import { inputStyles } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

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
  initialMinPrice = '',
  initialMaxPrice = '',
}: {
  initialOperation: string;
  initialType: string;
  initialCity: string;
  initialMinPrice?: string;
  initialMaxPrice?: string;
}) {
  const t = useTranslations('properties');
  const tFilters = useTranslations('portalPublico.filters');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function applyFilter(key: 'operation' | 'type' | 'city' | 'minPrice' | 'maxPrice', value: string) {
    if ((searchParams.get(key) ?? '') === value) return;
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete('page');
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  const hasFilters = Boolean(
    initialOperation || initialType || initialCity || initialMinPrice || initialMaxPrice,
  );

  return (
    <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div>
          <label htmlFor="filter-operation" className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            {tFilters('operationLabel')}
          </label>
          <Select
            id="filter-operation"
            value={initialOperation}
            onChange={(e) => applyFilter('operation', e.target.value)}
            
          >
            <option value="">{tFilters('operationPlaceholder')}</option>
            {Object.values(PropertyOperationType).map((op) => (
              <option key={op} value={op}>
                {t(`operationTypes.${op}`)}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="filter-type" className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            {tFilters('typeLabel')}
          </label>
          <Select
            id="filter-type"
            value={initialType}
            onChange={(e) => applyFilter('type', e.target.value)}
            
          >
            <option value="">{tFilters('typePlaceholder')}</option>
            {Object.values(PropertyType).map((pt) => (
              <option key={pt} value={pt}>
                {t(`types.${pt}`)}
              </option>
            ))}
          </Select>
        </div>

        <div className="col-span-2 lg:col-span-1">
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
            className={inputStyles()}
          />
        </div>

        {(['minPrice', 'maxPrice'] as const).map((key) => (
          <div key={key}>
            <label htmlFor={`filter-${key}`} className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
              {tFilters(`${key}Label`)}
            </label>
            <input
              id={`filter-${key}`}
              type="number"
              min={0}
              inputMode="numeric"
              defaultValue={key === 'minPrice' ? initialMinPrice : initialMaxPrice}
              placeholder={tFilters('pricePlaceholder')}
              onBlur={(e) => applyFilter(key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilter(key, e.currentTarget.value);
              }}
              className={inputStyles()}
            />
          </div>
        ))}

        {hasFilters && (
          <div className="col-span-2 flex items-end lg:col-span-1">
            <button
              type="button"
              onClick={() => router.push(pathname)}
              className="h-11 w-full rounded-lg border border-[var(--color-border)] px-3 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-sunken)]"
            >
              {tFilters('clear')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
