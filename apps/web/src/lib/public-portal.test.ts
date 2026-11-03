import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPublicProperties, getPublicSitemap } from './public-portal';

describe('cliente del portal público', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pasa zona y rango de precio a la API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [], total: 0, page: 1, limit: 12 }) });
    vi.stubGlobal('fetch', fetchMock);
    await getPublicProperties('mi-inmo', { city: 'Córdoba', minPrice: '100', maxPrice: '900', operation: 'Alquiler' });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/public/mi-inmo/properties');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      operation: 'Alquiler',
      city: 'Córdoba',
      minPrice: '100',
      maxPrice: '900',
      page: '1',
      limit: '12',
    });
  });

  it('un error de la API deja la grilla vacía en vez de romper la portada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(getPublicProperties('mi-inmo', { minPrice: 'abc', page: 2 })).resolves.toEqual({
      items: [],
      total: 0,
      page: 2,
      limit: 12,
    });
  });

  it('el sitemap devuelve las entradas o una lista vacía si la API falla', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 'p1', updatedAt: '2026-11-01T00:00:00.000Z' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getPublicSitemap('mi-inmo')).resolves.toEqual([{ id: 'p1', updatedAt: '2026-11-01T00:00:00.000Z' }]);
    await expect(getPublicSitemap('mi-inmo')).resolves.toEqual([]);
    await expect(getPublicSitemap('nada')).resolves.toEqual([]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/public/mi-inmo/sitemap');
  });
});
