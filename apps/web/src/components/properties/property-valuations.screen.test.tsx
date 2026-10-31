// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => {
  const value = () => ({
    user: { id: 'u1', role: 'Admin', firstName: 'Ana', lastName: 'Prueba' },
  });
  return { useAuth: value, useOptionalAuth: value };
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/properties/p-1',
}));

import { ApiRequestError } from '@/lib/api-client';
import { PropertyValuations } from './property-valuations';

const norm = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

const valuations = [
  {
    id: 'v-1',
    valuationDate: '2026-01-10T00:00:00.000Z',
    value: '100000',
    currency: 'USD',
    method: 'Comparativo',
    appraiser: null,
    notes: null,
    createdAt: '2026-01-10T00:00:00.000Z',
  },
  {
    id: 'v-2',
    valuationDate: '2026-06-15T00:00:00.000Z',
    value: 120000,
    currency: 'USD',
    method: 'Costo',
    appraiser: 'Tasador de Prueba',
    notes: 'Nota de ejemplo',
    createdAt: '2026-06-15T00:00:00.000Z',
  },
];

let list: unknown[];
let post: () => Promise<unknown>;
let del: () => Promise<unknown>;
let comparables: () => Promise<unknown>;

beforeEach(() => {
  apiClient.mockReset();
  list = valuations;
  post = () => Promise.resolve({});
  del = () => Promise.resolve({});
  comparables = () => Promise.resolve([]);
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return post();
    if (init?.method === 'DELETE') return del();
    if (path.endsWith('/comparables')) return comparables();
    return Promise.resolve({ items: list, total: list.length, page: 1, limit: 50 });
  });
});

describe('PropertyValuations', () => {
  it('muestra la última tasación, la variación y el historial con formato es-AR', async () => {
    const { container } = renderEs(<PropertyValuations propertyId="p-1" canEdit />);
    await screen.findByText('Tasador de Prueba', { exact: false });
    const text = norm(container.textContent);
    expect(text).toContain('US$ 120.000');
    expect(text).toContain('US$ 100.000');
    expect(text).toContain('vs. primera tasación');
    expect(text).toContain('Nota de ejemplo');
    expect(text).toMatch(/15 de jun de 2026/);
    expect(text).toMatch(/10 de ene de 2026/);
    expect(text).toContain('Costo');
    expect(apiClient).toHaveBeenCalledWith('/properties/p-1/valuations?limit=50');
  });

  it('sin tasaciones muestra el estado vacío', async () => {
    list = [];
    renderEs(<PropertyValuations propertyId="p-1" canEdit />);
    expect(await screen.findByText('Sin tasaciones registradas')).toBeInTheDocument();
  });

  it('una sola tasación no muestra la cabecera de tendencia', async () => {
    list = [valuations[0]];
    renderEs(<PropertyValuations propertyId="p-1" canEdit={false} />);
    await screen.findByText(/Comparativo/);
    expect(screen.queryByText('vs. primera tasación')).not.toBeInTheDocument();
  });

  it('sin permiso de edición no ofrece agregar ni eliminar', async () => {
    renderEs(<PropertyValuations propertyId="p-1" canEdit={false} />);
    await screen.findByText(/Tasador de Prueba/);
    expect(screen.queryByRole('button', { name: 'Nueva tasación' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver comparables' })).toBeInTheDocument();
  });

  it('un error de carga con mensaje de la API se muestra', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'X', 'Servicio caído'));
    renderEs(<PropertyValuations propertyId="p-1" canEdit />);
    expect(await screen.findByText('Servicio caído')).toBeInTheDocument();
  });

  it('un error de carga genérico usa el texto común', async () => {
    apiClient.mockRejectedValue(new Error('red'));
    renderEs(<PropertyValuations propertyId="p-1" canEdit />);
    expect(await screen.findByText('Error al cargar tasaciones')).toBeInTheDocument();
  });

  it('crea una tasación con el formulario y recarga la lista', async () => {
    renderEs(<PropertyValuations propertyId="p-1" canEdit />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Nueva tasación' }));
    const form = document.querySelector('form')!;
    const number = form.querySelector('input[type="number"]') as HTMLInputElement;
    const texts = form.querySelectorAll('input[type="text"]');
    const selects = form.querySelectorAll('select');
    await user.type(number, '150000');
    await user.selectOptions(selects[0], 'USD');
    await user.selectOptions(selects[1], 'Mixto');
    await user.type(texts[0], 'Perito Ejemplo');
    await user.type(texts[1], 'Observación');
    await user.click(screen.getByRole('button', { name: 'Guardar tasación' }));
    await waitFor(() => {
      const call = apiClient.mock.calls.find((c) => c[1]?.method === 'POST');
      expect(call).toBeTruthy();
      expect(call![0]).toBe('/properties/p-1/valuations');
      const body = JSON.parse(call![1].body);
      expect(body).toMatchObject({
        propertyId: 'p-1',
        value: 150000,
        currency: 'USD',
        method: 'Mixto',
        appraiser: 'Perito Ejemplo',
        notes: 'Observación',
      });
    });
    await waitFor(() => expect(document.querySelector('form')).toBeNull());
  });

  it('cancelar cierra el formulario sin guardar', async () => {
    renderEs(<PropertyValuations propertyId="p-1" canEdit />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Nueva tasación' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(document.querySelector('form')).toBeNull();
    expect(apiClient.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });

  it('un error al guardar muestra el mensaje de la API o el genérico', async () => {
    post = () => Promise.reject(new ApiRequestError(400, 'X', 'Valor inválido'));
    renderEs(<PropertyValuations propertyId="p-1" canEdit />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Nueva tasación' }));
    await user.type(document.querySelector('input[type="number"]')!, '5');
    await user.click(screen.getByRole('button', { name: 'Guardar tasación' }));
    expect(await screen.findByText('Valor inválido')).toBeInTheDocument();

    post = () => Promise.reject(new Error('x'));
    await user.click(screen.getByRole('button', { name: 'Guardar tasación' }));
    expect(await screen.findByText('Error al guardar la tasación')).toBeInTheDocument();
  });

  it('elimina una tasación y recarga', async () => {
    renderEs(<PropertyValuations propertyId="p-1" canEdit />);
    const user = userEvent.setup();
    const buttons = await screen.findAllByRole('button', { name: 'Eliminar' });
    await user.click(buttons[0]);
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/properties/p-1/valuations/v-2', { method: 'DELETE' }),
    );
  });

  it('un error al eliminar muestra el aviso', async () => {
    del = () => Promise.reject(new Error('x'));
    renderEs(<PropertyValuations propertyId="p-1" canEdit />);
    const user = userEvent.setup();
    const buttons = await screen.findAllByRole('button', { name: 'Eliminar' });
    await user.click(buttons[0]);
    expect(await screen.findByText('Error al eliminar la tasación', { exact: false })).toBeInTheDocument();
  });

  it('muestra comparables con su última tasación y permite ocultarlos', async () => {
    comparables = () =>
      Promise.resolve([
        {
          id: 'cp-1',
          title: 'Depto comparable',
          type: 'Departamento',
          city: 'Ciudad Ejemplo',
          rooms: 3,
          totalArea: 65,
          latestValuation: { value: 90000, currency: 'USD', valuationDate: '2026-03-05T00:00:00.000Z' },
        },
        { id: 'cp-2', title: 'Casa sin tasar', type: 'Casa', latestValuation: null },
      ]);
    const { container } = renderEs(<PropertyValuations propertyId="p-1" canEdit />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ver comparables' }));
    await screen.findByText('Depto comparable');
    const text = norm(container.textContent);
    expect(text).toContain('US$ 90.000');
    expect(text).toContain('3 amb.');
    expect(text).toContain('65 m²');
    expect(text).toMatch(/05 de mar de 2026/);
    expect(screen.getByText('Sin tasación')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ocultar comparables' }));
    expect(screen.queryByText('Depto comparable')).not.toBeInTheDocument();
  });

  it('sin comparables muestra el aviso vacío', async () => {
    renderEs(<PropertyValuations propertyId="p-1" canEdit />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ver comparables' }));
    expect(await screen.findByText('No se encontraron propiedades comparables')).toBeInTheDocument();
  });

  it('un error al cargar comparables se informa', async () => {
    comparables = () => Promise.reject(new ApiRequestError(500, 'X', 'Sin comparables ahora'));
    renderEs(<PropertyValuations propertyId="p-1" canEdit />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Ver comparables' }));
    expect(await screen.findByText('Sin comparables ahora')).toBeInTheDocument();
  });
});
