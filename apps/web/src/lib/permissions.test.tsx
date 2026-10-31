// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserRole } from '@realfy/shared';

let currentUser: { role: string } | null = null;
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: currentUser }),
  useOptionalAuth: () => ({ user: currentUser }) }));

import { ACTION_ROLES, can, useCan, type Action } from './permissions';
import { navItems, useVisibleNavItems, visibleNavItems, type NavItem } from '@/components/layout/nav-items';

const ALL_ROLES = Object.values(UserRole);

/** La matriz tal como estaba escrita en cada pantalla antes de centralizarla. */
const EXPECTED: Record<Action, string[]> = {
  'properties.manage': ['Admin', 'Gerente', 'Ventas'],
  'properties.delete': ['Admin', 'Gerente'],
  'persons.manage': ['Admin', 'Gerente', 'Ventas'],
  'persons.delete': ['Admin', 'Gerente'],
  'persons.scoring': ['Admin', 'Gerente'],
  'leads.manage': ['Admin', 'Gerente', 'Ventas'],
  'leads.assignable': ['Admin', 'Gerente', 'Ventas'],
  'pipeline.access': ['Admin', 'Gerente', 'Ventas'],
  'pipeline.configure': ['Admin', 'Gerente'],
  'scoring.configure': ['Admin', 'Gerente'],
  'contracts.manage': ['Admin', 'Gerente', 'Ventas'],
  'contracts.administer': ['Admin', 'Gerente'],
  'liquidaciones.generate': ['Admin', 'Gerente'],
  'liquidaciones.bulk': ['Admin', 'Gerente'],
  'liquidaciones.act': ['Admin', 'Gerente', 'Ventas', 'Liquidaciones'],
  'liquidaciones.readOnlyNotice': ['Lectura'],
  'renditions.manage': ['Admin', 'Gerente', 'Liquidaciones'],
  'invoices.emit': ['Admin', 'Gerente', 'Liquidaciones'],
  'fiscal.configure': ['Admin', 'Gerente'],
  'reports.view': ['Admin', 'Gerente', 'Liquidaciones'],
  'reports.schedule': ['Admin', 'Gerente'],
  'delinquency.view': ['Admin', 'Gerente'],
  'dashboard.analytics': ['Admin', 'Gerente'],
  'tickets.manage': ['Admin', 'Gerente', 'Soporte'],
  'settings.manage': ['Admin', 'Gerente'],
  'users.view': ['Admin', 'Gerente'],
  'users.manage': ['Admin'],
  'indexData.view': ['Admin', 'Gerente'],
  'indexData.manage': ['Admin'],
};

describe('can', () => {
  it('la matriz coincide con los permisos que tenía cada pantalla', () => {
    for (const action of Object.keys(EXPECTED) as Action[]) {
      const allowed = ALL_ROLES.filter((role) => can(role, action));
      expect(allowed.sort(), action).toEqual([...EXPECTED[action]].sort());
    }
    expect(Object.keys(ACTION_ROLES).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('una acción de edición nunca queda abierta a roles de solo lectura', () => {
    for (const role of ['Lectura', 'Marketing']) {
      expect(can(role, 'contracts.manage')).toBe(false);
      expect(can(role, 'invoices.emit')).toBe(false);
    }
  });

  it('sin rol o con un rol desconocido no se puede nada', () => {
    expect(can(null, 'contracts.manage')).toBe(false);
    expect(can(undefined, 'contracts.manage')).toBe(false);
    expect(can('', 'contracts.manage')).toBe(false);
    expect(can('Inventado', 'contracts.manage')).toBe(false);
  });

  it('los roles sin liquidaciones.act son exactamente los de solo lectura', () => {
    const readOnly = ALL_ROLES.filter((role) => !can(role, 'liquidaciones.act')).sort();
    expect(readOnly).toEqual(['Lectura', 'Marketing', 'Soporte']);
  });
});

function Probe({ action }: { action: Action }) {
  return <p>{useCan(action) ? 'si' : 'no'}</p>;
}

describe('useCan', () => {
  beforeEach(() => {
    currentUser = null;
  });

  it('usa el rol del usuario de la sesión', () => {
    currentUser = { role: 'Ventas' };
    const { rerender } = render(<Probe action="leads.manage" />);
    expect(screen.getByText('si')).toBeInTheDocument();
    rerender(<Probe action="reports.schedule" />);
    expect(screen.getByText('no')).toBeInTheDocument();
  });

  it('sin sesión no habilita nada', () => {
    render(<Probe action="leads.manage" />);
    expect(screen.getByText('no')).toBeInTheDocument();
  });
});

describe('menú por rol', () => {
  it('todos los roles ven los ítems sin acción; Usuarios solo Admin y Gerente', () => {
    const open = navItems.filter((i) => !i.action).map((i) => i.key);
    for (const role of ALL_ROLES) {
      const keys = visibleNavItems(role).map((i) => i.key);
      expect(keys).toEqual(expect.arrayContaining(open));
      expect(keys.includes('users')).toBe(role === 'Admin' || role === 'Gerente');
    }
  });

  it('un ítem con acción solo lo ven los roles habilitados', () => {
    const items: NavItem[] = [
      { key: 'dashboard', href: '/dashboard', icon: 'dashboard' },
      { key: 'delinquency', href: '/delinquency', icon: 'delinquency', action: 'delinquency.view' },
    ];
    expect(visibleNavItems('Gerente', items).map((i) => i.key)).toEqual(['dashboard', 'delinquency']);
    expect(visibleNavItems('Ventas', items).map((i) => i.key)).toEqual(['dashboard']);
    expect(visibleNavItems(undefined, items).map((i) => i.key)).toEqual(['dashboard']);
  });

  it('useVisibleNavItems lee el rol de la sesión', () => {
    currentUser = { role: 'Lectura' };
    function List() {
      return <p>{useVisibleNavItems().length}</p>;
    }
    render(<List />);
    expect(screen.getByText(String(navItems.filter((i) => !i.action).length))).toBeInTheDocument();
  });
});
