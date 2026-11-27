// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '@/components/index-data/test-utils';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/providers',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { ApiRequestError } from '@/lib/api-client';
import ProviderListPage from './page';

class FakeObserver {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() {
    this.cb([{ isIntersecting: true }]);
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', FakeObserver);

const providers = [
  {
    id: 'pr-1',
    firstName: 'Tito',
    lastName: 'Inventado',
    email: 'tito@prueba.test',
    phone: '+54 11 5555-0000',
    providerProfile: { id: 'pp-1', rubros: ['Plomería', 'Gas'], coverageZones: ['Centro', 'Norte'], isActive: true },
  },
  { id: 'pr-2', firstName: 'Nora', lastName: 'Ficticia', providerProfile: null },
  {
    id: 'pr-3',
    firstName: 'Beto',
    lastName: 'Simulado',
    providerProfile: { id: 'pp-3', rubros: [], coverageZones: [], isActive: false },
  },
];

const list = (data: unknown[], meta: Record<string, unknown> = {}) => ({
  data,
  meta: { total: data.length, page: 1, limit: 20, totalPages: 1, ...meta },
});

describe('Listado de proveedores', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it('muestra rubros, zonas y contacto con accesos para llamar y escribir', async () => {
    apiClient.mockResolvedValue(list(providers));
    renderEs(<ProviderListPage />);
    expect(await screen.findByText('Tito Inventado')).toBeInTheDocument();
    expect(screen.getByText('Plomería')).toBeInTheDocument();
    expect(screen.getByText('Centro, Norte')).toBeInTheDocument();
    const call = screen.getAllByRole('link', { name: /5555-0000/ })[0];
    expect(call).toHaveAttribute('href', 'tel:+541155550000');
    expect(screen.getAllByRole('link', { name: /tito@prueba.test/ })[0]).toHaveAttribute('href', 'mailto:tito@prueba.test');
    expect(screen.getByText('Falta cargar rubros y zona de cobertura')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getAllByText('Sin teléfono').length).toBeGreaterThan(0);
    expect(apiClient).toHaveBeenCalledWith('/providers?page=1&limit=20');
  });

  it('busca, filtra solo activos y limpia', async () => {
    apiClient.mockResolvedValue(list(providers));
    renderEs(<ProviderListPage />);
    await screen.findByText('Tito Inventado');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Buscar'), 'ti');
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('search=ti')));
    await user.click(screen.getByLabelText('Solo activos'));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('isActive=true')));
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith('/providers?page=1&limit=20'));
  });

  it('sin proveedores invita a cargar el primero; con filtros ofrece limpiarlos', async () => {
    apiClient.mockResolvedValue(list([]));
    renderEs(<ProviderListPage />);
    expect(await screen.findByText('Todavía no hay proveedores')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Solo activos'));
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
  });

  it('pagina', async () => {
    apiClient.mockResolvedValue(list(providers, { total: 45, totalPages: 3 }));
    renderEs(<ProviderListPage />);
    await screen.findByText('Tito Inventado');
    expect(screen.getByText('Mostrando 1-20 de 45')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith('/providers?page=2&limit=20'));
  });

  it('un error de la API se avisa en vez de mostrar la lista vacía', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'BOOM', 'falló'));
    renderEs(<ProviderListPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('falló');
    expect(screen.queryByText('Todavía no hay proveedores')).not.toBeInTheDocument();
  });
});
