// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  usePathname: () => '/es/tickets/t-1',
  useParams: () => ({ id: 't-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { ApiRequestError } from '@/lib/api-client';
import TicketDetailPage from './page';

class FakeObserver {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() {
    this.cb([{ isIntersecting: true }]);
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', FakeObserver);

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    title: 'Pérdida de agua de prueba',
    description: 'Descripción ficticia del problema',
    status: 'Abierto',
    priority: 'Urgente',
    slaDeadline: '2026-11-20T15:30:00.000Z',
    createdAt: '2026-11-01T15:30:00.000Z',
    updatedAt: '2026-11-01T15:30:00.000Z',
    property: { id: 'p-1', title: 'Depto de prueba', street: 'Calle Falsa', city: 'Ciudad Prueba' },
    category: { id: 'c-1', name: 'Plomería' },
    createdBy: { id: 'u9', firstName: 'Carla', lastName: 'Ejemplo' },
    assignedTo: { id: 'u2', firstName: 'Pedro', lastName: 'Simulado' },
    provider: null,
    providerNotes: null,
    comments: [
      {
        id: 'cm-1',
        content: 'Primer comentario ficticio',
        createdAt: '2026-11-02T10:00:00.000Z',
        user: { id: 'u9', firstName: 'Carla', lastName: 'Ejemplo' },
        attachments: [{ id: 'a-1', url: 'https://archivos.prueba.test/a.png', thumbnailUrl: 'https://archivos.prueba.test/t.png' }],
      },
      {
        id: 'cm-2',
        content: 'Comentario de inquilino',
        createdAt: '2026-11-03T10:00:00.000Z',
        person: { id: 'pe-1', firstName: 'Luis', lastName: 'Inventado' },
      },
    ],
    validTransitions: ['EnProgreso', 'Cancelado'],
    ...overrides,
  };
}

const users = [
  { id: 'u2', firstName: 'Pedro', lastName: 'Simulado', role: 'Soporte', isActive: true },
  { id: 'u3', firstName: 'Rita', lastName: 'Imaginada', role: 'Gerente', isActive: true },
  { id: 'u4', firstName: 'Baja', lastName: 'Inactiva', role: 'Ventas', isActive: false },
];

const providers = [
  { id: 'pv-1', firstName: 'Tomás', lastName: 'Plomero', providerProfile: { rubros: ['Plomería', 'Gas'] } },
  { id: 'pv-2', firstName: 'Elena', lastName: 'Electra', providerProfile: null },
];

interface Opts {
  ticket?: () => unknown;
  users?: () => unknown;
  providers?: () => unknown;
  mutate?: (path: string, init: { method?: string }) => unknown;
}

function mockApi(opts: Opts = {}) {
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method) {
      return Promise.resolve().then(() => (opts.mutate ? opts.mutate(path, init) : {}));
    }
    if (path === '/tickets/t-1') return Promise.resolve().then(opts.ticket ?? (() => ticket()));
    if (path === '/users') return Promise.resolve().then(opts.users ?? (() => users));
    if (path === '/providers/for-ticket/t-1') {
      return Promise.resolve().then(opts.providers ?? (() => providers));
    }
    return Promise.resolve({});
  });
}

async function renderPage() {
  renderEs(<TicketDetailPage />);
  await screen.findByRole('heading', { name: 'Pérdida de agua de prueba' });
  return userEvent.setup();
}

describe('TicketDetailPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });

  it('muestra la ficha, fechas formateadas y el enlace con prefijo de idioma', async () => {
    mockApi();
    await renderPage();
    expect(screen.getByText('Descripción ficticia del problema')).toBeInTheDocument();
    expect(screen.getByText('Depto de prueba · Calle Falsa · Ciudad Prueba')).toBeInTheDocument();
    expect(screen.getByText('Plomería')).toBeInTheDocument();
    expect(screen.getByText(/20\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/01\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/02\/11\/2026/)).toBeInTheDocument();
    expect(screen.getByText('Primer comentario ficticio')).toBeInTheDocument();
    expect(screen.getByText('Luis Inventado')).toBeInTheDocument();
    expect(screen.getByAltText('Foto adjunta').getAttribute('src')).toBe(
      'https://archivos.prueba.test/t.png',
    );
    expect(screen.getByRole('link', { name: 'Volver a tickets' }).getAttribute('href')).toBe(
      '/es/tickets',
    );
  });

  it.each(['Admin', 'Gerente', 'Soporte'])('%s gestiona el ticket', async (role) => {
    auth.role = role;
    mockApi();
    await renderPage();
    expect(await screen.findByRole('button', { name: 'Reasignar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'En progreso' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelado' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Escribí un comentario…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar proveedores compatibles' })).toBeInTheDocument();
  });

  it.each(['Lectura', 'Ventas', 'Liquidaciones'])('%s solo lee el ticket', async (role) => {
    auth.role = role;
    mockApi();
    await renderPage();
    expect(screen.queryByRole('button', { name: 'Reasignar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'En progreso' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Escribí un comentario…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buscar proveedores compatibles' })).not.toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalledWith('/users');
  });

  it('reasigna al elegir otro usuario activo (sin el actual ni inactivos)', async () => {
    mockApi();
    const user = await renderPage();
    const select = (await screen.findAllByRole('combobox'))[0];
    await screen.findByRole('option', { name: /Rita Imaginada · Gerente/ });
    expect(screen.queryByRole('option', { name: /Pedro Simulado/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Baja Inactiva/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reasignar' })).toBeDisabled();
    await user.selectOptions(select, 'u3');
    await user.click(screen.getByRole('button', { name: 'Reasignar' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/tickets/t-1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ assignedToUserId: 'u3' }) }),
      ),
    );
  });

  it('si reasignar falla muestra el mensaje de la API o el genérico', async () => {
    let fail: unknown = new ApiRequestError(400, 'X', 'No se puede reasignar');
    mockApi({
      mutate: () => {
        throw fail;
      },
    });
    const user = await renderPage();
    await screen.findByRole('option', { name: /Rita Imaginada/ });
    await user.selectOptions((await screen.findAllByRole('combobox'))[0], 'u3');
    await user.click(screen.getByRole('button', { name: 'Reasignar' }));
    expect(await screen.findByText('No se puede reasignar')).toBeInTheDocument();
    fail = new Error('x');
    await user.click(screen.getByRole('button', { name: 'Reasignar' }));
    expect(await screen.findByText('Error al reasignar')).toBeInTheDocument();
  });

  it('sin usuarios asignables lo informa', async () => {
    mockApi({
      users: () => {
        throw new ApiRequestError(403, 'F', 'prohibido');
      },
    });
    await renderPage();
    expect(await screen.findByText('No hay usuarios para asignar')).toBeInTheDocument();
  });

  it('aplica una transición de estado', async () => {
    mockApi();
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'En progreso' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/tickets/t-1/transition',
        expect.objectContaining({ body: JSON.stringify({ status: 'EnProgreso' }) }),
      ),
    );
  });

  it('si la transición falla informa el error', async () => {
    mockApi({
      mutate: () => {
        throw new Error('x');
      },
    });
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Cancelado' }));
    expect(await screen.findByText('No se pudo cambiar el estado')).toBeInTheDocument();
  });

  it('un ticket sin transiciones lo indica y uno cerrado muestra su estado', async () => {
    mockApi({ ticket: () => ticket({ validTransitions: [], status: 'Cerrado', priority: 'Baja' }) });
    await renderPage();
    expect(screen.getByText('Sin transiciones disponibles')).toBeInTheDocument();
    expect(screen.getByText('Cerrado')).toBeInTheDocument();
    expect(screen.getByText('Baja')).toBeInTheDocument();
  });

  it('busca y asigna un proveedor con notas', async () => {
    mockApi();
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Buscar proveedores compatibles' }));
    await screen.findByRole('option', { name: /Tomás Plomero · Plomería, Gas/ });
    const select = screen.getAllByRole('combobox').at(-1)!;
    expect(screen.getByRole('button', { name: 'Asignar proveedor' })).toBeDisabled();
    await user.selectOptions(select, 'pv-1');
    await user.type(screen.getByPlaceholderText('Notas sobre la asignación…'), '  Urgente  ');
    await user.click(screen.getByRole('button', { name: 'Asignar proveedor' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/tickets/t-1/assign-provider',
        expect.objectContaining({
          body: JSON.stringify({ providerId: 'pv-1', providerNotes: 'Urgente' }),
        }),
      ),
    );
  });

  it('el error al asignar proveedor se muestra', async () => {
    mockApi({
      mutate: () => {
        throw new ApiRequestError(400, 'X', 'Proveedor no disponible');
      },
    });
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Buscar proveedores compatibles' }));
    await screen.findByRole('option', { name: /Elena Electra/ });
    await user.selectOptions(screen.getAllByRole('combobox').at(-1)!, 'pv-2');
    await user.click(screen.getByRole('button', { name: 'Asignar proveedor' }));
    expect(await screen.findByText('Proveedor no disponible')).toBeInTheDocument();
  });

  it('un fallo genérico al asignar proveedor muestra el mensaje por defecto', async () => {
    mockApi({
      mutate: () => {
        throw new Error('x');
      },
    });
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Buscar proveedores compatibles' }));
    await screen.findByRole('option', { name: /Elena Electra/ });
    await user.selectOptions(screen.getAllByRole('combobox').at(-1)!, 'pv-2');
    await user.click(screen.getByRole('button', { name: 'Asignar proveedor' }));
    expect(await screen.findByText('Error al asignar proveedor')).toBeInTheDocument();
  });

  it('sin proveedores compatibles lo informa, también si la búsqueda falla', async () => {
    mockApi({
      providers: () => {
        throw new Error('x');
      },
    });
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Buscar proveedores compatibles' }));
    expect(
      await screen.findByText('No hay proveedores disponibles para este ticket'),
    ).toBeInTheDocument();
  });

  it('con proveedor ya asignado muestra su ficha y notas', async () => {
    mockApi({
      ticket: () =>
        ticket({
          provider: { id: 'pv-1', firstName: 'Tomás', lastName: 'Plomero' },
          providerNotes: 'Llevar repuestos',
        }),
    });
    await renderPage();
    expect(screen.getByText('Tomás Plomero')).toBeInTheDocument();
    expect(screen.getByText('Llevar repuestos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buscar proveedores compatibles' })).not.toBeInTheDocument();
  });

  it('un rol de solo lectura sin proveedor ve "Sin asignar" en esa sección', async () => {
    auth.role = 'Lectura';
    mockApi({ ticket: () => ticket({ assignedTo: null }) });
    await renderPage();
    expect(screen.getAllByText('Sin asignar').length).toBeGreaterThan(0);
  });

  it('publica un comentario', async () => {
    mockApi();
    const user = await renderPage();
    const send = screen.getByRole('button', { name: 'Enviar' });
    expect(send).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Escribí un comentario…'), '  Hola equipo  ');
    await user.click(send);
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/tickets/t-1/comments',
        expect.objectContaining({ body: JSON.stringify({ content: 'Hola equipo' }) }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Escribí un comentario…')).toHaveValue(''),
    );
  });

  it('si el comentario falla muestra el error', async () => {
    let fail: unknown = new ApiRequestError(400, 'X', 'Comentario rechazado');
    mockApi({
      mutate: () => {
        throw fail;
      },
    });
    const user = await renderPage();
    await user.type(screen.getByPlaceholderText('Escribí un comentario…'), 'Hola');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Comentario rechazado')).toBeInTheDocument();
    fail = new Error('x');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Error al agregar comentario')).toBeInTheDocument();
  });

  it('un ticket mínimo muestra los valores por defecto', async () => {
    mockApi({
      ticket: () =>
        ticket({
          description: null,
          slaDeadline: null,
          property: null,
          category: null,
          createdBy: null,
          assignedTo: null,
          comments: [],
        }),
    });
    await renderPage();
    expect(screen.getByText('Sin categoría')).toBeInTheDocument();
    expect(screen.getByText('Sin actividad registrada')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('un ticket inexistente muestra el estado vacío con enlace', async () => {
    apiClient.mockImplementation((path: string) =>
      path === '/users' ? Promise.resolve([]) : Promise.reject(new ApiRequestError(404, 'NF', 'no')),
    );
    renderEs(<TicketDetailPage />);
    expect(await screen.findByText('Ticket no encontrado')).toBeInTheDocument();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/es/tickets');
  });
});
