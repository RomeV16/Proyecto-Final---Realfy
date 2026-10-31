// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IndexType } from '@realfy/shared';
import { renderEs } from './test-utils';

const { apiClient, toast, auth } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  auth: { role: 'Admin' },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/toast', () => ({ toast }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { role: auth.role } }),
  useOptionalAuth: () => ({ user: { role: auth.role } }) }));

import { ApiRequestError } from '@/lib/api-client';
import { IndexDataSettings } from './index-data-settings';

function row(over: Record<string, unknown>) {
  return {
    id: 'r1',
    tenantId: 'tenant-1',
    indexType: 'IPC',
    period: '2026-09-01T00:00:00.000Z',
    value: '1.9',
    source: 'manual',
    ...over,
  };
}

const MANUAL = row({ id: 'm1' });
const INDEC = row({ id: 'i1', tenantId: '__system__', source: 'indec-csv', period: '2026-08-01T00:00:00.000Z', value: '2.1' });
const FRESH_UVA = row({
  id: 'u1',
  tenantId: '__system__',
  indexType: 'UVA',
  source: 'bcra',
  period: new Date().toISOString(),
  value: '1500.5',
});
const OLD_ICL = row({
  id: 'c1',
  tenantId: '__system__',
  indexType: 'ICL',
  source: 'bcra',
  period: '2020-01-01T00:00:00.000Z',
  value: '2',
});

interface Options {
  latest?: unknown;
  history?: unknown;
  refresh?: unknown;
}

function mockApi({ latest, history, refresh }: Options = {}) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === '/index-data/latest') {
      if (latest instanceof Error) throw latest;
      return (
        latest ?? [
          { indexType: 'IPC', latest: MANUAL, history: [MANUAL] },
          { indexType: 'UVA', latest: FRESH_UVA, history: [FRESH_UVA, FRESH_UVA] },
          { indexType: 'ICL', latest: OLD_ICL, history: [OLD_ICL] },
        ]
      );
    }
    if (path === '/index-data/refresh') {
      if (refresh instanceof Error) throw refresh;
      return refresh ?? { total: 3 };
    }
    if (path.startsWith('/index-data?')) {
      if (history instanceof Error) throw history;
      return (
        history ?? { items: [MANUAL, INDEC], total: 2, page: 1, limit: 24, totalPages: 1 }
      );
    }
    if (init?.method === 'DELETE' || init?.method === 'POST') return {};
    throw new Error(`ruta inesperada ${path}`);
  });
}

function calls(match: string) {
  return apiClient.mock.calls.filter(([path]) => String(path).includes(match));
}

async function ready() {
  const user = userEvent.setup();
  renderEs(<IndexDataSettings />);
  await waitFor(() => expect(screen.getAllByText('Carga manual').length).toBeGreaterThan(0));
  return user;
}

describe('IndexDataSettings', () => {
  beforeEach(() => {
    auth.role = 'Admin';
    apiClient.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
  });

  it('lista los valores con su origen y los últimos por índice', async () => {
    mockApi();
    await ready();
    expect(screen.getAllByText('INDEC').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Desactualizado/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sin datos')).toHaveLength(2);
    expect(calls('/index-data?')[0][0]).toContain('indexType=IPC');
  });

  it('niega el acceso a roles sin permiso y no llama a la API', () => {
    auth.role = 'Lectura';
    mockApi();
    renderEs(<IndexDataSettings />);
    expect(screen.getByText('Solo administradores y gerentes pueden ver los índices.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('el gerente ve los datos pero no puede cargar ni corregir', async () => {
    auth.role = 'Gerente';
    mockApi();
    await ready();
    expect(screen.queryByRole('button', { name: 'Cargar valor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pegar varios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actualizar ahora' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Corregir valor' })).not.toBeInTheDocument();
    expect(screen.getByText('Solo los administradores pueden cargar o corregir valores.')).toBeInTheDocument();
  });

  it('carga un valor manual desde el diálogo', async () => {
    mockApi();
    const user = await ready();
    await user.click(screen.getByRole('button', { name: 'Cargar valor' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Mes'), '2026-10');
    await user.type(within(dialog).getByLabelText('Variación mensual (%)'), '2,4');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = calls('/index-data').find(([p, i]) => p === '/index-data' && i?.method === 'POST');
    expect(JSON.parse(post![1].body)).toMatchObject({ indexType: 'IPC', value: '2.4' });
  });

  it('corrige un valor existente', async () => {
    mockApi();
    const user = await ready();
    await user.click(screen.getAllByRole('button', { name: 'Corregir valor' })[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Mes')).toHaveValue('2026-09');
    expect(within(dialog).getByLabelText('Variación mensual (%)')).toHaveValue('1.9');
  });

  it('pega varios valores y refresca', async () => {
    mockApi();
    const user = await ready();
    await user.click(screen.getByRole('button', { name: 'Pegar varios' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText('Una línea por período'));
    await user.paste('2026-10, 2,4');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar 1 valor' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls('/index-data/bulk')).toHaveLength(1);
    expect(calls('/index-data/latest').length).toBeGreaterThan(1);
  });

  it('guardar otro índice cambia la pestaña seleccionada', async () => {
    mockApi();
    const user = await ready();
    await user.click(screen.getByRole('button', { name: 'Cargar valor' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Índice'), IndexType.CER);
    await user.type(within(dialog).getByLabelText('Mes'), '2026-10');
    await user.type(within(dialog).getByLabelText('Variación mensual (%)'), '2');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'CER', selected: true })).toBeInTheDocument());
  });

  it('elimina solo cargas manuales, con confirmación', async () => {
    mockApi();
    const user = await ready();
    const deletes = screen.getAllByRole('button', { name: 'Eliminar carga manual' });
    expect(deletes).toHaveLength(screen.getAllByRole('button', { name: 'Corregir valor' }).length / 2);
    await user.click(deletes[0]);
    expect(screen.getByRole('dialog')).toHaveTextContent('Se elimina tu valor de IPC');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(calls('/index-data/m1')).toHaveLength(0);

    await user.click(screen.getAllByRole('button', { name: 'Eliminar carga manual' })[0]);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Valor eliminado'));
    expect(calls('/index-data/m1')[0][1].method).toBe('DELETE');
  });

  it('informa cuando falla la eliminación', async () => {
    mockApi();
    const user = await ready();
    apiClient.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    await user.click(screen.getAllByRole('button', { name: 'Eliminar carga manual' })[0]);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No se pudo eliminar el valor'));
  });

  it('actualiza desde las fuentes públicas', async () => {
    mockApi({ refresh: { total: 3 } });
    const user = await ready();
    await user.click(screen.getByRole('button', { name: 'Actualizar ahora' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('3 valores actualizados'));
  });

  it('informa cuando falla la actualización', async () => {
    mockApi({ refresh: new ApiRequestError(502, 'Bad', 'Fuente caída') });
    const user = await ready();
    await user.click(screen.getByRole('button', { name: 'Actualizar ahora' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Fuente caída'));
  });

  it('muestra el error de carga de los últimos valores', async () => {
    mockApi({ latest: new ApiRequestError(500, 'Err', 'Servidor caído') });
    renderEs(<IndexDataSettings />);
    expect(await screen.findByText('Servidor caído')).toBeInTheDocument();
    expect(screen.getAllByText('Sin datos').length).toBe(5);
  });

  it('muestra el error del historial y el estado vacío', async () => {
    mockApi({ history: new Error('boom'), latest: [] });
    renderEs(<IndexDataSettings />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Error al cargar los datos'));
    expect(await screen.findByText('Sin datos de índices')).toBeInTheDocument();
  });

  it('cambia de índice y pagina el historial', async () => {
    mockApi({ history: { items: [MANUAL], total: 50, page: 1, limit: 24, totalPages: 3 } });
    const user = await ready();
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(screen.getByText('Página 2 de 3')).toBeInTheDocument());
    expect(calls('/index-data?').at(-1)![0]).toContain('page=2');
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    await waitFor(() => expect(screen.getByText('Página 1 de 3')).toBeInTheDocument());
    await user.click(screen.getByRole('tab', { name: 'UVA' }));
    await waitFor(() => expect(calls('/index-data?').at(-1)![0]).toContain('indexType=UVA'));
    await user.click(screen.getByRole('tab', { name: 'UVA' }));
  });
});
