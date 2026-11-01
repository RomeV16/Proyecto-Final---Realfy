// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEsWithQuery } from '../index-data/test-utils';

const { apiClient, downloadFile, toast, auth } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  downloadFile: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  auth: { user: { id: 'me', role: 'Admin' } as { id: string; role: string } },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/download', () => ({ downloadFile: (...args: unknown[]) => downloadFile(...args) }));
vi.mock('@/lib/toast', () => ({ toast }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: auth.user }),
  useOptionalAuth: () => ({ user: auth.user }),
}));

import { ApiRequestError } from '@/lib/api-client';
import { ImportBatchDetail, ImportBatchList } from './import-batches';

const batch = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  kind: 'SistemaAnterior',
  status: 'Completado',
  dryRun: false,
  atomic: false,
  startedAt: '2026-11-01T12:00:00.000Z',
  counts: {
    total: 4,
    errors: 1,
    byEntity: {
      Persona: { Creado: 2, Actualizado: 0, SinCambios: 0, Error: 0 },
      Contrato: { Creado: 1, Actualizado: 0, SinCambios: 0, Error: 1 },
    },
  },
  ...over,
});

const rowsFor = (action?: string) => {
  const all = [
    { id: 'r1', entity: 'Persona', externalRef: 'P-1', rowNumber: 1, action: 'Creado', errors: null },
    {
      id: 'r2',
      entity: 'Contrato',
      externalRef: 'C-1',
      rowNumber: 2,
      action: 'Error',
      errors: [{ code: 'REFERENCE_NOT_FOUND', field: 'tenants[0]', message: 'Person not found' }],
    },
  ];
  const data = action ? all.filter((r) => r.action === action) : all;
  return { data, total: data.length };
};

describe('ImportBatchList', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.user = { id: 'me', role: 'Admin' };
  });

  it('lista los lotes con modo, estado, filas y errores, y enlaza al detalle', async () => {
    apiClient.mockResolvedValue([batch(), batch({ id: 'b2', dryRun: true, status: 'Validado', counts: null })]);
    renderEsWithQuery(<ImportBatchList />);

    expect(await screen.findAllByText('Completado')).not.toHaveLength(0);
    expect(screen.getAllByText('Ejecución').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ensayo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Validado').length).toBeGreaterThan(0);
    expect(apiClient).toHaveBeenCalledWith('/import/batches');
    expect(screen.getAllByRole('link')[0]).toHaveAttribute('href', expect.stringContaining('/configuracion/importaciones/b1'));
  });

  it('un lote todo o nada se rotula así', async () => {
    apiClient.mockResolvedValue([batch({ atomic: true })]);
    renderEsWithQuery(<ImportBatchList />);
    expect((await screen.findAllByText('Todo o nada')).length).toBeGreaterThan(0);
  });

  it('sin lotes muestra el estado vacío', async () => {
    apiClient.mockResolvedValue([]);
    renderEsWithQuery(<ImportBatchList />);
    expect(await screen.findByText('Todavía no hay importaciones')).toBeInTheDocument();
  });

  it('un error de la API se muestra como aviso', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'X', 'Fallo del servidor'));
    renderEsWithQuery(<ImportBatchList />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Fallo del servidor');
  });

  it('quien no es Admin ve el aviso y no consulta', () => {
    auth.user = { id: 'x', role: 'Gerente' };
    renderEsWithQuery(<ImportBatchList />);
    expect(screen.getByText(/Solo el administrador/)).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});

describe('ImportBatchDetail', () => {
  beforeEach(() => {
    apiClient.mockReset();
    downloadFile.mockReset();
    toast.error.mockReset();
    auth.user = { id: 'me', role: 'Admin' };
    apiClient.mockImplementation(async (path: string) => {
      if (path === '/import/batches/b1') return batch();
      if (path.startsWith('/import/batches/b1/rows')) {
        const action = new URL(path, 'http://x').searchParams.get('action') ?? undefined;
        return rowsFor(action);
      }
      throw new Error(`inesperado: ${path}`);
    });
  });

  it('muestra el resumen por entidad y el registro de filas con el detalle de los errores', async () => {
    renderEsWithQuery(<ImportBatchDetail id="b1" />);

    expect((await screen.findAllByText('REFERENCE_NOT_FOUND')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Person not found').length).toBeGreaterThan(0);
    expect(screen.getAllByText('P-1').length).toBeGreaterThan(0);
    const summary = screen.getByRole('region', { name: 'Resumen por entidad' });
    expect(within(summary).getByText('Persona')).toBeInTheDocument();
    expect(within(summary).getByText('Contrato')).toBeInTheDocument();
  });

  it('el filtro por acción vuelve a pedir las filas y deja sólo los errores', async () => {
    const user = userEvent.setup();
    renderEsWithQuery(<ImportBatchDetail id="b1" />);
    await screen.findAllByText('P-1');

    await user.selectOptions(screen.getByLabelText('Mostrar filas'), 'Error');

    await waitFor(() => expect(screen.queryAllByText('P-1')).toHaveLength(0));
    expect(screen.getAllByText('C-1').length).toBeGreaterThan(0);
    expect(apiClient).toHaveBeenCalledWith(expect.stringContaining('action=Error'));
  });

  it('descarga los errores como CSV con el filtro vigente', async () => {
    const user = userEvent.setup();
    downloadFile.mockResolvedValue(undefined);
    renderEsWithQuery(<ImportBatchDetail id="b1" />);
    await screen.findAllByText('P-1');

    await user.selectOptions(screen.getByLabelText('Mostrar filas'), 'Error');
    await user.click(await screen.findByRole('button', { name: 'Descargar errores (CSV)' }));

    expect(downloadFile).toHaveBeenCalledWith(
      '/import/batches/b1/rows/csv?action=Error',
      'importacion-error.csv',
      { preferServerName: true },
    );
  });

  it('sin filtro baja todas las filas; si la descarga falla avisa', async () => {
    const user = userEvent.setup();
    downloadFile.mockRejectedValue(new Error('x'));
    renderEsWithQuery(<ImportBatchDetail id="b1" />);
    await screen.findAllByText('P-1');

    await user.click(screen.getByRole('button', { name: 'Descargar (CSV)' }));

    expect(downloadFile).toHaveBeenCalledWith('/import/batches/b1/rows/csv', 'importacion-filas.csv', { preferServerName: true });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No se pudo descargar el archivo'));
  });

  it('un ensayo lo aclara; un todo o nada fallido explica que no se escribió nada', async () => {
    apiClient.mockImplementation(async (path: string) =>
      path === '/import/batches/b1' ? batch({ dryRun: true, status: 'Validado' }) : rowsFor(),
    );
    const { unmount } = renderEsWithQuery(<ImportBatchDetail id="b1" />);
    expect(await screen.findByText('Fue un ensayo: no se escribió nada.')).toBeInTheDocument();
    unmount();

    apiClient.mockImplementation(async (path: string) =>
      path === '/import/batches/b1' ? batch({ atomic: true, status: 'Fallido' }) : rowsFor(),
    );
    renderEsWithQuery(<ImportBatchDetail id="b1" />);
    expect(await screen.findByText(/Ninguna fila se escribió/)).toBeInTheDocument();
  });

  it('avisa cuando hay más filas que las mostradas', async () => {
    apiClient.mockImplementation(async (path: string) =>
      path === '/import/batches/b1' ? batch() : { data: rowsFor().data, total: 900 },
    );
    renderEsWithQuery(<ImportBatchDetail id="b1" />);
    expect(await screen.findByText('Mostrando 2 de 900 filas')).toBeInTheDocument();
  });

  it('un lote inexistente muestra el error', async () => {
    apiClient.mockImplementation(async (path: string) => {
      if (path === '/import/batches/b1') throw new ApiRequestError(404, 'IMPORT_BATCH_NOT_FOUND', 'Import batch not found');
      return rowsFor();
    });
    renderEsWithQuery(<ImportBatchDetail id="b1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Import batch not found');
  });

  it('quien no es Admin ve el aviso', () => {
    auth.user = { id: 'x', role: 'Ventas' };
    renderEsWithQuery(<ImportBatchDetail id="b1" />);
    expect(screen.getByText(/Solo el administrador/)).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});
