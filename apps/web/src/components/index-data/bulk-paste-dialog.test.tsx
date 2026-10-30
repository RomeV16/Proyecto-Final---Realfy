// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

import { ApiRequestError } from '@/lib/api-client';
import { BulkPasteDialog } from './bulk-paste-dialog';

function setup(initialType: IndexType = IndexType.IPC) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderEs(<BulkPasteDialog open initialType={initialType} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved, user: userEvent.setup() };
}

describe('BulkPasteDialog', () => {
  beforeEach(() => {
    apiClient.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
  });

  it('no permite guardar sin líneas', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('lee las líneas y envía todas juntas', async () => {
    apiClient.mockResolvedValue({});
    const { user, onSaved } = setup();
    await user.click(screen.getByLabelText('Una línea por período'));
    await user.paste('2026-08, 1,7\n2026-09; 1,9');
    expect(screen.getByText('2 valores listos')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar 2 valores' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(IndexType.IPC));
    const [path, init] = apiClient.mock.calls[0];
    expect(path).toBe('/index-data/bulk');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual([
      { indexType: 'IPC', period: '2026-08-01T00:00:00.000Z', value: '1.7', source: 'manual' },
      { indexType: 'IPC', period: '2026-09-01T00:00:00.000Z', value: '1.9', source: 'manual' },
    ]);
    expect(toast.success).toHaveBeenCalledWith('2 valores guardados');
  });

  it('muestra los errores por línea y bloquea el envío', async () => {
    const { user } = setup();
    await user.click(screen.getByLabelText('Una línea por período'));
    await user.paste('2026-13, 1\n2026-01, 1\n2026-01, 2\nbasura');
    expect(screen.getByText('3 líneas con error')).toBeInTheDocument();
    expect(screen.getByText(/Línea 1: período inválido/)).toBeInTheDocument();
    expect(screen.getByText(/Línea 3: período repetido/)).toBeInTheDocument();
    expect(screen.getByText(/Línea 4: no se reconoce/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar 1 valor' })).toBeDisabled();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('cambia a fechas diarias con un índice diario', async () => {
    apiClient.mockResolvedValue({});
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText('Índice'), IndexType.UVA);
    await user.click(screen.getByLabelText('Una línea por período'));
    await user.paste('2026-10-30, 37,17');
    await user.click(screen.getByRole('button', { name: 'Guardar 1 valor' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    expect(JSON.parse(apiClient.mock.calls[0][1].body)[0]).toMatchObject({
      indexType: 'UVA',
      period: '2026-10-30T00:00:00.000Z',
      value: '37.17',
    });
  });

  it('muestra el mensaje de la API cuando falla', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(400, 'Bad', 'Valor fuera de rango'));
    const { user, onSaved } = setup();
    await user.click(screen.getByLabelText('Una línea por período'));
    await user.paste('2026-08, 1');
    await user.click(screen.getByRole('button', { name: 'Guardar 1 valor' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Valor fuera de rango'));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('usa el mensaje genérico ante un error desconocido y cancela', async () => {
    apiClient.mockRejectedValue(new Error('boom'));
    const { user, onClose } = setup();
    await user.click(screen.getByLabelText('Una línea por período'));
    await user.paste('2026-08, 1');
    await user.click(screen.getByRole('button', { name: 'Guardar 1 valor' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('No se pudieron guardar los valores'),
    );
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
  });
});
