// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderEs } from '../index-data/test-utils';

const { count, auth } = vi.hoisted(() => ({ count: { value: 0 }, auth: { role: 'Liquidaciones' } }));
vi.mock('@/lib/auth-context', () => ({
  useOptionalAuth: () => ({ user: { id: 'u', role: auth.role } }),
  useAuth: () => ({ user: { id: 'u', role: auth.role } }),
}));
vi.mock('@/lib/bill-documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bill-documents')>()),
  useBillReviewCount: (enabled: boolean) => (enabled ? count.value : 0),
}));

import { BillReviewNavBadge } from './bill-review-nav-badge';
import { isNavItemActive, navItems, visibleNavItems } from './nav-items';
import { NavCountBadge } from './nav-count-badge';

describe('NavCountBadge', () => {
  it('no se muestra en cero y topa en 99+', () => {
    const { container, rerender } = render(<NavCountBadge count={0} label="x" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<NavCountBadge count={150} label="150 pendientes" danger floating />);
    expect(screen.getByRole('status', { name: '150 pendientes' })).toHaveTextContent('99+');
  });
});

describe('BillReviewNavBadge', () => {
  beforeEach(() => {
    count.value = 4;
    auth.role = 'Liquidaciones';
  });

  it('cuenta las boletas en revisión con su etiqueta para lectores de pantalla', () => {
    renderEs(<BillReviewNavBadge />);
    expect(screen.getByRole('status', { name: '4 boletas en revisión' })).toHaveTextContent('4');
  });

  it('con una sola usa el singular', () => {
    count.value = 1;
    renderEs(<BillReviewNavBadge floating />);
    expect(screen.getByRole('status', { name: '1 boleta en revisión' })).toBeInTheDocument();
  });

  it('un rol sin acceso no ve el contador', () => {
    auth.role = 'Soporte';
    renderEs(<BillReviewNavBadge />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('navegación de boletas recibidas', () => {
  it('aparece junto a las boletas del mes para quien las ve, incluida la lectura', () => {
    const keys = (role: string) => visibleNavItems(role).map((i) => i.key);
    expect(keys('Liquidaciones')).toEqual(expect.arrayContaining(['serviceBills', 'billDocuments']));
    expect(keys('Lectura')).toContain('billDocuments');
    expect(keys('Lectura')).not.toContain('serviceBills');
    expect(keys('Soporte')).not.toContain('billDocuments');
    const order = navItems.map((i) => i.key);
    expect(order.indexOf('billDocuments')).toBe(order.indexOf('serviceBills') + 1);
  });

  it('marca sólo el ítem de la ruta más específica', () => {
    expect(isNavItemActive('/boletas', '/boletas')).toBe(true);
    expect(isNavItemActive('/boletas/recibidas', '/boletas')).toBe(false);
    expect(isNavItemActive('/boletas/recibidas/abc', '/boletas/recibidas')).toBe(true);
    expect(isNavItemActive('/contracts/1', '/contracts')).toBe(true);
    expect(isNavItemActive('/contracts', '/boletas')).toBe(false);
  });
});
