// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

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
  usePathname: () => '/es/properties',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('../import/export-buttons', () => ({ ExportButtons: () => <div>Exportar</div> }));

import { ApiRequestError } from '@/lib/api-client';
import { PropertyList } from './property-list';

class FakeObserver {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() {
    this.cb([{ isIntersecting: true }]);
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', FakeObserver);

const norm = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

const items = [
  {
    id: 'p-1',
    title: 'Depto de prueba',
    type: 'Departamento',
    street: 'Calle Falsa',
    city: 'Ciudad Prueba',
    province: 'Provincia Prueba',
    area: 55,
    rooms: 3,
    bedrooms: 2,
    price: '90000',
    currency: 'USD',
    operations: [
      { id: 'op-1', operationType: 'Alquiler', state: 'Disponible', price: '100000', currency: 'ARS' },
    ],
    media: [{ id: 'm-1', url: 'https://archivos.prueba.test/f.jpg', thumbnailUrl: 'https://archivos.prueba.test/t.jpg', isPrimary: true, sortOrder: 0 }],
    isActive: true,
    createdAt: '2026-11-01T15:00:00.000Z',
  },
  {
    id: 'p-2',
    title: 'Casa sin fotos',
    type: 'Casa',
    price: '250000',
    currency: 'USD',
    operations: [],
    media: [],
    isActive: true,
    createdAt: '2026-11-01T15:00:00.000Z',
  },
  {
    id: 'p-3',
    title: 'Local sin precio',
    type: 'Local',
    operations: [{ id: 'op-3', operationType: 'Venta', state: 'Borrador' }],
    media: [{ id: 'm-3', url: 'https://archivos.prueba.test/g.jpg', thumbnailUrl: 'https://archivos.prueba.test/g-t.jpg', isPrimary: false, sortOrder: 0 }],
    isActive: true,
    createdAt: '2026-11-01T15:00:00.000Z',
  },
];

function page(over: Record<string, unknown> = {}) {
  return { items, total: 3, page: 1, limit: 12, totalPages: 1, ...over };
}

describe('PropertyList', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });

  it('muestra tarjetas con precio de la operación, precio de ficha y avisos', async () => {
    apiClient.mockResolvedValue(page());
    renderEs(<PropertyList />);
    expect(await screen.findByText('Depto de prueba')).toBeInTheDocument();
    const text = norm(document.body.textContent);
    expect(text).toContain('$ 100.000');
    expect(text).toMatch(/US\$\s?250\.000/);
    expect(screen.getByText('Precio a consultar')).toBeInTheDocument();
    expect(screen.getByText('Agregá fotos para publicarla')).toBeInTheDocument();
    expect(screen.getByText('Falta cargar el precio')).toBeInTheDocument();
    expect(screen.getByText('3 amb.')).toBeInTheDocument();
    expect(screen.getByText('2 dorm.')).toBeInTheDocument();
    expect(screen.getByText('55 m²')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/properties?page=1&limit=12');
  });

  it('los enlaces de las fichas llevan el prefijo de idioma', async () => {
    apiClient.mockResolvedValue(page());
    renderEs(<PropertyList />);
    await screen.findByText('Depto de prueba');
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/es/properties/p-1');
    expect(hrefs).toContain('/es/properties/new');
    expect(hrefs.every((h) => !h || h.startsWith('/es/'))).toBe(true);
  });

  it.each(['Admin', 'Gerente', 'Ventas'])('%s ve Nueva propiedad', async (role) => {
    auth.role = role;
    apiClient.mockResolvedValue(page());
    renderEs(<PropertyList />);
    await screen.findByText('Depto de prueba');
    expect(screen.getByRole('link', { name: /Nueva propiedad/ })).toBeInTheDocument();
  });

  it.each(['Lectura', 'Soporte', 'Liquidaciones'])('%s no ve Nueva propiedad', async (role) => {
    auth.role = role;
    apiClient.mockResolvedValue(page());
    renderEs(<PropertyList />);
    await screen.findByText('Depto de prueba');
    expect(screen.queryByRole('link', { name: /Nueva propiedad/ })).not.toBeInTheDocument();
  });

  it('el estado vacío ofrece crear solo a quien puede', async () => {
    apiClient.mockResolvedValue(page({ items: [], total: 0, totalPages: 0 }));
    renderEs(<PropertyList />);
    expect(await screen.findByText('No hay propiedades')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Nueva propiedad/ }).length).toBeGreaterThan(1);
  });

  it('el estado vacío de un rol de lectura no ofrece crear', async () => {
    auth.role = 'Lectura';
    apiClient.mockResolvedValue(page({ items: [], total: 0, totalPages: 0 }));
    renderEs(<PropertyList />);
    expect(await screen.findByText('No hay propiedades')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Nueva propiedad/ })).not.toBeInTheDocument();
  });

  it('filtra por tipo, operación, estado y ciudad, y limpia', async () => {
    apiClient.mockResolvedValue(page());
    renderEs(<PropertyList />);
    await screen.findByText('Depto de prueba');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Tipo'), 'Casa');
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('type=Casa')));
    await user.selectOptions(screen.getByLabelText('Operación'), 'Alquiler');
    await waitFor(() =>
      expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('operationType=Alquiler')),
    );
    await user.selectOptions(screen.getByLabelText('Estado'), 'Disponible');
    await waitFor(() =>
      expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('state=Disponible')),
    );
    await user.type(screen.getByLabelText('Ciudad'), 'Rosario');
    await waitFor(() =>
      expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('city=Rosario')),
    );
    await user.click(screen.getByTitle('Limpiar filtros'));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith('/properties?page=1&limit=12'));
  });

  it('sin resultados con filtros muestra el vacío filtrado y permite limpiar', async () => {
    apiClient.mockResolvedValue(page({ items: [], total: 0, totalPages: 0 }));
    renderEs(<PropertyList />);
    await screen.findByText('No hay propiedades');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Tipo'), 'Casa');
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
    expect(
      screen.getByText('No se encontraron propiedades con los filtros aplicados'),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Limpiar filtros' })[0]);
    expect(await screen.findByText('No hay propiedades')).toBeInTheDocument();
  });

  it('pagina hacia adelante y atrás', async () => {
    apiClient.mockResolvedValue(page({ total: 30, totalPages: 3 }));
    renderEs(<PropertyList />);
    await screen.findByText('Depto de prueba');
    const user = userEvent.setup();
    expect(screen.getByText('Mostrando 1-12 de 30')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('page=2')));
    expect(await screen.findByText('Mostrando 13-24 de 30')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('page=1')));
  });

  it('un error de la API cae en el estado vacío', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    apiClient.mockRejectedValue(new ApiRequestError(500, 'BOOM', 'falló'));
    renderEs(<PropertyList />);
    expect(await screen.findByText('No hay propiedades')).toBeInTheDocument();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('un fallo que no es de la API también cae en el estado vacío', async () => {
    apiClient.mockRejectedValue(new Error('red'));
    renderEs(<PropertyList />);
    expect(await screen.findByText('No hay propiedades')).toBeInTheDocument();
  });
});
