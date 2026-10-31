'use client';

import { useCallback, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/** Respuesta paginada que devuelven los listados de la API. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Options<F extends Record<string, string>> {
  /** Identifica la lista en el caché de react-query (por ejemplo `'persons'`). */
  key: string;
  /** Ruta del listado, sin parámetros (`'/persons'`). */
  path: string;
  limit: number;
  /** Valores iniciales (y de "limpiar") de los filtros; las claves son los parámetros de la consulta. */
  initialFilters: F;
}

/**
 * Listado paginado con filtros sobre react-query. Reemplaza el trío `useState` + `useEffect` + `apiClient` de
 * cada pantalla: pide `path?page=&limit=&filtro=` (los filtros vacíos no viajan), vuelve a la página 1 al
 * cambiar un filtro y conserva la página anterior en pantalla mientras llega la nueva (`isFetching`).
 *
 * `error` trae lo que falló (un `ApiRequestError` normalmente) para mostrarlo con `ErrorNotice`; no se
 * confunde con una lista vacía.
 */
export function usePaginatedList<T, F extends Record<string, string>>({
  key,
  path,
  limit,
  initialFilters,
}: Options<F>) {
  const [filters, setFilters] = useState<F>(initialFilters);
  const [page, setPageState] = useState(1);

  const query = useQuery({
    queryKey: [key, 'list', { page, limit, ...filters }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      for (const [name, value] of Object.entries(filters)) {
        if (value) params.set(name, value);
      }
      return apiClient<Paginated<T>>(`${path}?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const setFilter = useCallback(<K extends keyof F & string>(name: K, value: F[K]) => {
    setFilters((prev) => ({ ...prev, [name]: value }));
    setPageState(1);
  }, []);

  const reset = useCallback(() => {
    setFilters(initialFilters);
    setPageState(1);
    // `initialFilters` suele ser una constante del módulo: no debe reiniciar la identidad del callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasFilters = Object.values(filters).some(Boolean);
  const data = query.data;

  return {
    filters,
    setFilter,
    reset,
    hasFilters,
    page,
    setPage: setPageState,
    data,
    items: data?.items ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 0,
    limit,
    /** Primera carga, todavía sin datos que mostrar. */
    isLoading: query.isPending,
    /** Hay una consulta en curso (primera carga o cambio de filtro/página con datos previos). */
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
