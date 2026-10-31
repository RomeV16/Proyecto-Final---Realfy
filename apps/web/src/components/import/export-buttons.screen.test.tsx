// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';

const { downloadFile, toastError } = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/download', () => ({
  downloadFile: (...a: unknown[]) => downloadFile(...a),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));

import { ExportButtons } from './export-buttons';

function mount(entityPath = 'properties') {
  render(
    <NextIntlClientProvider locale="es" messages={es}>
      <ExportButtons entityPath={entityPath} />
    </NextIntlClientProvider>,
  );
  return userEvent.setup();
}

describe('ExportButtons', () => {
  beforeEach(() => {
    downloadFile.mockReset();
    downloadFile.mockResolvedValue(undefined);
    toastError.mockReset();
  });

  it('el menú arranca cerrado y se abre y se cierra con el botón', async () => {
    const user = mount();
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar Excel' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).not.toBeInTheDocument();
  });

  it('se cierra al hacer clic fuera', async () => {
    const user = mount();
    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    await user.click(document.body);
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).not.toBeInTheDocument();
  });

  it('descarga el CSV con la ruta y el nombre esperados', async () => {
    const user = mount('persons');
    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(downloadFile).toHaveBeenCalledWith('/persons/export/csv', 'persons-export.csv', { preferServerName: true });
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).not.toBeInTheDocument();
  });

  it('descarga el Excel con extensión xlsx', async () => {
    const user = mount();
    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    await user.click(screen.getByRole('button', { name: 'Exportar Excel' }));
    expect(downloadFile).toHaveBeenCalledWith('/properties/export/excel', 'properties-export.xlsx', {
      preferServerName: true,
    });
  });

  it('deshabilita el botón mientras exporta', async () => {
    let finish: () => void = () => {};
    downloadFile.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const user = mount();
    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Exportar' })).toBeEnabled());
  });

  it('avisa si falla la descarga', async () => {
    downloadFile.mockRejectedValue(new Error('x'));
    const user = mount();
    await user.click(screen.getByRole('button', { name: 'Exportar' }));
    await user.click(screen.getByRole('button', { name: 'Exportar Excel' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('No se pudo descargar')));
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeEnabled();
  });
});
