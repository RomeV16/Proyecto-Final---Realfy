// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCan } from './permissions';
import { navItems, useVisibleNavItems } from '@/components/layout/nav-items';

/**
 * La transición de ingreso vive en el layout de idioma, fuera del proveedor de
 * sesión del staff, y usa el menú. Sin sesión no hay permisos, pero nada lanza:
 * si lanzara, el prerenderizado de las páginas falla en el build.
 */
describe('permisos y menú sin proveedor de sesión', () => {
  it('useCan devuelve false sin lanzar', () => {
    const { result } = renderHook(() => useCan('contracts.manage'));
    expect(result.current).toBe(false);
  });

  it('useVisibleNavItems devuelve los ítems sin acción requerida', () => {
    const { result } = renderHook(() => useVisibleNavItems());
    expect(result.current).toEqual(navItems.filter((item) => !item.action));
  });
});
