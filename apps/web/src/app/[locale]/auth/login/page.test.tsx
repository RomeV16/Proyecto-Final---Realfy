// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '@/components/index-data/test-utils';

const { push, assignLocation, start } = vi.hoisted(() => ({
  push: vi.fn(),
  assignLocation: vi.fn(),
  start: vi.fn(),
}));

vi.mock('@/i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/navigation')>()),
  useRouter: () => ({ push }),
}));
vi.mock('@/lib/hard-navigation', () => ({ assignLocation, replaceLocation: vi.fn() }));
vi.mock('@/lib/transition-store', () => ({ transition: { start, end: vi.fn() } }));

import LoginPage from './page';

const ana = { id: 'u1', email: 'ana@example.test', firstName: 'Ana', lastName: 'Prueba', role: 'Gerente', tenantId: 't1' };
const fetchMock = vi.fn();

async function signIn() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Correo electrónico'), 'ana@example.test');
  await user.type(screen.getByLabelText('Contraseña'), 'secreta123');
  await user.click(screen.getByRole('button', { name: 'Ingresar' }));
}

describe('ingreso', () => {
  beforeEach(() => {
    push.mockReset();
    assignLocation.mockReset();
    start.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
    window.history.replaceState(null, '', '/es/auth/login');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('ofrece recuperar la contraseña y crear una cuenta, y titula la pestaña', () => {
    renderEs(<LoginPage />);
    expect(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toHaveAttribute(
      'href',
      '/es/auth/password-reset',
    );
    expect(screen.getByRole('link', { name: /Crear cuenta/ })).toHaveAttribute('href', '/es/auth/register');
    expect(screen.getByText('Ingresá con el correo y la contraseña de tu cuenta.')).toBeInTheDocument();
    expect(document.title).toBe('Iniciar sesión · Realfy');
  });

  it('al ingresar guarda el usuario y abre el panel con la transición', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ user: ana }), { status: 200 }));
    renderEs(<LoginPage />);
    await signIn();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    expect(start).toHaveBeenCalledWith({ firstName: 'Ana', lastName: 'Prueba', role: 'Gerente' });
    expect(JSON.parse(localStorage.getItem('user')!).id).toBe('u1');
    expect(assignLocation).not.toHaveBeenCalled();
  });

  it('si venía de una pantalla del panel vuelve a ella', async () => {
    window.history.replaceState(null, '', '/es/auth/login?redirect=%2Fes%2Fpagos');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ user: ana }), { status: 200 }));
    renderEs(<LoginPage />);
    await signIn();
    await waitFor(() => expect(assignLocation).toHaveBeenCalledWith('/es/pagos'));
    expect(push).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('con credenciales inválidas avisa y deja reintentar', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    renderEs(<LoginPage />);
    await signIn();
    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas');
    expect(screen.getByRole('button', { name: 'Ingresar' })).toBeEnabled();
  });

  it('valida el correo antes de llamar a la API', async () => {
    renderEs(<LoginPage />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(screen.getByText('El correo electrónico es obligatorio')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
