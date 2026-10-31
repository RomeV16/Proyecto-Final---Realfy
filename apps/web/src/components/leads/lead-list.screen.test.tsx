// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
  usePathname: () => '/es/leads',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { ApiRequestError } from '@/lib/api-client';
import { LeadList } from './lead-list';

class FakeObserver {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() {
    this.cb([{ isIntersecting: true }]);
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', FakeObserver);

const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

const pipelines = [
  {
    id: 'pi-1',
    name: 'Pipeline de prueba',
    stages: [
      { id: 'st-1', name: 'Primer contacto', sortOrder: 1 },
      { id: 'st-2', name: 'Visita', sortOrder: 2 },
    ],
  },
  { id: 'pi-2', name: 'Otro pipeline', stages: [{ id: 'st-3', name: 'Etapa única', sortOrder: 1 }] },
];

const users = [
  { id: 'u2', firstName: 'Carla', lastName: 'Ejemplo', role: 'Ventas' },
  { id: 'u3', firstName: 'Rita', lastName: 'Imaginada', role: 'Lectura' },
];

function lead(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    source: 'WebInquiry',
    status: 'Nuevo',
    person: { id: `pe-${id}`, firstName: 'Luis', lastName: `Inventado ${id}` },
    pipeline: { id: 'pi-1', name: 'Pipeline de prueba' },
    currentStage: { id: 'st-1', name: 'Primer contacto', staleDays: 3 },
    assignedToUser: { id: 'u2', firstName: 'Carla', lastName: 'Ejemplo' },
    createdAt: daysAgo(10),
    updatedAt: daysAgo(1),
    lastContactAt: daysAgo(1),
    ...over,
  };
}

const items = [
  lead('a'),
  lead('b', { lastContactAt: daysAgo(9), updatedAt: daysAgo(9) }),
  lead('c', { assignedToUser: null }),
  lead('d', { status: 'Convertido', assignedToUser: null }),
  lead('e', { status: 'Perdido' }),
];

function page(over: Record<string, unknown> = {}) {
  return { items, total: 5, page: 1, limit: 12, totalPages: 1, ...over };
}

interface Opts {
  leads?: () => unknown;
  mutate?: (path: string, init: { method?: string }) => unknown;
}

function mockApi(opts: Opts = {}) {
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method) return Promise.resolve().then(() => (opts.mutate ? opts.mutate(path, init) : {}));
    if (path === '/pipelines') return Promise.resolve({ items: pipelines });
    if (path === '/users') return Promise.resolve({ items: users });
    if (path.startsWith('/properties')) {
      return Promise.resolve({ items: [{ id: 'p-1', title: 'Depto de prueba' }] });
    }
    if (path.startsWith('/leads')) return Promise.resolve().then(opts.leads ?? (() => page()));
    return Promise.resolve({});
  });
}

async function renderList() {
  renderEs(<LeadList />);
  await screen.findByText('Luis Inventado a');
  await screen.findByRole('option', { name: 'Pipeline de prueba' });
  return userEvent.setup();
}

describe('LeadList', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });

  it('muestra tarjetas con avisos de sin contacto y sin asignar', async () => {
    mockApi();
    await renderList();
    expect(screen.getByText('Sin contacto hace 9 días')).toBeInTheDocument();
    expect(screen.getAllByText('Sin asignar').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Carla E.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Web').length).toBeGreaterThan(0);
    expect(screen.getByText('9d')).toBeInTheDocument();
  });

  it('los enlaces de las fichas llevan el prefijo de idioma', async () => {
    mockApi();
    await renderList();
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/es/leads/a');
    expect(hrefs.every((h) => !h || h.startsWith('/es/'))).toBe(true);
  });

  it('los leads terminales no ofrecen reasignar, convertir ni perder', async () => {
    mockApi();
    await renderList();
    expect(screen.getAllByTitle('Reasignar')).toHaveLength(3);
    expect(screen.getAllByTitle('Convertir')).toHaveLength(3);
    expect(screen.getAllByTitle('Marcar como perdido')).toHaveLength(3);
  });

  it.each(['Admin', 'Gerente', 'Ventas'])('%s ve Nuevo lead', async (role) => {
    auth.role = role;
    mockApi();
    await renderList();
    expect(screen.getByRole('button', { name: /Nuevo lead/ })).toBeInTheDocument();
  });

  it.each(['Lectura', 'Soporte', 'Liquidaciones'])('%s no ve Nuevo lead', async (role) => {
    auth.role = role;
    mockApi();
    await renderList();
    expect(screen.queryByRole('button', { name: /Nuevo lead/ })).not.toBeInTheDocument();
  });

  it('el vacío ofrece crear solo a quien puede', async () => {
    mockApi({ leads: () => page({ items: [], total: 0, totalPages: 0 }) });
    renderEs(<LeadList />);
    expect(await screen.findByText('No hay leads')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Nuevo lead/ }).length).toBe(2);
  });

  it('el vacío de un rol de lectura no ofrece crear', async () => {
    auth.role = 'Lectura';
    mockApi({ leads: () => page({ items: [], total: 0, totalPages: 0 }) });
    renderEs(<LeadList />);
    expect(await screen.findByText('No hay leads')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nuevo lead/ })).not.toBeInTheDocument();
  });

  it('las pestañas de estado y los filtros arman la consulta', async () => {
    mockApi();
    const user = await renderList();
    await user.click(screen.getByRole('button', { name: 'Activos' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('status=Nuevo%2CContactado%2CCalificado')),
    );
    await user.click(screen.getByRole('button', { name: 'Convertidos' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('status=Convertido')));
    await user.click(screen.getByRole('button', { name: 'Perdidos' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('status=Perdido')));
    await user.click(screen.getByRole('button', { name: 'Todos' }));

    await user.type(screen.getByPlaceholderText('Nombre, email o teléfono…'), 'Inv');
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('search=Inv')));

    const [pipeline, stage, source, assignee] = screen.getAllByRole('combobox');
    expect(stage).toBeDisabled();
    await user.selectOptions(pipeline, 'pi-1');
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('pipelineId=pi-1')));
    expect(stage).toBeEnabled();
    await user.selectOptions(stage, 'st-2');
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('currentStageId=st-2')));
    await user.selectOptions(source, 'Referral');
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('source=Referral')));
    await user.selectOptions(assignee, 'u2');
    await waitFor(() =>
      expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('assignedToUserId=u2')),
    );
    await user.click(screen.getByTitle('Limpiar filtros'));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith('/leads?page=1&limit=12'));
  });

  it('sin resultados con filtros muestra el vacío filtrado y limpia', async () => {
    mockApi({ leads: () => page({ items: [], total: 0, totalPages: 0 }) });
    renderEs(<LeadList />);
    await screen.findByText('No hay leads');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Perdidos' }));
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Limpiar filtros' })[0]);
    expect(await screen.findByText('No hay leads')).toBeInTheDocument();
  });

  it('pagina hacia adelante y atrás', async () => {
    mockApi({ leads: () => page({ total: 30, totalPages: 3 }) });
    const user = await renderList();
    expect(screen.getByText('Mostrando 1-12 de 30')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('page=2')));
    expect(await screen.findByText('Mostrando 13-24 de 30')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('page=1')));
  });

  it('un error de la API cae en el estado vacío', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockApi({
      leads: () => {
        throw new ApiRequestError(500, 'BOOM', 'falló');
      },
    });
    renderEs(<LeadList />);
    expect(await screen.findByText('No hay leads')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('si fallan los datos de referencia lo registra y sigue funcionando', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    apiClient.mockImplementation((path: string) =>
      path.startsWith('/leads') ? Promise.resolve(page()) : Promise.reject(new Error('x')),
    );
    renderEs(<LeadList />);
    expect(await screen.findByText('Luis Inventado a')).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockRestore();
  });

  it('crea un lead con pipeline preseleccionado y etapa inicial', async () => {
    mockApi();
    const user = await renderList();
    await user.click(screen.getByRole('button', { name: /Nuevo lead/ }));
    const dialogTitle = await screen.findByRole('heading', { name: 'Nuevo Lead' });
    const form = dialogTitle.closest('div')!.parentElement!;
    const scope = within(form as HTMLElement);
    await user.type(scope.getByPlaceholderText('Ej: María'), 'Nora');
    await user.type(scope.getByPlaceholderText('Ej: García'), 'Simulada');
    await user.click(scope.getByRole('button', { name: 'Crear lead' }));
    expect(await screen.findByText('Se requiere al menos email o teléfono')).toBeInTheDocument();
    await user.type(scope.getByPlaceholderText('Ej: maria@ejemplo.com'), 'nora@prueba.test');
    await user.type(scope.getByPlaceholderText('Ej: +54 11 4567-8900'), '1155550000');
    const combos = scope.getAllByRole('combobox');
    await user.selectOptions(combos[0], 'pi-1');
    await user.selectOptions(combos[2], 'Referral');
    await user.selectOptions(combos[3], 'p-1');
    expect(within(combos[4]).queryByRole('option', { name: /Rita Imaginada/ })).not.toBeInTheDocument();
    await user.selectOptions(combos[4], 'u2');
    await user.type(scope.getByPlaceholderText('Observaciones sobre el lead…'), 'Nota');
    await user.click(scope.getByRole('button', { name: 'Crear lead' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/leads',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const call = apiClient.mock.calls.find((c) => c[0] === '/leads' && c[1]?.method === 'POST')!;
    expect(JSON.parse(call[1].body)).toMatchObject({
      firstName: 'Nora',
      lastName: 'Simulada',
      email: 'nora@prueba.test',
      phone: '1155550000',
      source: 'Referral',
      pipelineId: 'pi-1',
      currentStageId: 'st-1',
      propertyId: 'p-1',
      assignedToUserId: 'u2',
      notes: 'Nota',
    });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Nuevo Lead' })).not.toBeInTheDocument());
  });

  it('un error al crear muestra el mensaje de la API o el genérico y se puede cancelar', async () => {
    let fail: unknown = new ApiRequestError(400, 'X', 'Lead duplicado');
    mockApi({
      mutate: () => {
        throw fail;
      },
    });
    const user = await renderList();
    await user.click(screen.getByRole('button', { name: /Nuevo lead/ }));
    await user.type(screen.getByPlaceholderText('Ej: María'), 'Nora');
    await user.type(screen.getByPlaceholderText('Ej: García'), 'Simulada');
    await user.type(screen.getByPlaceholderText('Ej: maria@ejemplo.com'), 'nora@prueba.test');
    await user.click(screen.getByRole('button', { name: 'Crear lead' }));
    expect(await screen.findByText('Lead duplicado')).toBeInTheDocument();
    fail = new Error('x');
    await user.click(screen.getByRole('button', { name: 'Crear lead' }));
    expect(await screen.findByText('No se pudo crear el lead')).toBeInTheDocument();
    const cancel = screen.getAllByRole('button', { name: 'Cancelar' }).at(-1)!;
    await user.click(cancel);
    expect(screen.queryByRole('heading', { name: 'Nuevo Lead' })).not.toBeInTheDocument();
  });

  it('reasigna un lead eligiendo un usuario asignable', async () => {
    mockApi();
    const user = await renderList();
    await user.click(screen.getAllByTitle('Reasignar')[0]);
    await screen.findByRole('heading', { name: 'Reasignar lead' });
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
    const select = screen.getAllByRole('combobox').at(-1)!;
    expect(within(select).queryByRole('option', { name: /Rita Imaginada/ })).not.toBeInTheDocument();
    await user.selectOptions(select, 'u2');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/leads/a/assign',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ assignedToUserId: 'u2' }) }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Reasignar lead' })).not.toBeInTheDocument());
  });

  it('convierte un lead como comprador', async () => {
    mockApi();
    const user = await renderList();
    await user.click(screen.getAllByTitle('Convertir')[0]);
    await screen.findByRole('heading', { name: 'Convertir lead' });
    await user.click(screen.getByLabelText('Comprador'));
    await user.click(screen.getAllByRole('button', { name: 'Convertir' }).at(-1)!);
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/leads/a/convert',
        expect.objectContaining({ body: JSON.stringify({ targetRole: 'Comprador' }) }),
      ),
    );
  });

  it('marcar como perdido exige un motivo y lo envía', async () => {
    mockApi();
    const user = await renderList();
    await user.click(screen.getAllByTitle('Marcar como perdido')[0]);
    await screen.findByRole('heading', { name: 'Marcar lead como perdido' });
    const confirm = screen.getAllByRole('button', { name: 'Marcar como perdido' }).at(-1)!;
    expect(confirm).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Explicá el motivo…'), 'Eligió otra');
    await user.click(confirm);
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/leads/a/lose',
        expect.objectContaining({ body: JSON.stringify({ lostReason: 'Eligió otra' }) }),
      ),
    );
  });

  it('un fallo al reasignar, convertir o perder se ignora sin cerrar la pantalla', async () => {
    mockApi({
      mutate: () => {
        throw new Error('x');
      },
    });
    const user = await renderList();
    await user.click(screen.getAllByTitle('Convertir')[0]);
    await user.click(screen.getAllByRole('button', { name: 'Convertir' }).at(-1)!);
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/leads/a/convert', expect.anything()));
    expect(screen.getByRole('heading', { name: 'Convertir lead' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Convertir lead' })).not.toBeInTheDocument());
  });
});
