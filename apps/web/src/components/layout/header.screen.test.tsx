// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { auth, nav } = vi.hoisted(() => ({
  auth: {
    user: null as null | { id: string; role: string; firstName: string; lastName: string; email: string },
    logout: vi.fn(),
  },
  nav: { path: '/es/contracts', push: vi.fn() },
}));

vi.mock('@/lib/auth-context', () => {
  const value = () => ({ user: auth.user, logout: auth.logout });
  return { useAuth: value, useOptionalAuth: value };
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => nav.path,
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

import { Header } from './header';

const ana = {
  id: 'u1',
  role: 'Admin',
  firstName: 'Ana',
  lastName: 'Prueba',
  email: 'ana@example.test',
};

describe('Header', () => {
  beforeEach(() => {
    auth.user = ana;
    auth.logout.mockReset();
    nav.push.mockReset();
    nav.path = '/es/contracts';
  });

  it('muestra iniciales, nombre y enlace a notificaciones con prefijo de idioma', () => {
    renderEs(<Header onMenuToggle={() => {}} />);
    expect(screen.getByText('AP')).toBeInTheDocument();
    expect(screen.getByText('Ana Prueba')).toBeInTheDocument();
    const bell = screen.getByRole('link', { name: 'Notificaciones' });
    expect(bell.getAttribute('href')).toBe('/es/notifications');
  });

  it('sin sesión deja el avatar y el nombre vacíos', () => {
    auth.user = null;
    const { container } = renderEs(<Header onMenuToggle={() => {}} />);
    expect(screen.queryByText('AP')).not.toBeInTheDocument();
    expect(container.querySelector('.bg-brand-500')?.textContent).toBe('');
  });

  it('el botón de menú invoca onMenuToggle', async () => {
    const onMenuToggle = vi.fn();
    renderEs(<Header onMenuToggle={onMenuToggle} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Toggle menu' }));
    expect(onMenuToggle).toHaveBeenCalledTimes(1);
  });

  it('una ruta de un nivel muestra una sola miga y sin botón de volver', () => {
    renderEs(<Header onMenuToggle={() => {}} />);
    expect(screen.getAllByText('Contratos').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument();
  });

  it('en un detalle omite el identificador y enlaza la miga padre con prefijo', () => {
    nav.path = '/es/contracts/0b9a3c1e-1111-2222-3333-444455556666';
    renderEs(<Header onMenuToggle={() => {}} />);
    expect(screen.queryByText(/0b9a3c1e/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument();
  });

  it('en una ruta anidada muestra la cadena y vuelve al padre con el router', async () => {
    nav.path = '/es/contracts/12/new-thing';
    renderEs(<Header onMenuToggle={() => {}} />);
    const nav_ = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const parent = nav_.querySelector('a');
    expect(parent?.getAttribute('href')).toBe('/es/contracts');
    expect(screen.getAllByText('New Thing').length).toBeGreaterThan(0);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Go back' }));
    expect(nav.push).toHaveBeenCalledWith('/es/contracts');
  });

  it('sin segmentos no hay migas', () => {
    nav.path = '/es';
    renderEs(<Header onMenuToggle={() => {}} />);
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument();
  });

  it('abre el menú de usuario con perfil, configuración y correo', async () => {
    renderEs(<Header onMenuToggle={() => {}} />);
    const user = userEvent.setup();
    expect(screen.queryByText('ana@example.test')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ana Prueba/ }));
    expect(screen.getByText('ana@example.test')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mi perfil' }).getAttribute('href')).toBe('/es/perfil');
    const settings = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === '/es/configuracion');
    expect(settings).toBeTruthy();
  });

  it('cierra el menú al hacer clic fuera y al elegir un enlace', async () => {
    renderEs(<Header onMenuToggle={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Ana Prueba/ }));
    expect(screen.getByText('ana@example.test')).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByText('ana@example.test')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Ana Prueba/ }));
    await user.click(screen.getByRole('link', { name: 'Mi perfil' }));
    expect(screen.queryByText('ana@example.test')).not.toBeInTheDocument();
  });

  it('cerrar sesión llama a logout', async () => {
    renderEs(<Header onMenuToggle={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Ana Prueba/ }));
    await user.click(screen.getByRole('button', { name: /Cerrar sesión/i }));
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });
});
