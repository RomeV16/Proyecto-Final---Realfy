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
  nav: { path: '/es/contracts' },
}));

vi.mock('@/lib/auth-context', () => {
  const value = () => ({ user: auth.user, logout: auth.logout });
  return { useAuth: value, useOptionalAuth: value };
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => nav.path,
}));

import { MobileNav } from './mobile-nav';
import { navItems } from './nav-items';

const ana = {
  id: 'u1',
  role: 'Admin',
  firstName: 'Ana',
  lastName: 'Prueba',
  email: 'ana@example.test',
};

describe('MobileNav', () => {
  beforeEach(() => {
    auth.user = ana;
    auth.logout.mockReset();
    nav.path = '/es/contracts';
    document.body.style.overflow = '';
  });

  it('lista las entradas de navegación con enlaces con prefijo de idioma', () => {
    renderEs(<MobileNav open onClose={() => {}} />);
    const nav_ = screen.getByRole('dialog').querySelector('nav')!;
    const hrefs = Array.from(nav_.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toHaveLength(navItems.length);
    expect(hrefs).toContain('/es/dashboard');
    expect(hrefs).toContain('/es/contracts');
    expect(hrefs.every((h) => h!.startsWith('/es/'))).toBe(true);
  });

  it('marca como activa la ruta actual y sus subrutas', () => {
    nav.path = '/es/contracts/c-1';
    renderEs(<MobileNav open onClose={() => {}} />);
    const active = screen.getByRole('dialog').querySelector('nav a.font-medium');
    expect(active?.getAttribute('href')).toBe('/es/contracts');
  });

  it('muestra los datos del usuario y la inicial en el encabezado', () => {
    renderEs(<MobileNav open onClose={() => {}} />);
    expect(screen.getByText('Ana Prueba')).toBeInTheDocument();
    expect(screen.getByText('ana@example.test')).toBeInTheDocument();
    expect(screen.getByText('AP')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('sin sesión muestra la R de marca y sin bloque de usuario', () => {
    auth.user = null;
    renderEs(<MobileNav open onClose={() => {}} />);
    expect(screen.getByText('R')).toBeInTheDocument();
    expect(screen.queryByText('ana@example.test')).not.toBeInTheDocument();
  });

  it('bloquea el scroll del cuerpo mientras está abierto y lo libera al cerrar', () => {
    const { unmount } = renderEs(<MobileNav open onClose={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('cerrado no bloquea el scroll', () => {
    renderEs(<MobileNav open={false} onClose={() => {}} />);
    expect(document.body.style.overflow).toBe('');
  });

  it('el botón cerrar, el fondo y un enlace llaman a onClose', async () => {
    const onClose = vi.fn();
    const { container } = renderEs(<MobileNav open onClose={onClose} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(container.querySelector('[aria-hidden="true"]')!);
    expect(onClose).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('dialog').querySelector('nav a')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('cerrar sesión cierra el menú y llama a logout', async () => {
    const onClose = vi.fn();
    renderEs(<MobileNav open onClose={onClose} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Cerrar sesión/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });
});
