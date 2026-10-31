// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import es from './messages/es.json';

const nav = vi.hoisted(() => ({ pathname: '/en/contracts/c-1', push: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u', role: 'Admin', firstName: 'A', lastName: 'B' }, logout: vi.fn() }),
}));

import { Link, usePathname, useRouter } from './navigation';
import { currentLocale, localizedPath } from './locale-path';
import { Sidebar } from '@/components/layout/sidebar';

function renderIn(locale: string, ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale={locale} messages={es}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function Probe() {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <div>
      <p data-testid="path">{pathname}</p>
      <Link href="/contracts">lista</Link>
      <button onClick={() => router.push('/properties/p-1')}>ir</button>
    </div>
  );
}

beforeEach(() => {
  nav.pathname = '/en/contracts/c-1';
  nav.push.mockReset();
});

describe('navegación con locale', () => {
  it('Link agrega el locale de la pantalla y usePathname lo quita', () => {
    renderIn('en', <Probe />);
    expect(screen.getByRole('link', { name: 'lista' })).toHaveAttribute('href', '/en/contracts');
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/contracts\/c-1$/);
  });

  it('useRouter navega con el prefijo del locale actual', async () => {
    nav.pathname = '/es/contracts/c-1';
    renderIn('es', <Probe />);
    await userEvent.click(screen.getByRole('button', { name: 'ir' }));
    expect(nav.push).toHaveBeenCalledWith('/es/properties/p-1');
  });

  it('el menú lateral enlaza cada ítem con el locale y marca el activo', () => {
    nav.pathname = '/en/contracts/c-1';
    renderIn('en', <Sidebar collapsed={false} onToggle={() => undefined} />);
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/en/dashboard');
    expect(links).toContain('/en/contracts');
    expect(links.every((href) => href?.startsWith('/en/'))).toBe(true);
  });
});

describe('locale-path', () => {
  it('detecta el locale de la URL y cae al predeterminado', () => {
    expect(currentLocale('/en/contracts')).toBe('en');
    expect(currentLocale('/es')).toBe('es');
    expect(currentLocale('/fr/x')).toBe('es');
    expect(currentLocale('')).toBe('es');
  });

  it('antepone el locale a una ruta interna', () => {
    expect(localizedPath('/auth/login', '/en/contracts')).toBe('/en/auth/login');
    expect(localizedPath('auth/login', '/es/x')).toBe('/es/auth/login');
  });

  it('sin pathname explícito usa la ubicación del navegador', () => {
    window.history.pushState({}, '', '/en/dashboard');
    expect(currentLocale()).toBe('en');
    expect(localizedPath('/portal')).toBe('/en/portal');
    window.history.pushState({}, '', '/');
  });
});
