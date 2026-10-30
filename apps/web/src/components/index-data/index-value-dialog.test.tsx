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
import { IndexValueDialog, type IndexValueDraft } from './index-value-dialog';

function setup(draft: IndexValueDraft | null) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  renderEs(<IndexValueDialog draft={draft} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved, user: userEvent.setup() };
}

const NEW_IPC: IndexValueDraft = { indexType: IndexType.IPC, period: '', value: '', editing: false };

describe('IndexValueDialog', () => {
  beforeEach(() => {
    apiClient.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
  });

  it('no muestra nada sin borrador', () => {
    setup(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('da de alta un valor mensual con coma decimal', async () => {
    apiClient.mockResolvedValue({});
    const { user, onSaved } = setup(NEW_IPC);
    expect(screen.getByText('Cargar valor')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Mes'), '2026-09');
    await user.type(screen.getByLabelText('Variación mensual (%)'), '1,9');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(IndexType.IPC));
    const [path, init] = apiClient.mock.calls[0];
    expect(path).toBe('/index-data');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      indexType: 'IPC',
      period: '2026-09-01T00:00:00.000Z',
      value: '1.9',
      source: 'manual',
    });
    expect(toast.success).toHaveBeenCalledWith('Valor guardado');
  });

  it('corrige un valor: índice y período quedan fijos', async () => {
    apiClient.mockResolvedValue({});
    const { user } = setup({
      indexType: IndexType.ICL,
      period: '2026-10-30',
      value: '37.17',
      editing: true,
    });
    expect(screen.getByText('Corregir valor')).toBeInTheDocument();
    expect(screen.getByLabelText('Índice')).toBeDisabled();
    expect(screen.getByLabelText('Fecha')).toBeDisabled();
    const value = screen.getByLabelText('Valor del índice');
    await user.clear(value);
    await user.type(value, '38,5');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    expect(JSON.parse(apiClient.mock.calls[0][1].body)).toEqual({
      indexType: 'ICL',
      period: '2026-10-30T00:00:00.000Z',
      value: '38.5',
      source: 'manual',
    });
  });

  it('cambiar a un índice diario limpia el período', async () => {
    const { user } = setup({ ...NEW_IPC, period: '2026-09' });
    await user.selectOptions(screen.getByLabelText('Índice'), IndexType.UVA);
    expect(screen.getByLabelText('Fecha')).toHaveValue('');
    await user.selectOptions(screen.getByLabelText('Índice'), IndexType.CER);
    expect(screen.getByLabelText('Mes')).toBeInTheDocument();
  });

  it('valida período y valor sin llamar a la API', async () => {
    const { user } = setup(NEW_IPC);
    await user.type(screen.getByLabelText('Variación mensual (%)'), '2.176,21');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByText('Período inválido para este índice')).toBeInTheDocument();
    expect(screen.getByText(/Número inválido/)).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('muestra el mensaje de la API o el genérico al fallar', async () => {
    apiClient.mockRejectedValueOnce(new ApiRequestError(403, 'Forbidden', 'Sin permiso'));
    const { user, onSaved, onClose } = setup({ ...NEW_IPC, period: '2026-09', value: '1' });
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Sin permiso'));

    apiClient.mockRejectedValueOnce(new Error('boom'));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('No se pudo guardar el valor'));
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
  });
});
