// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { nav } = vi.hoisted(() => ({ nav: { path: '/es/dashboard' } }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => nav.path,
}));

import { BAR_DELAY_MS, BAR_GIVE_UP_MS, GlobalLoadingBar } from './global-loading-bar';
import { internalNavTarget, navProgress, stripLocale, usePendingPath } from './nav-progress';

function Pending() {
  return <p>pendiente: {usePendingPath() ?? 'nada'}</p>;
}

const here = { origin: window.location.origin, pathname: '/es/dashboard' };

function clickOn(html: string, init: MouseEventInit = {}) {
  document.body.innerHTML = html;
  const target = document.querySelector('[data-target]')!;
  const event = new MouseEvent('click', { bubbles: true, button: 0, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return internalNavTarget(event, here);
}

describe('stripLocale', () => {
  it('quita el prefijo de idioma y deja el resto igual', () => {
    expect(stripLocale('/es/contracts/1')).toBe('/contracts/1');
    expect(stripLocale('/en')).toBe('/');
    expect(stripLocale('/contracts')).toBe('/contracts');
    expect(stripLocale('')).toBe('/');
  });
});

describe('internalNavTarget', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('devuelve la ruta de un enlace interno a otra pantalla, aunque el clic caiga en un hijo', () => {
    expect(clickOn('<a href="/es/contracts"><span data-target>Contratos</span></a>')).toBe('/es/contracts');
  });

  it('ignora la pantalla actual, otros sitios, otra pestaña, descargas y clics con tecla', () => {
    expect(clickOn('<a data-target href="/es/dashboard?mes=10">Panel</a>')).toBeNull();
    expect(clickOn('<a data-target href="https://otro.example/es/contracts">Fuera</a>')).toBeNull();
    expect(clickOn('<a data-target target="_blank" href="/es/contracts">Pestaña</a>')).toBeNull();
    expect(clickOn('<a data-target download href="/es/archivo.pdf">Bajar</a>')).toBeNull();
    expect(clickOn('<a data-target href="/es/contracts">Contratos</a>', { ctrlKey: true })).toBeNull();
    expect(clickOn('<a data-target href="/es/contracts">Contratos</a>', { button: 1 })).toBeNull();
    expect(clickOn('<button data-target>No es enlace</button>')).toBeNull();
  });
});

describe('GlobalLoadingBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    nav.path = '/es/dashboard';
    window.history.replaceState(null, '', '/es/dashboard');
    navProgress.done();
  });
  afterEach(() => {
    act(() => navProgress.done());
    vi.useRealTimers();
  });

  const ui = () => (
    <>
      <GlobalLoadingBar />
      <Pending />
      <a href="/es/contracts" onClick={(event) => event.preventDefault()}>
        Contratos
      </a>
    </>
  );

  it('un cambio de pantalla rápido no llega a mostrar la barra', () => {
    const { rerender } = render(ui());
    fireEvent.click(screen.getByText('Contratos'));
    expect(screen.getByText('pendiente: /contracts')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(BAR_DELAY_MS - 10));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    nav.path = '/es/contracts';
    rerender(ui());
    expect(screen.getByText('pendiente: nada')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('si la pantalla tarda aparece, y al llegar se completa y se va', () => {
    const { rerender } = render(ui());
    fireEvent.click(screen.getByText('Contratos'));
    act(() => void vi.advanceTimersByTime(BAR_DELAY_MS));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    act(() => void vi.advanceTimersByTime(50));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80');
    nav.path = '/es/contracts';
    rerender(ui());
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('si la pantalla nunca llega no queda colgada', () => {
    render(ui());
    fireEvent.click(screen.getByText('Contratos'));
    act(() => void vi.advanceTimersByTime(BAR_DELAY_MS));
    act(() => void vi.advanceTimersByTime(50));
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(BAR_GIVE_UP_MS));
    expect(screen.getByText('pendiente: nada')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
