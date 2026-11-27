// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';

const { replaceLocation, assignLocation, portalApiClient } = vi.hoisted(() => ({
  replaceLocation: vi.fn(),
  assignLocation: vi.fn(),
  portalApiClient: vi.fn(),
}));
vi.mock('./hard-navigation', () => ({ replaceLocation, assignLocation }));
vi.mock('./portal-api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./portal-api-client')>()),
  portalApiClient,
}));

import { clearPortalTokens, setPortalTokens } from './portal-api-client';
import { PortalAuthProvider, usePortalAuth } from './portal-auth-context';

const vale = { id: 'p1', email: 'vale@example.test', firstName: 'Vale', lastName: 'Prueba', tenantId: 't1' };

function Probe() {
  const { person, isLoading, logout } = usePortalAuth();
  return (
    <div>
      <p>{isLoading ? 'cargando' : 'listo'}</p>
      <p>{person ? `${person.firstName} ${person.lastName}` : 'sin persona'}</p>
      <button onClick={() => void logout()}>salir</button>
    </div>
  );
}

const ui = (
  <NextIntlClientProvider locale="es" messages={es}>
    <PortalAuthProvider>
      <Probe />
    </PortalAuthProvider>
  </NextIntlClientProvider>
);

describe('PortalAuthProvider', () => {
  beforeEach(() => {
    clearPortalTokens();
    localStorage.clear();
    replaceLocation.mockReset();
    assignLocation.mockReset();
    portalApiClient.mockReset();
    window.history.replaceState(null, '', '/es/portal');
  });

  it('sin sesión guardada queda sin persona', async () => {
    render(ui);
    expect(await screen.findByText('listo')).toBeInTheDocument();
    expect(screen.getByText('sin persona')).toBeInTheDocument();
  });

  it('al salir tapa la pantalla sin vaciar la persona y recién después abre el ingreso', async () => {
    setPortalTokens('acceso', 'refresco');
    localStorage.setItem('portalPerson', JSON.stringify(vale));
    let finish: () => void = () => undefined;
    portalApiClient.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    render(ui);
    await screen.findByText('Vale Prueba');
    act(() => screen.getByText('salir').click());
    act(() => screen.getByText('salir').click());
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Vale Prueba')).toBeInTheDocument();
    expect(portalApiClient).toHaveBeenCalledTimes(1);
    expect(assignLocation).not.toHaveBeenCalled();

    await act(async () => finish());
    expect(assignLocation).toHaveBeenCalledWith('/es/portal/auth/login');
    expect(localStorage.getItem('portalPerson')).toBeNull();
    expect(screen.getByText('Vale Prueba')).toBeInTheDocument();

    const restored = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(restored, 'persisted', { value: true });
    act(() => void window.dispatchEvent(restored));
    expect(replaceLocation).toHaveBeenCalledWith('/es/portal/auth/login');
  });
});
