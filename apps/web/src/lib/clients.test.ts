// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBlob, apiClient, getStoredUser, setStoredUser } from './api-client';
import {
  getPortalAccessToken,
  portalApiBlob,
  portalApiClient,
  setPortalTokens,
} from './portal-api-client';

const fetchMock = vi.fn();
const ok = (body: unknown = {}) =>
  new Response(JSON.stringify(body), { status: 200 });
const unauthorized = () => new Response('{}', { status: 401 });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  // jsdom no implementa la navegación que dispara la redirección al login
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('cliente del personal', () => {
  it('envía cookies y renueva por /auth/refresh', async () => {
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok()) // refresh
      .mockResolvedValueOnce(ok({ done: true }));
    await expect(apiClient('/contracts')).resolves.toEqual({ done: true });
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/auth\/refresh$/);
  });

  it('si la renovación falla borra el usuario guardado', async () => {
    setStoredUser({ id: '1', email: 'a@b.c', firstName: 'A', lastName: 'B', role: 'Admin', tenantId: 't' });
    expect(getStoredUser()?.role).toBe('Admin');
    fetchMock.mockResolvedValueOnce(unauthorized()).mockRejectedValueOnce(new Error('red'));
    await apiClient('/x').catch(() => undefined);
    expect(getStoredUser()).toBeNull();
  });

  it('apiBlob devuelve el archivo', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 200 }));
    const { blob } = await apiBlob('/invoices/1/pdf');
    expect(await blob.text()).toBe('x');
  });
});

describe('cliente del portal', () => {
  it('envía el token Bearer guardado', async () => {
    setPortalTokens('acc', 'ref');
    fetchMock.mockResolvedValueOnce(ok({ a: 1 }));
    await portalApiClient('/portal/me');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer acc');
  });

  it('renueva con el refresh token y reintenta con el token nuevo', async () => {
    setPortalTokens('old', 'ref');
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok({ tokens: { accessToken: 'new', refreshToken: 'ref2' } }))
      .mockResolvedValueOnce(ok({ fine: true }));
    await expect(portalApiClient('/portal/me')).resolves.toEqual({ fine: true });
    expect(getPortalAccessToken()).toBe('new');
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer new');
  });

  it('sin refresh token cierra la sesión del portal', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized());
    await portalApiClient('/portal/me').catch(() => undefined);
    expect(localStorage.getItem('portalAccessToken')).toBeNull();
  });

  it('una renovación rechazada o caída cuenta como fallida', async () => {
    setPortalTokens('a', 'r');
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(new Response('{}', { status: 400 }));
    await portalApiClient('/portal/me').catch(() => undefined);
    expect(localStorage.getItem('portalRefreshToken')).toBeNull();

    setPortalTokens('a', 'r');
    fetchMock.mockResolvedValueOnce(unauthorized()).mockRejectedValueOnce(new Error('red'));
    await portalApiClient('/portal/me').catch(() => undefined);
    expect(localStorage.getItem('portalRefreshToken')).toBeNull();
  });

  it('portalApiBlob descarga con el token', async () => {
    setPortalTokens('acc', 'ref');
    fetchMock.mockResolvedValueOnce(new Response('pdf', { status: 200 }));
    const { blob } = await portalApiBlob('/portal/liquidaciones/1/pdf');
    expect(await blob.text()).toBe('pdf');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer acc');
  });
});
