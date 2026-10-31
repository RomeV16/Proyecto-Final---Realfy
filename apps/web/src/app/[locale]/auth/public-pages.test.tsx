// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '@/components/index-data/test-utils';

const { search } = vi.hoisted(() => ({ search: { value: '' } }));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams(search.value),
  usePathname: () => '/es/auth/x',
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: vi.fn(),
}));

import AcceptInvitationPage from './accept-invitation/page';
import PasswordResetPage from './password-reset/page';

describe('páginas públicas de acceso', () => {
  beforeEach(() => {
    search.value = '';
  });

  it('aceptar invitación lee el token de la URL', () => {
    search.value = 'token=abc';
    renderEs(<AcceptInvitationPage />);
    expect(screen.getByRole('button', { name: 'Crear mi cuenta' })).toBeInTheDocument();
  });

  it('aceptar invitación sin token avisa que falta el enlace', () => {
    renderEs(<AcceptInvitationPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Falta el enlace de invitación');
  });

  it('recuperar contraseña: con token elige la nueva, sin token pide el correo', () => {
    search.value = 'token=abc';
    const { unmount } = renderEs(<PasswordResetPage />);
    expect(screen.getByRole('button', { name: 'Guardar contraseña' })).toBeInTheDocument();
    unmount();

    search.value = '';
    renderEs(<PasswordResetPage />);
    expect(screen.getByRole('button', { name: 'Enviar instrucciones' })).toBeInTheDocument();
  });
});
