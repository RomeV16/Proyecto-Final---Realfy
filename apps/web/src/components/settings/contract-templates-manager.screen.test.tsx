// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toast } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));
vi.mock('@/lib/toast', () => ({ toast }));

import { ApiRequestError } from '@/lib/api-client';
import ContractTemplatesPage from '@/app/[locale]/(app)/configuracion/plantillas/page';

const template = (n: number, over: Record<string, unknown> = {}) => ({
  id: `t${n}`,
  name: `Plantilla de prueba ${n}`,
  contractType: 'Alquiler',
  body: `Contrato número ${n}`,
  isActive: true,
  isDefault: false,
  ...over,
});

function list(items: unknown[], extra: Record<string, unknown> = {}) {
  return { items, total: items.length, page: 1, limit: 10, totalPages: 1, ...extra };
}

function mockApi(items: unknown[] = [template(1, { isDefault: true }), template(2, { isActive: false, contractType: 'Venta' })]) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method) return {};
    if (path.startsWith('/contract-templates?')) return list(items);
    throw new Error(`unexpected ${path}`);
  });
}

const writes = () => apiClient.mock.calls.filter((c) => c[1]?.method);

beforeEach(() => {
  apiClient.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  auth.role = 'Admin';
});

describe('Configuración → Plantillas de contrato', () => {
  it('lista las plantillas con su tipo, estado y marca de predeterminada', async () => {
    mockApi();
    renderEs(<ContractTemplatesPage />);
    expect(await screen.findByText('Plantilla de prueba 1')).toBeInTheDocument();
    expect(screen.getByText('Plantilla de prueba 2')).toBeInTheDocument();
    expect(screen.getByText('Predeterminada')).toBeInTheDocument();
    expect(screen.getByText('Inactiva')).toBeInTheDocument();
    expect(screen.getByText('Venta')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/contract-templates?page=1&limit=10');
  });

  it('sin plantillas muestra el estado vacío', async () => {
    mockApi([]);
    renderEs(<ContractTemplatesPage />);
    expect(await screen.findByText('Todavía no hay plantillas')).toBeInTheDocument();
  });

  it('un error al cargar se avisa', async () => {
    apiClient.mockRejectedValue(new Error('red'));
    renderEs(<ContractTemplatesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las plantillas');
  });

  it('pagina la lista', async () => {
    apiClient.mockImplementation(async (path: string) => list([template(1)], { total: 12, totalPages: 2, page: path.includes('page=2') ? 2 : 1 }));
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await screen.findByText('Plantilla de prueba 1');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/contract-templates?page=2&limit=10'));
  });

  it.each(['Ventas', 'Lectura', 'Liquidaciones'])('%s ve el aviso y no consulta ni ve acciones', (role) => {
    auth.role = role;
    mockApi();
    renderEs(<ContractTemplatesPage />);
    expect(screen.getByText('Solo Admin y Gerente administran las plantillas de contrato.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nueva plantilla' })).not.toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('crea una plantilla con su texto, tipo y marcas', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await screen.findByText('Plantilla de prueba 1');
    await user.click(screen.getByRole('button', { name: 'Nueva plantilla' }));
    await user.type(screen.getByLabelText(/^Nombre/), '  Locación demo ');
    await user.selectOptions(screen.getByLabelText('Tipo de contrato'), 'AlquilerTemporario');
    fireEvent.change(screen.getByLabelText(/^Texto del contrato/), { target: { value: 'Entre {{inquilino.nombreCompleto}} y la inmobiliaria.' } });
    await user.click(screen.getByLabelText(/Predeterminada para su tipo/));
    await user.click(screen.getByRole('button', { name: 'Crear plantilla' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    const [path, init] = writes()[0];
    expect(path).toBe('/contract-templates');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      name: 'Locación demo',
      contractType: 'AlquilerTemporario',
      body: 'Entre {{inquilino.nombreCompleto}} y la inmobiliaria.',
      isActive: true,
      isDefault: true,
    });
    expect(toast.success).toHaveBeenCalledWith('Plantilla creada');
    expect(await screen.findByText('Plantilla de prueba 1')).toBeInTheDocument();
  });

  it('exige nombre y texto antes de enviar', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await screen.findByText('Plantilla de prueba 1');
    await user.click(screen.getByRole('button', { name: 'Nueva plantilla' }));
    await user.click(screen.getByRole('button', { name: 'Crear plantilla' }));
    expect(screen.getAllByText('Este dato es obligatorio')).toHaveLength(2);
    expect(writes()).toHaveLength(0);
  });

  it('edita una plantilla con PATCH y vuelve a la lista', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: 'Editar: Plantilla de prueba 1' }));
    expect(screen.getByRole('heading', { name: 'Editar plantilla de contrato' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Texto del contrato/)).toHaveValue('Contrato número 1');
    fireEvent.change(screen.getByLabelText(/^Texto del contrato/), { target: { value: 'Texto nuevo' } });
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/contract-templates/t1');
    expect(writes()[0][1].method).toBe('PATCH');
    expect(JSON.parse(writes()[0][1].body).body).toBe('Texto nuevo');
    expect(toast.success).toHaveBeenCalledWith('Plantilla actualizada');
    expect(await screen.findByRole('heading', { name: 'Plantillas de contrato' })).toBeInTheDocument();
  });

  it('volver o cancelar deja la lista sin guardar', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: 'Editar: Plantilla de prueba 1' }));
    await user.click(screen.getByRole('button', { name: 'Volver a la lista' }));
    expect(screen.getByRole('heading', { name: 'Plantillas de contrato' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar: Plantilla de prueba 1' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('heading', { name: 'Plantillas de contrato' })).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('valida el texto en vivo y muestra la línea y la columna del error', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: 'Editar: Plantilla de prueba 1' }));
    const body = screen.getByLabelText(/^Texto del contrato/);
    expect(screen.getByRole('status')).toHaveTextContent('La plantilla está bien formada.');
    fireEvent.change(body, { target: { value: 'Primero\n{{#si contrato.deposito}}Depósito' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Plantilla mal formada');
    expect(screen.getByRole('alert')).toHaveTextContent('línea 2, columna 1');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    fireEvent.change(body, { target: { value: '{{#cada fiadores}}x{{/cada}}' } });
    expect(screen.getByRole('alert')).toHaveTextContent('fiadores');
    fireEvent.change(body, { target: { value: '{{#si a}}x{{/si}}' } });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
  });

  it('muestra el error 400 de la API con su línea y columna', async () => {
    apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method) {
        throw new ApiRequestError(400, 'TEMPLATE_SYNTAX_ERROR', 'Etiqueta no reconocida (línea 3, columna 7)', {
          error: 'TEMPLATE_SYNTAX_ERROR',
          message: 'Etiqueta no reconocida (línea 3, columna 7)',
          details: { code: 'UNKNOWN_BLOCK', line: 3, column: 7 },
        });
      }
      return list([template(1)]);
    });
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: 'Editar: Plantilla de prueba 1' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('La plantilla no se guardó. Error en la línea 3, columna 7.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
  });

  it('un error cualquiera al guardar se muestra sin posición', async () => {
    apiClient.mockImplementation(async (_path: string, init?: { method?: string }) => {
      if (init?.method) throw new ApiRequestError(400, 'TEMPLATE_NAME_EXISTS', 'Ya existe una plantilla con ese nombre');
      return list([template(1)]);
    });
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: 'Editar: Plantilla de prueba 1' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Ya existe una plantilla con ese nombre')).toBeInTheDocument();
    expect(screen.queryByText(/La plantilla no se guardó/)).not.toBeInTheDocument();
  });

  it('inserta una variable del catálogo en la posición del cursor', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: 'Editar: Plantilla de prueba 1' }));
    const body = screen.getByLabelText(/^Texto del contrato/) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: 'Alquiler de  por mes' } });
    body.setSelectionRange(12, 12);
    const catalog = within(screen.getByRole('complementary', { name: 'Variables y bloques disponibles' }));
    await user.click(catalog.getByRole('button', { name: 'Insertar {{contrato.monto}}' }));
    expect(body).toHaveValue('Alquiler de {{contrato.monto}} por mes');
    expect(body.selectionStart).toBe(12 + '{{contrato.monto}}'.length);
  });

  it('reemplaza el texto seleccionado al insertar un bloque y muestra los ejemplos de sintaxis', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: 'Editar: Plantilla de prueba 1' }));
    const body = screen.getByLabelText(/^Texto del contrato/) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: 'XXXX' } });
    body.setSelectionRange(0, 4);
    const catalog = within(screen.getByRole('complementary', { name: 'Variables y bloques disponibles' }));
    expect(catalog.getByText('Condicional')).toBeInTheDocument();
    expect(catalog.getAllByText(/\{\{#si contrato\.deposito\}\}/).length).toBeGreaterThan(0);
    await user.click(catalog.getByRole('button', { name: 'Insertar: Lista' }));
    expect(body.value).toContain('{{#cada garantes como g}}');
    expect(body.value).not.toContain('XXXX');
  });

  it('inserta un campo, un resumen y un bloque de lista desde el catálogo', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: 'Editar: Plantilla de prueba 1' }));
    const body = screen.getByLabelText(/^Texto del contrato/) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: '{{garante.dniConPuntos}}' }));
    await user.click(screen.getByRole('button', { name: '{{garantes.cantidad}}' }));
    await user.click(screen.getByRole('button', { name: 'Insertar el bloque: garantes' }));
    expect(body.value).toBe('{{garante.dniConPuntos}}{{garantes.cantidad}}{{#cada garantes}}\n{{item.nombreCompleto}}\n{{/cada}}\n');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('elimina una plantilla tras confirmar', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: 'Eliminar: Plantilla de prueba 2' }));
    expect(screen.getByText(/Se elimina la plantilla "Plantilla de prueba 2"/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/contract-templates/t2');
    expect(writes()[0][1].method).toBe('DELETE');
    expect(toast.success).toHaveBeenCalledWith('Plantilla eliminada');
  });

  it('cancelar la confirmación no elimina, y un error al eliminar se avisa', async () => {
    apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') throw new Error('boom');
      return list([template(1)]);
    });
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await user.click(await screen.findByRole('button', { name: 'Eliminar: Plantilla de prueba 1' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(writes()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Eliminar: Plantilla de prueba 1' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No se pudo eliminar la plantilla'));
  });

  it('al eliminar el último de una página vuelve a la anterior', async () => {
    apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') return {};
      return list([template(11)], { total: 11, totalPages: 2, page: path.includes('page=2') ? 2 : 1 });
    });
    const user = userEvent.setup();
    renderEs(<ContractTemplatesPage />);
    await screen.findByText('Plantilla de prueba 11');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/contract-templates?page=2&limit=10'));
    await user.click(await screen.findByRole('button', { name: 'Eliminar: Plantilla de prueba 11' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(apiClient.mock.calls.filter((c) => String(c[0]).includes('page=1')).length).toBeGreaterThan(1));
  });
});
