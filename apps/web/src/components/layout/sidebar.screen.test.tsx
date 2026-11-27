// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { auth, nav } = vi.hoisted(() => ({
  auth: { user: { id: 'u1', role: 'Admin' } as null | { id: string; role: string } },
  nav: { path: '/es/boletas/recibidas' },
}));

vi.mock('@/lib/auth-context', () => {
  const value = () => ({ user: auth.user });
  return { useAuth: value, useOptionalAuth: value };
});
vi.mock('@/lib/read-access', () => ({ useReadAccess: () => null }));
vi.mock('./inbox-nav-badge', () => ({ InboxNavBadge: () => null }));
vi.mock('./bill-review-nav-badge', () => ({ BillReviewNavBadge: () => null }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => nav.path,
}));

import { resetNavCollapse } from './nav-collapse';
import { navItems, navSections, visibleNavSections } from './nav-items';
import { Sidebar } from './sidebar';

/** La barra lateral desplegada es el segundo `nav`; el primero es el riel de íconos. */
const expanded = () => screen.getAllByRole('navigation', { name: 'Navegación principal' })[1];
const rail = () => screen.getAllByRole('navigation', { name: 'Navegación principal' })[0];

describe('registro de navegación', () => {
  it('cada ítem tiene un ícono, una clave y una ruta propios', () => {
    for (const field of ['icon', 'key', 'href'] as const) {
      const values = navItems.map((item) => item[field]);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('las secciones sin ítems visibles para el rol no se muestran', () => {
    const soporte = visibleNavSections('Soporte').map((s) => s.key);
    expect(soporte).toContain('home');
    expect(soporte).not.toContain('admin');
    expect(visibleNavSections('Admin').map((s) => s.key)).toEqual(navSections.map((s) => s.key));
  });
});

describe('Sidebar', () => {
  beforeEach(() => {
    auth.user = { id: 'u1', role: 'Admin' };
    nav.path = '/es/boletas/recibidas';
    window.localStorage.clear();
    resetNavCollapse();
  });

  it('muestra las secciones con su título y todos los ítems, igual que el riel de íconos', () => {
    renderEs(<Sidebar collapsed={false} onToggle={() => {}} />);
    const titles = within(expanded())
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(titles).toEqual(['Cartera', 'Comercial', 'Alquileres', 'Cobros y caja', 'Locadores', 'Atención', 'Administración']);
    const hrefs = (el: HTMLElement) => within(el).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs(expanded())).toEqual(navItems.map((i) => `/es${i.href}`));
    expect(hrefs(rail())).toEqual(hrefs(expanded()));
  });

  it('marca solo el ítem de la ruta más específica', () => {
    renderEs(<Sidebar collapsed={false} onToggle={() => {}} />);
    const current = within(expanded())
      .getAllByRole('link')
      .filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual(['Boletas recibidas']);
  });

  it('plegar una sección deja a la vista solo el ítem actual y el riel no cambia', async () => {
    const user = userEvent.setup();
    renderEs(<Sidebar collapsed={false} onToggle={() => {}} />);
    await user.click(within(expanded()).getByRole('button', { name: 'Alquileres' }));
    expect(within(expanded()).getByRole('button', { name: 'Alquileres' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(expanded()).queryByRole('link', { name: 'Liquidaciones' })).not.toBeInTheDocument();
    expect(within(expanded()).getByRole('link', { name: 'Boletas recibidas' })).toBeInTheDocument();
    expect(within(rail()).getAllByRole('link')).toHaveLength(navItems.length);
    expect(window.localStorage.getItem('realfy.nav.collapsed')).toBe('["rentals"]');

    await user.click(within(expanded()).getByRole('button', { name: 'Alquileres' }));
    expect(within(expanded()).getByRole('link', { name: 'Liquidaciones' })).toBeInTheDocument();
    expect(window.localStorage.getItem('realfy.nav.collapsed')).toBe('[]');
  });

  it('recuerda las secciones plegadas e ignora un valor guardado inválido', () => {
    window.localStorage.setItem('realfy.nav.collapsed', '["admin", 7]');
    const { unmount } = renderEs(<Sidebar collapsed={false} onToggle={() => {}} />);
    expect(within(expanded()).queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument();
    unmount();

    resetNavCollapse();
    window.localStorage.setItem('realfy.nav.collapsed', '{no es json');
    renderEs(<Sidebar collapsed={false} onToggle={() => {}} />);
    expect(within(expanded()).getByRole('link', { name: 'Usuarios' })).toBeInTheDocument();
  });

  it('contraída muestra solo íconos con su nombre accesible, sin títulos de sección', async () => {
    const onToggle = vi.fn();
    window.localStorage.setItem('realfy.nav.collapsed', '["admin"]');
    renderEs(<Sidebar collapsed onToggle={onToggle} />);
    expect(within(expanded()).queryByRole('button')).not.toBeInTheDocument();
    expect(within(expanded()).getByRole('link', { name: 'Usuarios' })).toHaveAttribute('title', 'Usuarios');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Expandir la barra lateral' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('un rol acotado no ve secciones vacías', () => {
    auth.user = { id: 'u2', role: 'Soporte' };
    renderEs(<Sidebar collapsed={false} onToggle={() => {}} />);
    expect(within(expanded()).queryByRole('button', { name: 'Administración' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contraer la barra lateral' })).toBeInTheDocument();
  });
});
