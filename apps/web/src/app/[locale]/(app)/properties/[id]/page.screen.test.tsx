// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '@/components/index-data/test-utils';

const { apiClient, auth, push } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  push: vi.fn(),
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
  usePathname: () => '/es/properties/p-1',
  useParams: () => ({ id: 'p-1' }),
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/navigation')>()),
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/components/properties/property-form', () => ({
  PropertyForm: ({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: () => void }) => (
    <div>
      <p>Formulario de edición</p>
      <button onClick={onCancel}>Cancelar edición</button>
      <button onClick={onSuccess}>Guardar edición</button>
    </div>
  ),
}));
vi.mock('@/components/properties/property-media-upload', () => ({
  PropertyMediaUpload: () => <div>Carga de fotos</div>,
}));
vi.mock('@/components/properties/property-valuations', () => ({
  PropertyValuations: ({ canEdit }: { canEdit: boolean }) => (
    <div>{canEdit ? 'Tasaciones editables' : 'Tasaciones de lectura'}</div>
  ),
}));

import { ApiRequestError } from '@/lib/api-client';
import PropertyDetailPage from './page';

function property(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    title: 'Depto de prueba',
    description: 'Luminoso departamento de prueba',
    type: 'Departamento',
    street: 'Calle Falsa',
    number: '123',
    floor: '4',
    apartment: 'B',
    city: 'Ciudad Prueba',
    province: 'Provincia Prueba',
    zipCode: '1000',
    country: 'Argentina',
    latitude: -34.60371,
    longitude: -58.38157,
    area: 55,
    rooms: 3,
    bedrooms: 2,
    bathrooms: 1,
    garages: 1,
    age: 10,
    orientation: 'Norte',
    price: '90000',
    currency: 'USD',
    amenities: ['Pileta', 'Amenidad inventada'],
    isActive: true,
    operations: [
      { id: 'op-1', operationType: 'Alquiler', state: 'Disponible', price: '100000', currency: 'ARS' },
      { id: 'op-2', operationType: 'Venta', state: 'Borrador', price: null, currency: 'USD' },
    ],
    media: [],
    priceHistory: [],
    personRoles: [
      {
        id: 'pr-1',
        role: 'Inquilino',
        person: { id: 'pe-1', firstName: 'Luis', lastName: 'Inventado', phone: '1111', email: 'luis@prueba.test' },
      },
      {
        id: 'pr-2',
        role: 'Propietario',
        person: { id: 'pe-2', firstName: 'Marta', lastName: 'Ficticia' },
      },
    ],
    createdAt: '2026-11-01T15:00:00.000Z',
    updatedAt: '2026-11-02T15:00:00.000Z',
    ...overrides,
  };
}

function mockApi(get: () => unknown, other?: (path: string, init?: { method?: string }) => unknown) {
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method && other) return Promise.resolve().then(() => other(path, init));
    if (path === '/properties/p-1') return Promise.resolve().then(get);
    return Promise.resolve({});
  });
}

const norm = (s: string | null) => (s ?? '').replaceAll('\u00a0', ' ');

async function renderPage() {
  renderEs(<PropertyDetailPage />);
  await screen.findByRole('heading', { name: 'Depto de prueba' });
  return userEvent.setup();
}

describe('PropertyDetailPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    push.mockReset();
    auth.role = 'Admin';
  });

  it('muestra el precio de la operación, fechas y datos de la ficha', async () => {
    mockApi(() => property());
    await renderPage();
    expect(norm(document.body.textContent)).toContain('$ 100.000');
    expect(norm(document.body.textContent)).toContain('01 de nov de 2026');
    expect(screen.getByText('-34.60371, -58.38157')).toBeInTheDocument();
    expect(screen.getAllByText(/Calle Falsa 123, Piso 4, Depto\. B/).length).toBeGreaterThan(0);
    expect(screen.getByText('Amenidad inventada')).toBeInTheDocument();
    expect(screen.getByText('Luminoso departamento de prueba')).toBeInTheDocument();
    expect(screen.getByText('55 m²')).toBeInTheDocument();
  });

  it('el precio de referencia sirve cuando la operación no fija uno', async () => {
    mockApi(() => property());
    await renderPage();
    expect(norm(document.body.textContent)).toMatch(/US\$\s?90\.000/);
  });

  it('los vinculados enlazan con prefijo de idioma y se ordenan por rol', async () => {
    mockApi(() => property());
    await renderPage();
    const link = screen.getAllByRole('link', { name: /Luis Inventado/ })[0];
    expect(link.getAttribute('href')).toBe('/es/persons/pe-1');
    expect(screen.getByRole('link', { name: 'Volver a propiedades' }).getAttribute('href')).toBe(
      '/es/properties',
    );
    expect(screen.getAllByText('luis@prueba.test')[0]).toBeInTheDocument();
    const names = screen.getAllByText(/Marta Ficticia|Luis Inventado/).map((n) => n.textContent);
    expect(names[0]).toContain('Marta');
  });

  it.each(['Admin', 'Gerente'])('%s ve Editar y Eliminar', async (role) => {
    auth.role = role;
    mockApi(() => property());
    await renderPage();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
    expect(screen.getByText('Tasaciones editables')).toBeInTheDocument();
    expect(screen.getByText('Carga de fotos')).toBeInTheDocument();
  });

  it('Ventas edita pero no elimina', async () => {
    auth.role = 'Ventas';
    mockApi(() => property());
    await renderPage();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
  });

  it.each(['Lectura', 'Soporte', 'Liquidaciones'])('%s no ve acciones ni transiciones', async (role) => {
    auth.role = role;
    mockApi(() => property());
    await renderPage();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
    expect(screen.queryByText('Mover a')).not.toBeInTheDocument();
    expect(screen.queryByText('Carga de fotos')).not.toBeInTheDocument();
    expect(screen.getByText('Tasaciones de lectura')).toBeInTheDocument();
  });

  it('cambia el estado de una operación', async () => {
    mockApi(
      () => property(),
      () => ({}),
    );
    const user = await renderPage();
    const before = screen.getAllByText('Reservado').length;
    await user.click(screen.getAllByRole('button', { name: 'Reservado' })[0]);
    expect(apiClient).toHaveBeenCalledWith(
      '/properties/p-1/operations/op-1/state',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ state: 'Reservado' }) }),
    );
    await waitFor(() => expect(screen.getAllByText('Reservado').length).toBeGreaterThan(0));
    expect(before).toBeGreaterThan(0);
  });

  it('si la transición falla con la API muestra su mensaje', async () => {
    mockApi(
      () => property(),
      () => {
        throw new ApiRequestError(400, 'X', 'Transición rechazada');
      },
    );
    const user = await renderPage();
    await user.click(screen.getAllByRole('button', { name: 'Reservado' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Transición rechazada');
  });

  it('si la transición falla sin código muestra el mensaje genérico', async () => {
    mockApi(
      () => property(),
      () => {
        throw new Error('red');
      },
    );
    const user = await renderPage();
    await user.click(screen.getAllByRole('button', { name: 'Reservado' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cambiar el estado');
  });

  it('elimina y vuelve al listado', async () => {
    mockApi(
      () => property(),
      () => ({}),
    );
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(screen.getByText('¿Estás seguro de eliminar esta propiedad?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/properties'));
    expect(apiClient).toHaveBeenCalledWith('/properties/p-1', { method: 'DELETE' });
  });

  it('cancelar la eliminación oculta el aviso', async () => {
    mockApi(() => property());
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText('¿Estás seguro de eliminar esta propiedad?')).not.toBeInTheDocument();
  });

  it('eliminar con contratos activos muestra el motivo y oculta Confirmar', async () => {
    mockApi(
      () => property(),
      () => {
        throw new ApiRequestError(409, 'PROPERTY_HAS_ACTIVE_CONTRACTS', 'x');
      },
    );
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText(/tiene contratos activos/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar' })).not.toBeInTheDocument();
  });

  it('otro fallo al eliminar muestra el error genérico', async () => {
    mockApi(
      () => property(),
      () => {
        throw new Error('boom');
      },
    );
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('No se pudo eliminar la propiedad')).toBeInTheDocument();
  });

  it('entra y sale del modo edición', async () => {
    mockApi(() => property());
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByText('Formulario de edición')).toBeInTheDocument();
    expect(screen.getByText('Editar propiedad')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar edición' }));
    expect(screen.getByText('Detalle de propiedad')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    await user.click(screen.getByRole('button', { name: 'Guardar edición' }));
    await waitFor(() => expect(screen.getByText('Detalle de propiedad')).toBeInTheDocument());
  });

  it('una ficha mínima muestra los estados vacíos', async () => {
    mockApi(() =>
      property({
        description: undefined,
        street: undefined,
        number: undefined,
        floor: undefined,
        apartment: undefined,
        city: undefined,
        province: undefined,
        zipCode: undefined,
        country: undefined,
        latitude: null,
        longitude: null,
        area: undefined,
        rooms: undefined,
        bedrooms: undefined,
        bathrooms: undefined,
        garages: undefined,
        age: undefined,
        orientation: undefined,
        price: undefined,
        amenities: [],
        operations: [],
        personRoles: [],
      }),
    );
    await renderPage();
    expect(screen.getByText('Sin descripción cargada')).toBeInTheDocument();
    expect(screen.getByText('Sin amenidades cargadas')).toBeInTheDocument();
    expect(screen.getByText('Sin dirección')).toBeInTheDocument();
    expect(screen.getByText('Precio a consultar')).toBeInTheDocument();
    expect(screen.getByText('No hay personas vinculadas a esta propiedad')).toBeInTheDocument();
  });

  it('una propiedad inexistente muestra el estado vacío con enlace al listado', async () => {
    apiClient.mockImplementation(() => Promise.reject(new ApiRequestError(404, 'NF', 'no')));
    renderEs(<PropertyDetailPage />);
    expect(await screen.findByText('Propiedad no encontrada')).toBeInTheDocument();
    const back = screen.getAllByRole('link', { name: /Volver a propiedades/ });
    expect(back.every((l) => l.getAttribute('href') === '/es/properties')).toBe(true);
    expect(within(document.body).getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('un error de red al cargar también cae en el estado vacío', async () => {
    apiClient.mockImplementation(() => Promise.reject(new Error('red')));
    renderEs(<PropertyDetailPage />);
    expect(await screen.findByText('Propiedad no encontrada')).toBeInTheDocument();
  });
});
