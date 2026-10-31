// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_OPERATIONAL_DEFAULTS } from '@realfy/shared';
import { renderEs } from '../index-data/test-utils';

const { apiClient, toast, auth } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  auth: { user: { id: 'me', role: 'Admin' } },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/toast', () => ({ toast }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: auth.user }),
  useOptionalAuth: () => ({ user: auth.user }),
}));

import { ApiRequestError } from '@/lib/api-client';
import { OperationalDefaultsManager } from './operational-defaults-form';

describe('OperationalDefaultsManager', () => {
  beforeEach(() => {
    apiClient.mockReset();
    toast.success.mockReset();
    auth.user = { id: 'me', role: 'Admin' };
    apiClient.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === 'PUT' ? JSON.parse(init.body as string) : DEFAULT_OPERATIONAL_DEFAULTS,
    );
  });

  it('muestra los valores de fábrica en cada campo', async () => {
    renderEs(<OperationalDefaultsManager />);

    expect(await screen.findByLabelText(/Día de vencimiento/)).toHaveValue('10');
    expect(screen.getByLabelText(/Días de anticipación/)).toHaveValue('10');
    expect(screen.getByLabelText(/Rezago del IPC/)).toHaveValue('2');
    expect(screen.getByLabelText(/Comisión de administración/)).toHaveValue('7');
    expect(screen.getByLabelText(/Honorarios por alta/)).toHaveValue('5');
    expect(screen.getByLabelText(/Honorarios de venta, construido/)).toHaveValue('3');
    expect(screen.getByLabelText(/Tasación \(USD\)/)).toHaveValue('100');
    expect(screen.getByLabelText(/Umbral de anticipo/)).toHaveValue('2');
    expect(screen.getByLabelText(/Primer recordatorio/)).toHaveValue('5');
    expect(screen.getByLabelText(/Amarillo hasta/)).toHaveValue('60');
    expect(apiClient).toHaveBeenCalledWith('/tenants/me/operational-defaults');
  });

  it('guarda los valores editados con el cuerpo anidado de la API', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);
    const dueDay = await screen.findByLabelText(/Día de vencimiento/);
    await user.clear(dueDay);
    await user.type(dueDay, '5');
    const commission = screen.getByLabelText(/Comisión de administración/);
    await user.clear(commission);
    await user.type(commission, '7,5');

    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Valores por defecto guardados'));
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    const body = JSON.parse(put[1].body);
    expect(body).toMatchObject({
      dueDay: 5,
      commissionPct: 7.5,
      fees: { alta: 5, renovacion: 5, ventaConstruido: 3, ventaLote: 5 },
      collectionCadence: { firstReminderDays: 5, everyDays: 5 },
      expiryLight: { redDays: 0, yellowDays: 60 },
    });
  });

  it('un valor inválido se marca en el campo y no se envía', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);
    const dueDay = await screen.findByLabelText(/Día de vencimiento/);
    await user.clear(dueDay);
    await user.type(dueDay, '40');

    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));

    expect(await screen.findByText('El valor está fuera del rango permitido')).toBeInTheDocument();
    expect(dueDay).toHaveAttribute('aria-invalid', 'true');
    expect(apiClient.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('volver a los valores de fábrica restaura los campos', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);
    const dueDay = await screen.findByLabelText(/Día de vencimiento/);
    await user.clear(dueDay);
    await user.type(dueDay, '3');

    await user.click(screen.getByRole('button', { name: 'Volver a los valores de fábrica' }));

    expect(dueDay).toHaveValue('10');
  });

  it('un error de la API al guardar se muestra con ErrorNotice', async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') throw new ApiRequestError(403, 'FORBIDDEN', 'No autorizado');
      return DEFAULT_OPERATIONAL_DEFAULTS;
    });
    renderEs(<OperationalDefaultsManager />);
    await screen.findByLabelText(/Día de vencimiento/);

    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('FORBIDDEN');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('un error al cargar se muestra y no deja el formulario', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'Caído'));
    renderEs(<OperationalDefaultsManager />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Día de vencimiento/)).not.toBeInTheDocument();
  });

  it('quien no es Admin ni Gerente ve el aviso y no consulta los valores', () => {
    auth.user = { id: 'x', role: 'Ventas' };
    renderEs(<OperationalDefaultsManager />);
    expect(screen.getByText(/Solo Administración y Gerencia/)).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});
