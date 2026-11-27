// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';

const { nav } = vi.hoisted(() => ({ nav: { path: '/es/auth/login' } }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => nav.path,
}));
vi.mock('@/lib/read-access', () => ({ useReadAccess: () => null }));
vi.mock('@/components/dashboard/dashboard-skeleton', () => ({
  DashboardSkeleton: ({ firstName }: { firstName: string }) => <p>Hola, {firstName}</p>,
}));

import { transition } from '@/lib/transition-store';
import { HOLD_MS, LoginToPanel, MAX_WAIT_MS, SETTLE_MS, isPanelPath } from './login-to-panel';

const ui = () => (
  <NextIntlClientProvider locale="es" messages={es}>
    <LoginToPanel />
  </NextIntlClientProvider>
);

describe('isPanelPath', () => {
  it('distingue las pantallas del panel del ingreso y de la raíz', () => {
    expect(isPanelPath('/es/dashboard')).toBe(true);
    expect(isPanelPath('/contracts/1')).toBe(true);
    expect(isPanelPath('/es/auth/login')).toBe(false);
    expect(isPanelPath('/es')).toBe(false);
    expect(isPanelPath('/')).toBe(false);
    expect(isPanelPath(null)).toBe(false);
  });
});

describe('LoginToPanel', () => {
  const end = vi.spyOn(transition, 'end');

  beforeEach(() => {
    vi.useFakeTimers();
    nav.path = '/es/auth/login';
    end.mockClear();
  });
  afterEach(() => {
    act(() => transition.end());
    vi.useRealTimers();
  });

  it('sin transición en curso no dibuja nada', () => {
    const { container } = render(ui());
    expect(container).toBeEmptyDOMElement();
  });

  it('muestra el menú del rol y el saludo, y se levanta cuando el panel ya está en pantalla', () => {
    const { rerender, getByText, getAllByText } = render(ui());
    act(() => transition.start({ firstName: 'Ana', lastName: 'Prueba', role: 'Admin' }));
    expect(getByText('Hola, Ana')).toBeInTheDocument();
    expect(getByText('AP')).toBeInTheDocument();
    expect(getAllByText('Contratos').length).toBeGreaterThan(0);

    nav.path = '/es/dashboard';
    rerender(ui());
    act(() => void vi.advanceTimersByTime(HOLD_MS - 50));
    expect(end).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(50));
    expect(end).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(SETTLE_MS));
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('si el panel tarda, espera a que llegue en vez de levantarse sobre una pantalla vacía', () => {
    const { rerender } = render(ui());
    act(() => transition.start({ firstName: 'Ana', lastName: 'Prueba', role: 'Admin' }));
    act(() => void vi.advanceTimersByTime(HOLD_MS + 2000));
    expect(end).not.toHaveBeenCalled();
    nav.path = '/es/dashboard';
    rerender(ui());
    act(() => void vi.advanceTimersByTime(SETTLE_MS));
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('nunca queda puesta para siempre', () => {
    render(ui());
    act(() => transition.start({ firstName: 'Ana', lastName: 'Prueba', role: 'Admin' }));
    act(() => void vi.advanceTimersByTime(MAX_WAIT_MS));
    expect(end).toHaveBeenCalledTimes(1);
  });
});
