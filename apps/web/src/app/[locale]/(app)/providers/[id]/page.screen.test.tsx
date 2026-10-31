// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '@/components/index-data/test-utils';

const { apiClient, auth } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' } }),
  useOptionalAuth: () => ({
    user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' },
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/providers/pv-1',
  useParams: () => ({ id: 'pv-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { ApiRequestError } from '@/lib/api-client';
import ProviderDetailPage from './page';

class FakeObserver {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() {
    this.cb([{ isIntersecting: true }]);
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', FakeObserver);

function provider(over: Record<string, unknown> = {}) {
  return {
    id: 'pv-1',
    firstName: 'Tomás',
    lastName: 'Plomero',
    email: 'tomas@prueba.test',
    phone: '1155550000',
    notes: 'Nota del contacto',
    isActive: true,
    providerProfile: {
      id: 'pf-1',
      rubros: ['Plomería', 'Gas'],
      coverageZones: ['Zona Norte'],
      isActive: true,
      notes: 'Nota del perfil',
    },
    createdAt: '2026-11-01T15:00:00.000Z',
    updatedAt: '2026-11-15T15:00:00.000Z',
    ...over,
  };
}

describe('ProviderDetailPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });

  it('muestra la ficha con rubros, zonas, notas del perfil y fechas largas', async () => {
    apiClient.mockResolvedValue(provider());
    renderEs(<ProviderDetailPage />);
    expect(await screen.findByRole('heading', { name: 'Tomás Plomero' })).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/providers/pv-1');
    expect(screen.getByText('Plomería')).toBeInTheDocument();
    expect(screen.getByText('Gas')).toBeInTheDocument();
    expect(screen.getByText('Zona Norte')).toBeInTheDocument();
    expect(screen.getByText('Nota del perfil')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('TP')).toBeInTheDocument();
    const text = (document.body.textContent ?? '').replaceAll(' ', ' ');
    expect(text).toMatch(/01 de noviembre de 2026/i);
    expect(text).toMatch(/15 de noviembre de 2026/i);
    expect(screen.getByRole('link', { name: 'tomas@prueba.test' }).getAttribute('href')).toBe(
      'mailto:tomas@prueba.test',
    );
    expect(screen.getByRole('link', { name: '1155550000' }).getAttribute('href')).toBe('tel:1155550000');
    expect(screen.getByRole('link', { name: 'Volver a proveedores' }).getAttribute('href')).toBe(
      '/es/providers',
    );
  });

  it('sin perfil usa el estado y las notas del contacto y muestra los vacíos', async () => {
    apiClient.mockResolvedValue(
      provider({ providerProfile: null, isActive: false, email: null, phone: null }),
    );
    renderEs(<ProviderDetailPage />);
    expect(await screen.findByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByText('Nota del contacto')).toBeInTheDocument();
    expect(screen.getByText('Sin rubros cargados.')).toBeInTheDocument();
    expect(screen.getByText('Sin zonas de cobertura cargadas.')).toBeInTheDocument();
    expect(screen.getByText('Sin email')).toBeInTheDocument();
    expect(screen.getByText('Sin teléfono')).toBeInTheDocument();
  });

  it('un perfil vacío e inactivo sin notas oculta la sección de notas', async () => {
    apiClient.mockResolvedValue(
      provider({
        notes: null,
        providerProfile: { id: 'pf-1', rubros: [], coverageZones: [], isActive: false, notes: null },
      }),
    );
    renderEs(<ProviderDetailPage />);
    expect(await screen.findByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByText('Sin rubros cargados.')).toBeInTheDocument();
    expect(screen.queryByText('Notas')).not.toBeInTheDocument();
  });

  it('un proveedor inexistente muestra el estado vacío con enlace', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(404, 'NF', 'no'));
    renderEs(<ProviderDetailPage />);
    expect(await screen.findByText('Proveedor no encontrado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a proveedores' }).getAttribute('href')).toBe(
      '/es/providers',
    );
  });

  it('un error de red también cae en el estado vacío', async () => {
    apiClient.mockRejectedValue(new Error('red'));
    renderEs(<ProviderDetailPage />);
    expect(await screen.findByText('Proveedor no encontrado')).toBeInTheDocument();
  });
});
