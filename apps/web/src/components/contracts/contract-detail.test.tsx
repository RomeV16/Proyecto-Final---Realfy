// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/contracts/c-1',
}));
vi.mock('./closure-summary', () => ({ ClosureSummary: () => null }));
vi.mock('./commission-config', () => ({ CommissionConfig: () => null }));
vi.mock('./generate-document-modal', () => ({ GenerateDocumentModal: () => null }));
vi.mock('./adjustment-timeline', () => ({ AdjustmentTimeline: () => null }));

import { ApiRequestError } from '@/lib/api-client';
import { ContractDetailView } from './contract-detail';

function contract(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    contractType: 'Alquiler',
    status: 'Borrador',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2028-01-01T00:00:00.000Z',
    rentAmount: '100000',
    rentCurrency: 'ARS',
    isActive: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    property: { id: 'p-1', title: 'Depto de prueba' },
    persons: [],
    guarantees: [],
    adjustments: [],
    schedules: [],
    ...overrides,
  };
}

/** Responde GET con el contrato y delega el resto en `onPost`. */
function mockApi(
  getContract: () => unknown,
  onPost: () => Promise<unknown> = () => Promise.resolve({}),
) {
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return onPost();
    if (path === '/contracts/c-1') return Promise.resolve(getContract());
    return Promise.resolve({});
  });
}

async function renderDetail() {
  renderEs(<ContractDetailView contractId="c-1" />);
  await screen.findByRole('heading', { name: 'Depto de prueba' });
  return userEvent.setup();
}

const activateButton = () => screen.queryByRole('button', { name: 'Activar contrato' });

describe('ContractDetailView — activación', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });

  it.each(['Admin', 'Gerente', 'Ventas'])('%s ve el botón en un borrador', async (role) => {
    auth.role = role;
    mockApi(() => contract());
    await renderDetail();
    expect(activateButton()).toBeInTheDocument();
    expect(screen.getByText(/Este contrato es un borrador/)).toBeInTheDocument();
  });

  it.each(['Lectura', 'Liquidaciones', 'Soporte'])('%s no ve el botón', async (role) => {
    auth.role = role;
    mockApi(() => contract());
    await renderDetail();
    expect(activateButton()).not.toBeInTheDocument();
  });

  it.each(['Activo', 'Vencido', 'Rescindido', 'Archivado'])(
    'no se ofrece activar un contrato %s',
    async (status) => {
      mockApi(() => contract({ status }));
      await renderDetail();
      expect(activateButton()).not.toBeInTheDocument();
    },
  );

  it('pide confirmación, activa y vuelve a leer el contrato', async () => {
    let status = 'Borrador';
    mockApi(
      () => contract({ status }),
      async () => {
        status = 'Activo';
        return {};
      },
    );
    const user = await renderDetail();

    await user.click(activateButton()!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('la propiedad queda como alquilada');
    expect(apiClient).not.toHaveBeenCalledWith('/contracts/c-1/activate', expect.anything());

    await user.click(screen.getByRole('button', { name: 'Sí, activar' }));

    await waitFor(() => expect(screen.getByText('Contrato activado')).toBeInTheDocument());
    expect(apiClient).toHaveBeenCalledWith('/contracts/c-1/activate', { method: 'POST' });
    await waitFor(() => expect(activateButton()).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('un contrato que no es de alquiler usa el texto sin propiedad alquilada', async () => {
    mockApi(() => contract({ contractType: 'Venta' }));
    const user = await renderDetail();
    await user.click(activateButton()!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toHaveTextContent('alquilada');
  });

  it('cancelar cierra el diálogo sin llamar a la API', async () => {
    mockApi(() => contract());
    const user = await renderDetail();
    await user.click(activateButton()!);
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiClient).not.toHaveBeenCalledWith('/contracts/c-1/activate', expect.anything());
  });

  it('mientras activa, el diálogo queda bloqueado', async () => {
    let release: () => void = () => {};
    mockApi(
      () => contract(),
      () => new Promise((resolve) => (release = () => resolve({}))),
    );
    const user = await renderDetail();
    await user.click(activateButton()!);
    await user.click(await screen.findByRole('button', { name: 'Sí, activar' }));

    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sí, activar' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('CONTRACT_NOT_ACTIVATABLE muestra la lista de motivos y no el aviso de error', async () => {
    mockApi(
      () => contract(),
      () =>
        Promise.reject(
          new ApiRequestError(400, 'CONTRACT_NOT_ACTIVATABLE', 'no activable', {
            problems: [{ code: 'MISSING_INQUILINO' }, { code: 'MISSING_PROPIETARIO' }],
          }),
        ),
    );
    const user = await renderDetail();
    await user.click(activateButton()!);
    await user.click(await screen.findByRole('button', { name: 'Sí, activar' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se puede activar el contrato:');
    expect(alert).toHaveTextContent('Falta cargar al menos un inquilino.');
    expect(alert).toHaveTextContent('Falta cargar al menos un propietario.');
    expect(screen.queryByText(/Este contrato es un borrador/)).not.toBeInTheDocument();
    expect(screen.queryByText('no activable')).not.toBeInTheDocument();
    expect(activateButton()).toBeInTheDocument();
  });

  it('otro error de la API muestra su mensaje', async () => {
    mockApi(
      () => contract(),
      () => Promise.reject(new ApiRequestError(400, 'INVALID_TRANSITION', 'Transición inválida')),
    );
    const user = await renderDetail();
    await user.click(activateButton()!);
    await user.click(await screen.findByRole('button', { name: 'Sí, activar' }));
    expect(await screen.findByText('Transición inválida')).toBeInTheDocument();
  });

  it('un fallo sin código de la API muestra el mensaje genérico', async () => {
    mockApi(
      () => contract(),
      () => Promise.reject(new Error('red caída')),
    );
    const user = await renderDetail();
    await user.click(activateButton()!);
    await user.click(await screen.findByRole('button', { name: 'Sí, activar' }));
    expect(await screen.findByText('No se pudo activar el contrato')).toBeInTheDocument();
  });
});

describe('ContractDetailView — rescisión', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });

  it('solo Admin y Gerente ven Rescindir en un contrato activo', async () => {
    auth.role = 'Ventas';
    mockApi(() => contract({ status: 'Activo' }));
    await renderDetail();
    expect(screen.queryByRole('button', { name: 'Rescindir Contrato' })).not.toBeInTheDocument();
  });

  it('confirma con el foco en Cancelar y rescinde', async () => {
    let status = 'Activo';
    mockApi(
      () => contract({ status }),
      async () => {
        status = 'Rescindido';
        return {};
      },
    );
    const user = await renderDetail();
    await user.click(screen.getByRole('button', { name: 'Rescindir Contrato' }));
    await screen.findByRole('dialog');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus());

    await user.click(
      screen.getAllByRole('button', { name: 'Rescindir Contrato' }).at(-1)!,
    );
    await waitFor(() => expect(screen.getByText('Contrato rescindido')).toBeInTheDocument());
    expect(apiClient).toHaveBeenCalledWith('/contracts/c-1/terminate', { method: 'POST' });
  });

  it('si la rescisión falla muestra el mensaje de la API', async () => {
    mockApi(
      () => contract({ status: 'Activo' }),
      () => Promise.reject(new ApiRequestError(400, 'X', 'No se pudo')),
    );
    const user = await renderDetail();
    await user.click(screen.getByRole('button', { name: 'Rescindir Contrato' }));
    await screen.findByRole('dialog');
    await user.click(screen.getAllByRole('button', { name: 'Rescindir Contrato' }).at(-1)!);
    expect(await screen.findByText('No se pudo')).toBeInTheDocument();
  });
});
