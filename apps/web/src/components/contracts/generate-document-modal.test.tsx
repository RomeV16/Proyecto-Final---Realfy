// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, downloadFile } = vi.hoisted(() => ({ apiClient: vi.fn(), downloadFile: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/download', () => ({ downloadFile: (...args: unknown[]) => downloadFile(...args) }));

import { ApiRequestError } from '@/lib/api-client';
import { GenerateDocumentModal } from './generate-document-modal';

const TEMPLATES = [
  { id: 'tpl-1', name: 'Locación demo', contractType: 'Alquiler', variables: ['contrato.monto'], isDefault: true },
];

beforeEach(() => {
  apiClient.mockReset();
  downloadFile.mockReset();
  apiClient.mockImplementation(async (path: string) =>
    path.endsWith('/available-templates') ? TEMPLATES : { 'contrato.monto': '100.000,00' },
  );
});

async function openModal(onClose = vi.fn()) {
  renderEs(<GenerateDocumentModal open contractId="c1" onClose={onClose} />);
  await screen.findByLabelText('Seleccioná una plantilla');
  return onClose;
}

describe('GenerateDocumentModal: fecha de firma', () => {
  it('envía la fecha de firma elegida junto con la plantilla y el formato', async () => {
    downloadFile.mockResolvedValue(undefined);
    const onClose = await openModal();
    fireEvent.change(screen.getByLabelText('Fecha de firma (opcional)'), { target: { value: '2026-07-01' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generar y descargar' }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    expect(downloadFile.mock.calls[0][0]).toBe('/contracts/c1/generate-document');
    expect(JSON.parse(downloadFile.mock.calls[0][2].init.body)).toEqual({ templateId: 'tpl-1', format: 'pdf', signingDate: '2026-07-01' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('sin fecha de firma no manda el campo', async () => {
    downloadFile.mockResolvedValue(undefined);
    await openModal();
    await userEvent.setup().click(screen.getByRole('button', { name: 'DOCX (Word)' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generar y descargar' }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    expect(JSON.parse(downloadFile.mock.calls[0][2].init.body)).toEqual({ templateId: 'tpl-1', format: 'docx' });
  });

  it('una plantilla mal formada muestra el mensaje de la API', async () => {
    downloadFile.mockRejectedValue(
      new ApiRequestError(400, 'TEMPLATE_SYNTAX_ERROR', 'Bloque sin cerrar (línea 4, columna 2)', { error: 'TEMPLATE_SYNTAX_ERROR' }),
    );
    await openModal();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generar y descargar' }));
    expect(await screen.findByText('La plantilla está mal formada: Bloque sin cerrar (línea 4, columna 2)')).toBeInTheDocument();
  });

  it('cualquier otro error muestra el aviso genérico', async () => {
    downloadFile.mockRejectedValue(new Error('boom'));
    await openModal();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Generar y descargar' }));
    expect(await screen.findByText('Error al generar el documento')).toBeInTheDocument();
  });
});
