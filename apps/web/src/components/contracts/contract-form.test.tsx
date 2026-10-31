// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, router } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  router: { push: vi.fn() },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'Admin' } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: 'Admin' } }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/contracts/new',
  useRouter: () => router,
}));

import { ApiRequestError } from '@/lib/api-client';
import { ContractForm } from './contract-form';

const PROPERTY = { id: 'p-1', title: 'Depto de prueba', street: 'Calle Ficticia' };
const PERSONS = [
  { id: 'o-1', firstName: 'Ana', lastName: 'Propietaria', roles: [{ role: 'Propietario' }] },
  { id: 't-1', firstName: 'Beto', lastName: 'Inquilino', roles: [{ role: 'Inquilino' }] },
];

let postResult: () => Promise<unknown>;

function mockApi() {
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return postResult();
    if (path.startsWith('/properties')) return Promise.resolve({ items: [PROPERTY] });
    if (path.startsWith('/persons')) {
      const q = decodeURIComponent(path.split('search=')[1].split('&')[0]);
      return Promise.resolve({
        items: PERSONS.filter((p) => p.lastName.toLowerCase().startsWith(q.toLowerCase())),
      });
    }
    return Promise.resolve({});
  });
}

/** Recorre los cuatro pasos con datos válidos y deja el asistente en el último. */
async function fillWizard() {
  const user = userEvent.setup();
  const { container } = renderEs(<ContractForm />);

  await user.type(screen.getByPlaceholderText('Buscar propiedad…'), 'Depto');
  await user.click(await screen.findByRole('button', { name: /Depto de prueba/ }));
  await user.selectOptions(screen.getAllByRole('combobox')[0], 'Alquiler');
  fireEvent.change(container.querySelector('input[type=date]')!, {
    target: { value: '2026-01-01' },
  });
  await user.click(screen.getByRole('button', { name: 'Siguiente' }));

  const search = screen.getByPlaceholderText('Buscar persona por nombre o CUIT…');
  await user.type(search, 'Propietaria');
  await user.click(await screen.findByRole('button', { name: /Agregar propietario/ }));
  await user.type(search, 'Inquilino');
  await user.click(await screen.findByRole('button', { name: /Agregar inquilino/ }));
  await user.click(screen.getByRole('button', { name: 'Siguiente' }));

  await user.type(screen.getAllByPlaceholderText('0.00')[0], '100000');
  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
  return user;
}

const lastPost = () => {
  const call = apiClient.mock.calls.filter(([, init]) => init?.method === 'POST').at(-1)!;
  return { path: call[0] as string, body: JSON.parse(call[1].body) };
};

describe('ContractForm — guardar como borrador o activo', () => {
  beforeEach(() => {
    apiClient.mockReset();
    router.push.mockReset();
    postResult = () => Promise.resolve({ id: 'c-77' });
    mockApi();
  });

  it('en el último paso ofrece las dos formas de guardar y explica la diferencia', async () => {
    await fillWizard();
    expect(screen.getByRole('button', { name: 'Guardar como borrador' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar y activar' })).toBeInTheDocument();
    expect(screen.getByText(/Un borrador se puede revisar y activar después/)).toBeInTheDocument();
  });

  it('guardar como borrador envía status Borrador y abre la ficha', async () => {
    const user = await fillWizard();
    await user.click(screen.getByRole('button', { name: 'Guardar como borrador' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/es/contracts/c-77'));
    const { path, body } = lastPost();
    expect(path).toBe('/contracts');
    expect(body).toMatchObject({
      propertyId: 'p-1',
      contractType: 'Alquiler',
      status: 'Borrador',
    });
    expect(body.persons).toEqual([
      { personId: 'o-1', role: 'Propietario' },
      { personId: 't-1', role: 'Inquilino' },
    ]);
  });

  it('guardar y activar envía status Activo', async () => {
    const user = await fillWizard();
    await user.click(screen.getByRole('button', { name: 'Guardar y activar' }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/es/contracts/c-77'));
    expect(lastPost().body.status).toBe('Activo');
  });

  it('si la respuesta no trae id vuelve al listado', async () => {
    postResult = () => Promise.resolve(undefined);
    const user = await fillWizard();
    await user.click(screen.getByRole('button', { name: 'Guardar como borrador' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/es/contracts'));
  });

  it('mientras activa deshabilita ambos botones y lo avisa', async () => {
    let release: (v: unknown) => void = () => {};
    postResult = () => new Promise((resolve) => (release = resolve));
    const user = await fillWizard();
    await user.click(screen.getByRole('button', { name: 'Guardar y activar' }));

    expect(await screen.findByRole('button', { name: 'Activando contrato…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guardar como borrador' })).toBeDisabled();

    release({ id: 'c-77' });
    await waitFor(() => expect(router.push).toHaveBeenCalled());
  });

  it('si la API rechaza la activación muestra los motivos y no navega', async () => {
    postResult = () =>
      Promise.reject(
        new ApiRequestError(400, 'CONTRACT_NOT_ACTIVATABLE', 'no activable', {
          problems: [{ code: 'OVERLAPPING_CONTRACT', contractId: 'c-2' }],
        }),
      );
    const user = await fillWizard();
    await user.click(screen.getByRole('button', { name: 'Guardar y activar' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se puede activar el contrato:');
    expect(screen.getByRole('link', { name: 'Ver contrato' })).toHaveAttribute(
      'href',
      '/es/contracts/c-2',
    );
    expect(router.push).not.toHaveBeenCalled();
    // Los botones vuelven a estar disponibles para corregir y reintentar.
    expect(screen.getByRole('button', { name: 'Guardar y activar' })).toBeEnabled();
  });

  it('otro error de la API muestra su mensaje y uno desconocido el genérico', async () => {
    postResult = () => Promise.reject(new ApiRequestError(400, 'X', 'Fechas inválidas'));
    const user = await fillWizard();
    await user.click(screen.getByRole('button', { name: 'Guardar como borrador' }));
    expect(await screen.findByText('Fechas inválidas')).toBeInTheDocument();

    postResult = () => Promise.reject(new Error('red caída'));
    await user.click(screen.getByRole('button', { name: 'Guardar como borrador' }));
    expect(await screen.findByText('Error al crear el contrato')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Error al crear el contrato');
  });

  it('no avanza si falta un dato obligatorio del paso actual', async () => {
    const user = userEvent.setup();
    renderEs(<ContractForm />);
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Paso 1 de 4')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});
