// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const { replaceLocation, apiClient } = vi.hoisted(() => ({ replaceLocation: vi.fn(), apiClient: vi.fn() }));
vi.mock('./hard-navigation', () => ({ replaceLocation, assignLocation: vi.fn() }));
vi.mock('./api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api-client')>()),
  apiClient,
}));

import { getStoredUser, safeRedirectTarget, setStoredUser } from './api-client';
import { AuthProvider, useAuth, useOptionalAuth } from './auth-context';

const ana = { id: 'u1', email: 'ana@example.test', firstName: 'Ana', lastName: 'Prueba', role: 'Admin', tenantId: 't1' };

function Probe() {
  const { user, isLoading, isAuthenticated, updateUser, login } = useAuth();
  return (
    <div>
      <p>{isLoading ? 'cargando' : 'listo'}</p>
      <p>{isAuthenticated ? `${user!.firstName} ${user!.lastName}` : 'sin usuario'}</p>
      <button onClick={() => updateUser({ firstName: 'Anita' })}>renombrar</button>
      <button onClick={() => void login('ana@example.test', 'secreta')}>ingresar</button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    replaceLocation.mockReset();
    apiClient.mockReset();
    window.history.replaceState(null, '', '/es/pagos?estado=pendiente');
  });

  it('con el usuario guardado lo muestra y no redirige', async () => {
    setStoredUser(ana);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText('Ana Prueba')).toBeInTheDocument();
    expect(screen.getByText('listo')).toBeInTheDocument();
    expect(replaceLocation).not.toHaveBeenCalled();
  });

  it('sin usuario guardado pide el ingreso y recuerda la pantalla', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(replaceLocation).toHaveBeenCalledWith('/es/auth/login?redirect=%2Fes%2Fpagos%3Festado%3Dpendiente'),
    );
    expect(screen.getByText('sin usuario')).toBeInTheDocument();
  });

  it('un usuario guardado a medias cuenta como ausente', async () => {
    localStorage.setItem('user', JSON.stringify({ firstName: 'Ana' }));
    expect(getStoredUser()).toBeNull();
    localStorage.setItem('user', '"texto"');
    expect(getStoredUser()).toBeNull();
    localStorage.setItem('user', JSON.stringify({ id: 'u1', role: 'Admin' }));
    expect(getStoredUser()).toEqual({ id: 'u1', role: 'Admin', email: '', firstName: '', lastName: '', tenantId: '' });
    localStorage.setItem('user', '{roto');
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(replaceLocation).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('updateUser y login guardan los datos nuevos', async () => {
    setStoredUser(ana);
    apiClient.mockResolvedValue({ user: { ...ana, firstName: 'Bea', lastName: 'Otra' } });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText('Ana Prueba');
    act(() => screen.getByText('renombrar').click());
    expect(screen.getByText('Anita Prueba')).toBeInTheDocument();
    expect(getStoredUser()?.firstName).toBe('Anita');
    act(() => screen.getByText('ingresar').click());
    expect(await screen.findByText('Bea Otra')).toBeInTheDocument();
    expect(getStoredUser()?.lastName).toBe('Otra');
  });

  it('useAuth exige el proveedor y useOptionalAuth no', () => {
    function Optional() {
      return <p>{useOptionalAuth() ? 'con' : 'sin'} proveedor</p>;
    }
    render(<Optional />);
    expect(screen.getByText('sin proveedor')).toBeInTheDocument();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
    vi.restoreAllMocks();
  });
});

describe('safeRedirectTarget', () => {
  it('acepta rutas internas del panel', () => {
    expect(safeRedirectTarget('?redirect=%2Fes%2Fpagos%3Festado%3Dpendiente')).toBe('/es/pagos?estado=pendiente');
    expect(safeRedirectTarget('?redirect=/contracts/1')).toBe('/contracts/1');
  });

  it('descarta destinos externos, de autenticación o ausentes', () => {
    expect(safeRedirectTarget('')).toBeNull();
    expect(safeRedirectTarget('?redirect=https://otro.example')).toBeNull();
    expect(safeRedirectTarget('?redirect=//otro.example')).toBeNull();
    expect(safeRedirectTarget('?redirect=/%5Cotro.example')).toBeNull();
    expect(safeRedirectTarget('?redirect=/es/auth/login')).toBeNull();
    expect(safeRedirectTarget('?redirect=/auth/register')).toBeNull();
  });
});
