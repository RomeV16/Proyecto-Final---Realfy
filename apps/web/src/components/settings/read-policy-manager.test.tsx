// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_READ_POLICY, UserRole } from '@realfy/shared';
import { renderEs } from '../index-data/test-utils';

const { apiClient, toast, auth, invalidate } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  auth: { user: { id: 'me', role: 'Admin' } },
  invalidate: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/toast', () => ({ toast }));
vi.mock('@/lib/read-access', () => ({ invalidateReadAccess: invalidate, useReadAccess: () => null }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: auth.user }),
  useOptionalAuth: () => ({ user: auth.user }),
}));

import { ApiRequestError } from '@/lib/api-client';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ReadPolicyManager } from './read-policy-manager';

function renderManager() {
  return renderEs(
    <ConfirmProvider>
      <ReadPolicyManager />
    </ConfirmProvider>,
  );
}

const box = (resource: string, role: string) =>
  screen.getAllByRole('checkbox', { name: new RegExp(`${resource}.* — ${role}$`) })[0] as HTMLInputElement;

describe('ReadPolicyManager', () => {
  beforeEach(() => {
    apiClient.mockReset();
    toast.success.mockReset();
    invalidate.mockReset();
    auth.user = { id: 'me', role: 'Admin' };
    apiClient.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/tenants/me/read-policy' && init?.method === 'PUT') return JSON.parse(init.body as string);
      if (path === '/tenants/me/read-policy') return DEFAULT_READ_POLICY;
      throw new Error(`inesperado: ${path}`);
    });
  });

  it('muestra los recursos por rol, con el Admin fijo y nada para guardar al inicio', async () => {
    renderManager();
    expect((await screen.findAllByText('Cuentas bancarias (CBU y alias)'))[0]).toBeInTheDocument();
    expect(screen.getAllByText('Documento (DNI y CUIT)')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Auditoría')[0]).toBeInTheDocument();
    expect(box('Cuentas bancarias', 'Administrador')).toBeChecked();
    expect(box('Cuentas bancarias', 'Administrador')).toBeDisabled();
    expect(box('Cuentas bancarias', 'Ventas')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('un usuario que no es Admin ve el aviso y no consulta la política', () => {
    auth.user = { id: 'x', role: 'Gerente' };
    renderManager();
    expect(screen.getByText(/Solo el administrador/)).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('guarda con confirmación la política editada y refresca el acceso', async () => {
    const user = userEvent.setup();
    renderManager();
    await screen.findAllByText('Auditoría');

    await user.click(box('Cuentas bancarias', 'Ventas'));
    expect(box('Cuentas bancarias', 'Ventas')).not.toBeChecked();
    expect(screen.getByText('Hay cambios sin guardar')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await user.click(await screen.findByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Permisos guardados'));
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT');
    const sent = JSON.parse(put![1].body);
    expect(sent['persons.bankAccounts']).not.toContain(UserRole.Ventas);
    expect(sent['persons.bankAccounts']).toContain(UserRole.Admin);
    expect(sent['persons.document']).toContain(UserRole.Ventas);
    expect(invalidate).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('si el Admin cancela la confirmación no se envía nada', async () => {
    const user = userEvent.setup();
    renderManager();
    await screen.findAllByText('Auditoría');
    await user.click(box('Auditoría', 'Soporte'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(apiClient.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('muestra el error de la API si no se puede guardar y conserva los cambios', async () => {
    const user = userEvent.setup();
    renderManager();
    await screen.findAllByText('Auditoría');
    apiClient.mockRejectedValueOnce(
      new ApiRequestError(500, 'INTERNAL_ERROR', 'No se pudo guardar', undefined, 'corr-1'),
    );
    await user.click(box('Auditoría', 'Soporte'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await user.click(await screen.findByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(box('Auditoría', 'Soporte')).not.toBeChecked();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('"Abrir todo" restablece la política por defecto en el borrador sin guardar', async () => {
    apiClient.mockImplementation(async () => ({
      ...DEFAULT_READ_POLICY,
      audit: [UserRole.Admin],
    }));
    const user = userEvent.setup();
    renderManager();
    await screen.findAllByText('Auditoría');
    expect(box('Auditoría', 'Ventas')).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Abrir todo' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Abrir todo' }));
    await waitFor(() => expect(box('Auditoría', 'Ventas')).toBeChecked());
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
  });

  it('si no carga la política muestra el error', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'Sin conexión', undefined, 'c'));
    renderManager();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
