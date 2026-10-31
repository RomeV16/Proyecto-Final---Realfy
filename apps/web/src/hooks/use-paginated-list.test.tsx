// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

import { usePaginatedList } from './use-paginated-list';

const FILTERS = { search: '', status: '' };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function setup() {
  return renderHook(
    () => usePaginatedList<{ id: string }, typeof FILTERS>({ key: 'things', path: '/things', limit: 10, initialFilters: FILTERS }),
    { wrapper },
  );
}

const pageOf = (over: Record<string, unknown> = {}) => ({
  items: [{ id: 'a' }],
  total: 25,
  page: 1,
  limit: 10,
  totalPages: 3,
  ...over,
});

describe('usePaginatedList', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it('pide la primera página sin filtros y expone los datos', async () => {
    apiClient.mockResolvedValue(pageOf());
    const { result } = setup();
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(apiClient).toHaveBeenCalledWith('/things?page=1&limit=10');
    expect(result.current.items).toEqual([{ id: 'a' }]);
    expect(result.current.total).toBe(25);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.hasFilters).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('un filtro viaja en la consulta, vuelve a la página 1 y los vacíos no viajan', async () => {
    apiClient.mockResolvedValue(pageOf());
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setPage(3));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith('/things?page=3&limit=10'));

    act(() => result.current.setFilter('search', 'ana'));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith('/things?page=1&limit=10&search=ana'));
    expect(result.current.page).toBe(1);
    expect(result.current.hasFilters).toBe(true);
    expect(result.current.filters).toEqual({ search: 'ana', status: '' });
  });

  it('reset limpia los filtros y vuelve a la primera página', async () => {
    apiClient.mockResolvedValue(pageOf());
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.setFilter('status', 'Activo'));
    act(() => result.current.setPage(2));
    act(() => result.current.reset());
    expect(result.current.filters).toEqual(FILTERS);
    expect(result.current.page).toBe(1);
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith('/things?page=1&limit=10'));
  });

  it('mantiene los datos anteriores mientras llega la página siguiente', async () => {
    let release: (v: unknown) => void = () => {};
    apiClient
      .mockResolvedValueOnce(pageOf())
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual([{ id: 'a' }]);
    release(pageOf({ items: [{ id: 'b' }], page: 2 }));
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'b' }]));
  });

  it('un error queda en error y no en una lista vacía', async () => {
    const failure = new Error('caído');
    apiClient.mockRejectedValue(failure);
    const { result } = setup();
    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(result.current.items).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.totalPages).toBe(0);
  });
});
