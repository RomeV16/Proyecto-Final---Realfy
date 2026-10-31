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
vi.mock('@/lib/auth-context', () => {
  const value = () => ({
    user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' },
  });
  return { useAuth: value, useOptionalAuth: value };
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/contracts',
}));

import { ApiRequestError } from '@/lib/api-client';
import { ContractList } from './contract-list';

const norm = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const person = (id: string, role: string, firstName: string, lastName: string) => ({
  id: `cp-${id}`,
  role,
  person: { id, firstName, lastName },
});

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    contractType: 'Alquiler',
    status: 'Activo',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2028-01-01T00:00:00.000Z',
    rentAmount: '100000',
    rentCurrency: 'ARS',
    adjustmentType: 'IPC',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    property: { id: 'p-1', title: 'Depto de prueba', street: 'Calle Falsa 123', city: 'Ciudad Ejemplo' },
    persons: [person('per-1', 'Inquilino', 'Mario', 'Muestra')],
    ...overrides,
  };
}

function page(items: unknown[], extra: Record<string, unknown> = {}) {
  return { items, total: items.length, page: 1, limit: 12, totalPages: 1, ...extra };
}

describe('ContractList', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });

  it('muestra la tarjeta con monto, rango de fechas y enlace con prefijo de idioma', async () => {
    apiClient.mockResolvedValue(page([item()]));
    const { container } = renderEs(<ContractList />);
    await screen.findByText(/Mario Muestra → Depto de prueba/);
    const text = norm(container.textContent);
    expect(text).toContain('100.000,00');
    expect(text).toContain('1 de ene de 2026');
    expect(text).toContain('1 de ene de 2028');
    expect(text).toContain('Calle Falsa 123, Ciudad Ejemplo');
    expect(apiClient).toHaveBeenCalledWith('/contracts?page=1&limit=12');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/es/contracts/c-1');
  });

  it.each(['Admin', 'Gerente', 'Ventas'])('%s ve el botón de nuevo contrato', async (role) => {
    auth.role = role;
    apiClient.mockResolvedValue(page([item()]));
    renderEs(<ContractList />);
    await screen.findByText(/Mario Muestra/);
    const link = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/es/contracts/new');
    expect(link).toBeTruthy();
  });

  it.each(['Lectura', 'Liquidaciones', 'Soporte'])('%s no ve el botón de nuevo contrato', async (role) => {
    auth.role = role;
    apiClient.mockResolvedValue(page([item()]));
    renderEs(<ContractList />);
    await screen.findByText(/Mario Muestra/);
    const link = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/es/contracts/new');
    expect(link).toBeUndefined();
  });

  it('un contrato por vencer pronto muestra el aviso de vencimiento', async () => {
    apiClient.mockResolvedValue(page([item({ endDate: inDays(20) })]));
    const { container } = renderEs(<ContractList />);
    await screen.findByText(/Mario Muestra/);
    await waitFor(() => expect(container.textContent).toMatch(/20|19|21/));
  });

  it('un contrato vencido muestra el aviso de vencido', async () => {
    apiClient.mockResolvedValue(
      page([item({ status: 'Vencido', endDate: inDays(-10), startDate: inDays(-400) })]),
    );
    renderEs(<ContractList />);
    await screen.findByText(/Mario Muestra/);
    expect(screen.getAllByText(/vencido/i).length).toBeGreaterThan(0);
  });

  it('avisos de datos faltantes según prioridad: propiedad, alquiler, fecha de fin', async () => {
    apiClient.mockResolvedValue(
      page([
        item({ id: 'c-a', property: undefined, persons: [] }),
        item({ id: 'c-b', rentAmount: undefined, adjustmentType: undefined }),
        item({ id: 'c-c', endDate: undefined, status: 'Borrador', currency: 'USD', rentCurrency: undefined }),
        item({ id: 'c-d', status: 'Rescindido' }),
        item({ id: 'c-e', status: 'Renovado', endDate: inDays(30) }),
      ]),
    );
    const { container } = renderEs(<ContractList />);
    await waitFor(() => expect(container.querySelectorAll('a[href^="/es/contracts/c-"]').length).toBeGreaterThanOrEqual(5));
    const text = norm(container.textContent);
    expect(text).toContain('US$');
  });

  it('filtra por estado y tipo de ajuste y permite limpiar', async () => {
    apiClient.mockResolvedValue(page([item()]));
    renderEs(<ContractList />);
    await screen.findByText(/Mario Muestra/);
    const user = userEvent.setup();
    await user.selectOptions(document.getElementById('filter-status') as HTMLSelectElement, 'Activo');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/contracts?page=1&limit=12&status=Activo'));
    await user.selectOptions(document.getElementById('filter-adjType') as HTMLSelectElement, 'IPC');
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/contracts?page=1&limit=12&status=Activo&adjustmentType=IPC'),
    );
    await user.click(screen.getByTitle('Limpiar filtros'));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith('/contracts?page=1&limit=12'));
  });

  it('con filtros y sin resultados ofrece limpiarlos', async () => {
    apiClient.mockResolvedValue(page([]));
    renderEs(<ContractList />);
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    const user = userEvent.setup();
    await user.type(document.getElementById('filter-search') as HTMLInputElement, 'xyz');
    const clear = await screen.findByRole('button', { name: 'Limpiar filtros' });
    await user.click(clear);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument());
  });

  it('sin contratos ni filtros: el estado vacío invita a crear según el rol', async () => {
    apiClient.mockResolvedValue(page([]));
    renderEs(<ContractList />);
    await waitFor(() => {
      const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/es/contracts/new');
      expect(links.length).toBe(2);
    });
  });

  it('Lectura ve el estado vacío sin acción de crear', async () => {
    auth.role = 'Lectura';
    apiClient.mockResolvedValue(page([]));
    renderEs(<ContractList />);
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.queryAllByRole('link').filter((a) => a.getAttribute('href') === '/es/contracts/new')).toHaveLength(0);
  });

  it('un error de la API se avisa con código y se registra', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    apiClient.mockRejectedValue(new ApiRequestError(500, 'BOOM', 'caído'));
    renderEs(<ContractList />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toContain('500 BOOM');
    expect(await screen.findByRole('alert')).toHaveTextContent('caído');
    spy.mockRestore();
  });

  it('un error no tipado también se avisa', async () => {
    apiClient.mockRejectedValue(new Error('red'));
    renderEs(<ContractList />);
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    expect(await screen.findByRole('alert')).toHaveTextContent('red');
    expect(screen.queryByText(/Mario/)).not.toBeInTheDocument();
  });

  it('pagina hacia adelante y atrás', async () => {
    apiClient.mockResolvedValue(page([item()], { total: 30, totalPages: 3 }));
    const { container } = renderEs(<ContractList />);
    await screen.findByText(/Mario Muestra/);
    expect(container.textContent).toContain('1-12 de 30');
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/contracts?page=2&limit=12'));
    await waitFor(() => expect(container.textContent).toContain('13-24 de 30'));
    await user.click(await screen.findByRole('button', { name: 'Anterior' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith('/contracts?page=1&limit=12'));
  });
});
