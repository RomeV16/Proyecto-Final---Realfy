// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { TeamManager } from './team-manager';

const member = (over: Record<string, unknown>) => ({
  id: 'u1',
  email: 'ana@example.test',
  firstName: 'Ana',
  lastName: 'Prueba',
  role: 'Admin',
  status: 'active',
  lastLoginAt: '2026-09-01T15:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  invitationExpiresAt: null,
  invitationExpired: false,
  ...over,
});

const ME = member({ id: 'me', email: 'yo@example.test', firstName: 'Yo', lastName: 'Mismo' });
const VENTAS = member({ id: 'u2', email: 'beto@example.test', firstName: 'Beto', lastName: 'Ventas', role: 'Ventas' });
const BAJA = member({ id: 'u3', email: 'carla@example.test', firstName: 'Carla', lastName: 'Baja', role: 'Lectura', status: 'inactive', lastLoginAt: null });
const INVITED = member({
  id: 'i1',
  email: 'nuevo@example.test',
  firstName: null,
  lastName: null,
  role: 'Gerente',
  status: 'invited',
  lastLoginAt: null,
  invitationExpiresAt: '2026-12-31T00:00:00.000Z',
});
const EXPIRED = member({ ...INVITED, id: 'i2', email: 'vencida@example.test', invitationExpired: true });

const LINK = {
  id: 'x1',
  email: 'nuevo@example.test',
  expiresAt: '2026-12-31T15:00:00.000Z',
  token: 'tok',
  link: 'https://app.example.test/auth/accept-invitation?token=tok',
  emailSent: false,
};

let team: unknown[];
function mockApi(handlers: Record<string, () => unknown> = {}) {
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    if (handlers[key]) return Promise.resolve().then(handlers[key]);
    if (key === 'GET /users') return Promise.resolve(team);
    return Promise.resolve({});
  });
}

async function setup() {
  const user = userEvent.setup();
  renderEs(
    <ConfirmProvider>
      <TeamManager />
    </ConfirmProvider>,
  );
  await screen.findByRole('table');
  return { user, table: () => within(screen.getByRole('table')) };
}

describe('TeamManager', () => {
  beforeEach(() => {
    apiClient.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    auth.user = { id: 'me', role: 'Admin' };
    team = [ME, VENTAS, BAJA, INVITED, EXPIRED];
    mockApi();
  });

  it('lista al equipo con su estado', async () => {
    const { table } = await setup();
    expect(await table().findByText('Beto Ventas')).toBeInTheDocument();
    expect(table().getAllByText('Activo')).toHaveLength(2);
    expect(table().getByText('Desactivado')).toBeInTheDocument();
    expect(table().getByText('Invitado')).toBeInTheDocument();
    expect(table().getByText('Invitación vencida')).toBeInTheDocument();
    expect(table().getAllByText('Pendiente de aceptar')).toHaveLength(2);
    expect(table().getByText('Todavía no ingresó')).toBeInTheDocument();
    expect(table().getAllByText(/^Vence el .*2026/)).toHaveLength(2);
  });

  it('no ofrece darse de baja a uno mismo', async () => {
    const { table } = await setup();
    const row = table().getByText('Yo Mismo').closest('tr')!;
    expect(within(row).queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Cambiar rol' })).toBeInTheDocument();
  });

  it('invita: valida, crea y muestra el enlace para compartir', async () => {
    mockApi({ 'POST /users/invite': () => LINK });
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Invitar usuario' }));
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Crear invitación' }));
    expect(within(dialog).getByText('Este campo es obligatorio')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Correo electrónico/), 'no-es-correo');
    await user.click(within(dialog).getByRole('button', { name: 'Crear invitación' }));
    expect(within(dialog).getByText('Ingresá un correo electrónico válido')).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText(/^Correo electrónico/));
    await user.type(within(dialog).getByLabelText(/^Correo electrónico/), 'nuevo@example.test');
    await user.selectOptions(within(dialog).getByLabelText(/^Rol/), 'Gerente');
    await user.click(within(dialog).getByRole('button', { name: 'Crear invitación' }));

    const share = await screen.findByRole('dialog', {}, { timeout: 3000 });
    await waitFor(() => expect(within(share).getByText('Enlace de invitación')).toBeInTheDocument());
    const call = apiClient.mock.calls.find(([p]) => p === '/users/invite')!;
    expect(JSON.parse(call[1].body)).toEqual({ email: 'nuevo@example.test', role: 'Gerente' });
    expect(within(share).getByLabelText('Enlace')).toHaveValue(LINK.link);
    expect(within(share).getByText(/no envía correos/)).toBeInTheDocument();
    expect(within(share).getByText(/Sirve una sola vez y vence el/)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Invitación creada');
  });

  it('copia el enlace y avisa si el portapapeles falla', async () => {
    mockApi({ 'POST /users/i1/invitation/resend': () => ({ ...LINK, emailSent: true }) });
    const { user, table } = await setup();
    const row = table().getByText('nuevo@example.test').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Reenviar invitación' }));
    const share = await screen.findByRole('dialog');
    expect(await within(share).findByText('También lo enviamos por correo.')).toBeInTheDocument();

    await user.click(within(share).getByRole('button', { name: 'Copiar enlace' }));
    expect(await navigator.clipboard.readText()).toBe(LINK.link);
    expect(toast.success).toHaveBeenCalledWith('Enlace copiado');

    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    await user.click(within(share).getByRole('button', { name: 'Copiar enlace' }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('No se pudo copiar'));

    await user.click(within(share).getByRole('button', { name: 'Listo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('muestra los errores de invitar según el código', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Invitar usuario' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Correo electrónico/), 'beto@example.test');

    apiClient.mockRejectedValueOnce(new ApiRequestError(400, 'USER_ALREADY_EXISTS', 'x'));
    await user.click(within(dialog).getByRole('button', { name: 'Crear invitación' }));
    expect(await within(dialog).findByText(/Ya hay un usuario con este correo/)).toBeInTheDocument();

    apiClient.mockRejectedValueOnce(new ApiRequestError(409, 'INVITATION_ALREADY_PENDING', 'x'));
    await user.click(within(dialog).getByRole('button', { name: 'Crear invitación' }));
    expect(await within(dialog).findByText(/invitación pendiente para este correo/)).toBeInTheDocument();

    apiClient.mockRejectedValueOnce(new Error('boom'));
    await user.click(within(dialog).getByRole('button', { name: 'Crear invitación' }));
    expect(await within(dialog).findByText('No se pudo crear la invitación')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('genera el enlace para cambiar la contraseña de un usuario activo', async () => {
    mockApi({
      'POST /users/u2/password-reset-link': () => ({ ...LINK, email: 'beto@example.test', link: 'https://app.example.test/auth/password-reset?token=r' }),
    });
    const { user, table } = await setup();
    const row = table().getByText('Beto Ventas').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Enlace para cambiar contraseña' }));
    const share = await screen.findByRole('dialog');
    expect(await within(share).findByText('Enlace para cambiar la contraseña')).toBeInTheDocument();
    expect(within(share).getByLabelText('Enlace')).toHaveValue('https://app.example.test/auth/password-reset?token=r');
    const inactiveRow = table().getByText('Carla Baja').closest('tr')!;
    expect(within(inactiveRow).queryByRole('button', { name: 'Enlace para cambiar contraseña' })).not.toBeInTheDocument();
  });

  it('cambia el rol', async () => {
    const { user, table } = await setup();
    const row = table().getByText('Beto Ventas').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Cambiar rol' }));
    const dialog = screen.getByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Guardar rol' });
    expect(save).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText(/^Rol de Beto Ventas/), 'Gerente');
    await user.click(save);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Rol actualizado'));
    const call = apiClient.mock.calls.find(([p]) => p === '/users/u2')!;
    expect(call[1].method).toBe('PATCH');
    expect(JSON.parse(call[1].body)).toEqual({ role: 'Gerente' });
  });

  it('explica por qué no se pudo cambiar el rol', async () => {
    const { user, table } = await setup();
    const row = table().getByText('Yo Mismo').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Cambiar rol' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Rol de Yo Mismo/), 'Gerente');
    apiClient.mockRejectedValueOnce(new ApiRequestError(409, 'LAST_ADMIN', 'x'));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar rol' }));
    expect(await within(dialog).findByText(/al menos un administrador activo/)).toBeInTheDocument();
  });

  it('desactiva con confirmación y reactiva', async () => {
    const { user, table } = await setup();
    const row = table().getByText('Beto Ventas').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Desactivar' }));
    const confirmDialog = screen.getByRole('dialog');
    expect(within(confirmDialog).getByText(/Beto Ventas no va a poder ingresar/)).toBeInTheDocument();

    await user.click(within(confirmDialog).getByRole('button', { name: 'Cancelar' }));
    expect(apiClient.mock.calls.some(([p]) => p === '/users/u2/deactivate')).toBe(false);

    await user.click(within(row).getByRole('button', { name: 'Desactivar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Usuario desactivado'));
    expect(apiClient.mock.calls.find(([p]) => p === '/users/u2/deactivate')![1].method).toBe('POST');

    const inactive = table().getByText('Carla Baja').closest('tr')!;
    await user.click(within(inactive).getByRole('button', { name: 'Activar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivar' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Usuario reactivado'));
    expect(apiClient.mock.calls.some(([p]) => p === '/users/u3/reactivate')).toBe(true);
  });

  it('avisa el motivo cuando una acción falla', async () => {
    const { user, table } = await setup();
    const row = table().getByText('Beto Ventas').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Desactivar' }));
    apiClient.mockRejectedValueOnce(new ApiRequestError(409, 'LAST_ADMIN', 'x'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desactivar' }));
    expect(await screen.findByText(/al menos un administrador activo/)).toBeInTheDocument();

    apiClient.mockRejectedValueOnce(new Error('boom'));
    await user.click(within(row).getByRole('button', { name: 'Enlace para cambiar contraseña' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(screen.queryByText(/al menos un administrador activo/)).not.toBeInTheDocument();
  });

  it('el Gerente ve el equipo en solo lectura', async () => {
    auth.user = { id: 'g1', role: 'Gerente' };
    const { table } = await setup();
    expect(screen.queryByRole('button', { name: 'Invitar usuario' })).not.toBeInTheDocument();
    expect(table().queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Solo un administrador puede invitar o modificar usuarios.')).toBeInTheDocument();
    expect(table().getByText('Beto Ventas')).toBeInTheDocument();
  });

  it.each(['Ventas', 'Lectura'])('%s no ve el equipo ni lo pide', async (role) => {
    auth.user = { id: 'x', role };
    renderEs(
      <ConfirmProvider>
        <TeamManager />
      </ConfirmProvider>,
    );
    expect(screen.getByText('Solo un administrador puede invitar o modificar usuarios.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('si no se pudo cargar, muestra el error en lugar de la tabla', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'x'));
    renderEs(
      <ConfirmProvider>
        <TeamManager />
      </ConfirmProvider>,
    );
    expect(await screen.findByText(/El servidor tuvo un problema/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
