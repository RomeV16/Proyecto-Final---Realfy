// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEsWithQuery as renderEs } from '../index-data/test-utils';

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
  usePathname: () => '/es/persons',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('../import/export-buttons', () => ({ ExportButtons: () => <div>Exportar</div> }));

import { ApiRequestError } from '@/lib/api-client';
import { PersonList } from './person-list';

class FakeObserver {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() {
    this.cb([{ isIntersecting: true }]);
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', FakeObserver);

const items = [
  {
    id: 'pe-1',
    firstName: 'Luis',
    lastName: 'Inventado',
    email: 'luis@prueba.test',
    phone: '1111-0000',
    cuit: '20-00000000-1',
    roles: [
      { id: 'r-1', role: 'Inquilino' },
      { id: 'r-2', role: 'Propietario' },
    ],
    isActive: true,
    createdAt: '2026-11-01T15:00:00.000Z',
  },
  {
    id: 'pe-2',
    firstName: 'Marta',
    lastName: 'Ficticia',
    roles: [],
    isActive: true,
    createdAt: '2026-11-01T15:00:00.000Z',
  },
];

function page(over: Record<string, unknown> = {}) {
  return { items, total: 2, page: 1, limit: 12, totalPages: 1, ...over };
}

describe('PersonList', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });

  it('muestra tarjetas con datos y valores por defecto', async () => {
    apiClient.mockResolvedValue(page());
    renderEs(<PersonList />);
    expect(await screen.findByText('Luis Inventado')).toBeInTheDocument();
    expect(screen.getByText('20-00000000-1')).toBeInTheDocument();
    expect(screen.getByText('luis@prueba.test')).toBeInTheDocument();
    expect(screen.getByText('Marta Ficticia')).toBeInTheDocument();
    expect(screen.getByText('Sin CUIT')).toBeInTheDocument();
    expect(screen.getByText('Sin email')).toBeInTheDocument();
    expect(screen.getByText('Sin teléfono')).toBeInTheDocument();
    expect(screen.getByText('Sin roles asignados')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/persons?page=1&limit=12');
  });

  it('los enlaces llevan el prefijo de idioma', async () => {
    apiClient.mockResolvedValue(page());
    renderEs(<PersonList />);
    await screen.findByText('Luis Inventado');
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/es/persons/pe-1');
    expect(hrefs).toContain('/es/persons/new');
    expect(hrefs.every((h) => !h || h.startsWith('/es/'))).toBe(true);
  });

  it.each(['Admin', 'Gerente', 'Ventas'])('%s ve Nueva persona', async (role) => {
    auth.role = role;
    apiClient.mockResolvedValue(page());
    renderEs(<PersonList />);
    await screen.findByText('Luis Inventado');
    expect(screen.getByRole('link', { name: /Nueva persona/ })).toBeInTheDocument();
  });

  it.each(['Lectura', 'Soporte', 'Liquidaciones'])('%s no ve Nueva persona', async (role) => {
    auth.role = role;
    apiClient.mockResolvedValue(page());
    renderEs(<PersonList />);
    await screen.findByText('Luis Inventado');
    expect(screen.queryByRole('link', { name: /Nueva persona/ })).not.toBeInTheDocument();
  });

  it('el vacío ofrece crear solo a quien puede', async () => {
    apiClient.mockResolvedValue(page({ items: [], total: 0, totalPages: 0 }));
    renderEs(<PersonList />);
    expect(await screen.findByText('No hay personas')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Nueva persona/ }).length).toBeGreaterThan(1);
  });

  it('el vacío de un rol de lectura no ofrece crear', async () => {
    auth.role = 'Lectura';
    apiClient.mockResolvedValue(page({ items: [], total: 0, totalPages: 0 }));
    renderEs(<PersonList />);
    expect(await screen.findByText('No hay personas')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Nueva persona/ })).not.toBeInTheDocument();
  });

  it('busca por texto, filtra por rol y limpia', async () => {
    apiClient.mockResolvedValue(page());
    renderEs(<PersonList />);
    await screen.findByText('Luis Inventado');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Buscar'), 'Inv');
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('search=Inv')));
    await user.selectOptions(screen.getByLabelText('Rol'), 'Garante');
    await waitFor(() =>
      expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('role=Garante')),
    );
    await user.click(screen.getByTitle('Limpiar filtros'));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith('/persons?page=1&limit=12'));
  });

  it('sin resultados con filtros muestra el vacío filtrado y permite limpiar', async () => {
    apiClient.mockResolvedValue(page({ items: [], total: 0, totalPages: 0 }));
    renderEs(<PersonList />);
    await screen.findByText('No hay personas');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Rol'), 'Lead');
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Limpiar filtros' })[0]);
    expect(await screen.findByText('No hay personas')).toBeInTheDocument();
  });

  it('pagina hacia adelante y atrás', async () => {
    apiClient.mockResolvedValue(page({ total: 30, totalPages: 3 }));
    renderEs(<PersonList />);
    await screen.findByText('Luis Inventado');
    const user = userEvent.setup();
    expect(screen.getByText('Mostrando 1-12 de 30')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('page=2')));
    expect(await screen.findByText('Mostrando 13-24 de 30')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('page=1')));
  });

  it('un error de la API se avisa con código y referencia, no se disfraza de lista vacía', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'BOOM', 'falló', { correlationId: 'corr-1' }));
    renderEs(<PersonList />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('falló');
    expect(alert).toHaveTextContent('BOOM');
    expect(alert).toHaveTextContent('corr-1');
    expect(screen.queryByText('No hay personas')).not.toBeInTheDocument();
  });

  it('un fallo genérico también se avisa', async () => {
    apiClient.mockRejectedValue(new Error('red'));
    renderEs(<PersonList />);
    expect(await screen.findByRole('alert')).toHaveTextContent('red');
  });

  it('conserva las tarjetas de la página anterior mientras llega la siguiente', async () => {
    let release: (v: unknown) => void = () => {};
    apiClient
      .mockResolvedValueOnce(page({ total: 30, totalPages: 3 }))
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    renderEs(<PersonList />);
    await screen.findByText('Luis Inventado');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Luis Inventado')).toBeInTheDocument();
    release(page({ items: [{ ...items[1], id: 'pe-3', firstName: 'Nora' }], page: 2, total: 30, totalPages: 3 }));
    expect(await screen.findByText('Nora Ficticia')).toBeInTheDocument();
  });
});
