// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, push, setStoredUser } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  push: vi.fn(),
  setStoredUser: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
  setStoredUser: (...args: unknown[]) => setStoredUser(...args),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ApiRequestError } from '@/lib/api-client';
import { AcceptInvitationForm } from './accept-invitation-form';
import { ChangePasswordForm } from './change-password-form';
import { PasswordResetForm } from './password-reset-form';

const GOOD = 'ClaveSegura123';

describe('AcceptInvitationForm', () => {
  beforeEach(() => {
    apiClient.mockReset();
    push.mockReset();
    setStoredUser.mockReset();
  });

  async function fill(user: ReturnType<typeof userEvent.setup>, password = GOOD, confirm = GOOD) {
    await user.type(screen.getByLabelText(/^Nombre/), ' Nuria ');
    await user.type(screen.getByLabelText(/^Apellido/), 'Prueba');
    await user.type(screen.getByLabelText(/^Contraseña/), password);
    await user.type(screen.getByLabelText(/^Repetí la contraseña/), confirm);
  }

  it('sin token avisa que falta el enlace', () => {
    renderEs(<AcceptInvitationForm token={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Falta el enlace de invitación');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('valida los campos antes de enviar', async () => {
    const user = userEvent.setup();
    renderEs(<AcceptInvitationForm token="tok" />);
    await user.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));
    expect(screen.getAllByText('Este campo es obligatorio')).toHaveLength(2);
    expect(screen.getByText('Ingresá una contraseña')).toBeInTheDocument();
    await fill(user, 'corta', 'corta');
    await user.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));
    expect(screen.getByText('La contraseña debe tener al menos 8 caracteres')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('crea la cuenta, inicia sesión y entra al panel', async () => {
    apiClient.mockImplementation((path: string) =>
      Promise.resolve(path === '/auth/login' ? { user: { id: 'u1' } } : { email: 'nuria@example.test' }),
    );
    const user = userEvent.setup();
    renderEs(<AcceptInvitationForm token="tok" />);
    await user.clear(screen.getByLabelText(/^Nombre/));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    const [accept, login] = apiClient.mock.calls;
    expect(accept[0]).toBe('/users/accept-invitation');
    expect(JSON.parse(accept[1].body)).toEqual({
      token: 'tok',
      password: GOOD,
      firstName: 'Nuria',
      lastName: 'Prueba',
    });
    expect(login[0]).toBe('/auth/login');
    expect(JSON.parse(login[1].body)).toEqual({ email: 'nuria@example.test', password: GOOD });
    expect(setStoredUser).toHaveBeenCalledWith({ id: 'u1' });
  });

  it.each([
    ['INVITATION_NOT_FOUND', 'no es válido'],
    ['INVITATION_EXPIRED', 'La invitación venció'],
    ['INVITATION_ALREADY_ACCEPTED', 'ya se usó'],
    ['OTRO', 'Mensaje del servidor'],
  ])('muestra el error %s', async (code, text) => {
    apiClient.mockRejectedValue(new ApiRequestError(400, code, 'Mensaje del servidor'));
    const user = userEvent.setup();
    renderEs(<AcceptInvitationForm token="tok" />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(push).not.toHaveBeenCalled();
  });

  it('si la cuenta se crea pero el ingreso falla, lo dice', async () => {
    apiClient.mockImplementation((path: string) =>
      path === '/auth/login' ? Promise.reject(new Error('down')) : Promise.resolve({ email: 'n@example.test' }),
    );
    const user = userEvent.setup();
    renderEs(<AcceptInvitationForm token="tok" />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu cuenta se creó');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('PasswordResetForm', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it('sin token pide el correo y responde con un mensaje neutro', async () => {
    apiClient.mockResolvedValue({ message: 'ok' });
    const user = userEvent.setup();
    renderEs(<PasswordResetForm token={null} />);
    await user.click(screen.getByRole('button', { name: 'Enviar instrucciones' }));
    expect(screen.getByText('Este campo es obligatorio')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Correo electrónico/), 'mal');
    await user.click(screen.getByRole('button', { name: 'Enviar instrucciones' }));
    expect(screen.getByText('Ingresá un correo electrónico válido')).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^Correo electrónico/));
    await user.type(screen.getByLabelText(/^Correo electrónico/), 'ana@example.test');
    await user.click(screen.getByRole('button', { name: 'Enviar instrucciones' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Si la cuenta existe, enviamos las instrucciones');
    expect(apiClient).toHaveBeenCalledWith('/auth/password-reset/request', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByRole('link', { name: 'Volver a iniciar sesión' })).toHaveAttribute('href', '/auth/login');
  });

  it('si el pedido falla muestra el error', async () => {
    apiClient.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    renderEs(<PasswordResetForm token={null} />);
    await user.type(screen.getByLabelText(/^Correo electrónico/), 'ana@example.test');
    await user.click(screen.getByRole('button', { name: 'Enviar instrucciones' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo enviar el pedido');
  });

  it('con token valida, cambia la contraseña y ofrece iniciar sesión', async () => {
    apiClient.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderEs(<PasswordResetForm token="tok" />);
    await user.type(screen.getByLabelText(/^Contraseña nueva/), GOOD);
    await user.type(screen.getByLabelText(/^Repetí la contraseña/), 'distinta');
    await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(screen.getByText('Las contraseñas no coinciden')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/^Repetí la contraseña/));
    await user.type(screen.getByLabelText(/^Repetí la contraseña/), GOOD);
    await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(await screen.findByRole('status')).toHaveTextContent('tu contraseña se actualizó');
    const [path, init] = apiClient.mock.calls[0];
    expect(path).toBe('/auth/password-reset/confirm');
    expect(JSON.parse(init.body)).toEqual({ token: 'tok', newPassword: GOOD });
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/auth/login');
  });

  it.each([
    ['PASSWORD_RESET_INVALID', 'no es válido'],
    ['PASSWORD_RESET_USED', 'ya se usó'],
    ['PASSWORD_RESET_EXPIRED', 'venció'],
    ['OTRO', 'Mensaje del servidor'],
  ])('muestra el error %s', async (code, text) => {
    apiClient.mockRejectedValue(new ApiRequestError(400, code, 'Mensaje del servidor'));
    const user = userEvent.setup();
    renderEs(<PasswordResetForm token="tok" />);
    await user.type(screen.getByLabelText(/^Contraseña nueva/), GOOD);
    await user.type(screen.getByLabelText(/^Repetí la contraseña/), GOOD);
    await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });
});

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  async function fill(user: ReturnType<typeof userEvent.setup>, current = 'Actual12345') {
    if (current) await user.type(screen.getByLabelText(/^Contraseña actual/), current);
    await user.type(screen.getByLabelText(/^Contraseña nueva/), GOOD);
    await user.type(screen.getByLabelText(/^Repetí la contraseña nueva/), GOOD);
  }

  it('valida la actual y la nueva', async () => {
    const user = userEvent.setup();
    renderEs(<ChangePasswordForm />);
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(screen.getByText('Este campo es obligatorio')).toBeInTheDocument();
    expect(screen.getByText('Ingresá una contraseña')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('cambia la contraseña y limpia los campos', async () => {
    apiClient.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderEs(<ChangePasswordForm />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Contraseña actualizada');
    const [path, init] = apiClient.mock.calls[0];
    expect(path).toBe('/auth/change-password');
    expect(JSON.parse(init.body)).toEqual({ currentPassword: 'Actual12345', newPassword: GOOD });
    expect(screen.getByLabelText(/^Contraseña actual/)).toHaveValue('');
  });

  it('marca la contraseña actual incorrecta y los demás errores', async () => {
    const user = userEvent.setup();
    renderEs(<ChangePasswordForm />);
    await fill(user);
    apiClient.mockRejectedValueOnce(new ApiRequestError(400, 'INVALID_CURRENT_PASSWORD', 'x'));
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText('La contraseña actual no es correcta.')).toBeInTheDocument();

    apiClient.mockRejectedValueOnce(new Error('down'));
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText('No se pudo cambiar la contraseña')).toBeInTheDocument();
  });
});
