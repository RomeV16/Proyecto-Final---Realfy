// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_OPERATIONAL_DEFAULTS, type OperationalDefaults } from '@realfy/shared';
import { renderEs } from '../index-data/test-utils';

const { apiClient, toast } = vi.hoisted(() => ({ apiClient: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/toast', () => ({ toast }));

import { ApiRequestError } from '@/lib/api-client';
import { BillFetchingSettingsForm } from './bill-fetching-settings';

const saved = (billFetching: OperationalDefaults['billFetching']): OperationalDefaults => ({
  ...DEFAULT_OPERATIONAL_DEFAULTS,
  billFetching,
});

describe('BillFetchingSettingsForm', () => {
  beforeEach(() => {
    apiClient.mockReset();
    toast.success.mockReset();
  });

  it('de fábrica está apagada y sin proveedores, con el catálogo completo para elegir', () => {
    renderEs(<BillFetchingSettingsForm saved={saved({ enabled: false, providers: [] })} onSaved={vi.fn()} />);
    expect(screen.getByLabelText(/Consultar a los proveedores todos los días/)).not.toBeChecked();
    for (const name of ['Aguas Cordobesas', 'Ecogas', 'EPEC', 'Municipalidad de Córdoba', 'Rentas de Córdoba']) {
      expect(screen.getByLabelText(name)).not.toBeChecked();
    }
    expect(screen.queryByLabelText('Otro proveedor')).not.toBeInTheDocument();
  });

  it('guarda el interruptor y los proveedores tildados sin perder el resto de los valores', async () => {
    const onSaved = vi.fn();
    apiClient.mockImplementation(async (_path: string, init: RequestInit) => JSON.parse(init.body as string));
    renderEs(<BillFetchingSettingsForm saved={saved({ enabled: false, providers: ['epec'] })} onSaved={onSaved} />);
    expect(screen.getByLabelText('EPEC')).toBeChecked();
    await userEvent.click(screen.getByLabelText(/Consultar a los proveedores todos los días/));
    await userEvent.click(screen.getByLabelText('Rentas de Córdoba'));
    await userEvent.click(screen.getByLabelText('EPEC'));
    await userEvent.click(screen.getByLabelText('Aguas Cordobesas'));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar obtención automática' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [path, init] = apiClient.mock.calls[0];
    expect(path).toBe('/tenants/me/operational-defaults');
    expect(init.method).toBe('PUT');
    const body = JSON.parse(init.body);
    expect(body.billFetching).toEqual({ enabled: true, providers: ['aguas-cordobesas', 'rentas-cordoba'] });
    expect(body.dueDay ?? body.rent).toBeDefined();
    expect(toast.success).toHaveBeenCalledWith('Obtención automática de boletas guardada');
  });

  it('muestra el error de la API si no se pudo guardar', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(400, 'VALIDATION_ERROR', 'Invalid operational defaults'));
    const onSaved = vi.fn();
    renderEs(<BillFetchingSettingsForm saved={saved({ enabled: true, providers: [] })} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar obtención automática' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
