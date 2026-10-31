// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '@/components/index-data/test-utils';

const { apiClient, auth, failure } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { user: { id: 'u1', role: 'Admin', firstName: 'Ana', lastName: 'Prueba' } },
  failure: { error: null as Error | null },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) =>
    failure.error ? Promise.reject(failure.error) : apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: auth.user, isLoading: false }),
  useOptionalAuth: () => ({ user: auth.user }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/configuracion',
}));

import ConfiguracionPage from './page';

function setRole(role: string) {
  auth.user = { id: 'u1', role, firstName: 'Ana', lastName: 'Prueba' };
}

const tenant = {
  id: 'tn1',
  name: 'Inmobiliaria Prueba',
  cuit: '30-00000000-0',
  province: 'CABA',
  brandPrimary: '#112233',
  brandSecondary: '#445566',
  logoUrl: 'https://ejemplo.invalid/logo.png',
};

function mockApi() {
  apiClient.mockImplementation((path: string, init?: { method?: string; body?: string }) => {
    if (path === '/tenants/me') return Promise.resolve(tenant);
    if (init?.method === 'PATCH') {
      return Promise.resolve({ ...tenant, ...JSON.parse(init.body ?? '{}') });
    }
    return Promise.resolve({});
  });
}

const EDIT_LINKS = [
  ['Configurar etapas', '/es/configuracion/pipeline'],
  ['Configurar facturación', '/es/configuracion/fiscal'],
  ['Configurar puntuación', '/es/configuracion/scoring'],
  ['Ver y cargar índices', '/es/configuracion/indices'],
] as const;

describe('ConfiguracionPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    failure.error = null;
    setRole('Admin');
  });

  it.each(['Admin', 'Gerente'])('%s ve los accesos a configuración con prefijo de idioma', async (role) => {
    setRole(role);
    mockApi();
    renderEs(<ConfiguracionPage />);
    await screen.findByRole('heading', { name: 'Configuración' });
    for (const [label, href] of EDIT_LINKS) {
      expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href);
    }
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
  });

  it.each(['Ventas', 'Liquidaciones', 'Soporte', 'Lectura'])(
    '%s ve el formulario de solo lectura',
    async (role) => {
      setRole(role);
      mockApi();
      renderEs(<ConfiguracionPage />);
      await screen.findByRole('heading', { name: 'Configuración' });
      for (const [label] of EDIT_LINKS) {
        expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument();
      }
      expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
      expect(
        screen.getByText('Solo los administradores pueden editar la configuración'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Nombre de la inmobiliaria')).toBeDisabled();
      expect(screen.getByLabelText('Provincia')).toBeDisabled();
    },
  );

  it('carga los datos de la inmobiliaria en el formulario', async () => {
    mockApi();
    renderEs(<ConfiguracionPage />);
    await screen.findByRole('heading', { name: 'Configuración' });
    expect(screen.getByLabelText('Nombre de la inmobiliaria')).toHaveValue('Inmobiliaria Prueba');
    expect(screen.getByLabelText('CUIT')).toHaveValue('30-00000000-0');
    expect(screen.getByLabelText('Provincia')).toHaveValue('CABA');
    expect(screen.getByLabelText('URL del logo')).toHaveValue('https://ejemplo.invalid/logo.png');
    expect(screen.getByText('#112233')).toBeInTheDocument();
  });

  it('guarda los cambios con PATCH y confirma', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<ConfiguracionPage />);
    const name = await screen.findByLabelText('Nombre de la inmobiliaria');
    await user.clear(name);
    await user.type(name, '  Nueva Prueba ');
    await user.selectOptions(screen.getByLabelText('Provincia'), 'Córdoba');
    await user.clear(screen.getByLabelText('URL del logo'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    const call = apiClient.mock.calls.find((c) => c[1]?.method === 'PATCH');
    expect(call?.[0]).toBe('/tenants/tn1');
    const body = JSON.parse(call?.[1].body);
    expect(body.name).toBe('Nueva Prueba');
    expect(body.province).toBe('Córdoba');
    expect(body.logoUrl).toBeUndefined();
    expect(body.brandPrimary).toBe('#112233');
  });

  it('editar después de guardar oculta la confirmación', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<ConfiguracionPage />);
    const name = await screen.findByLabelText('Nombre de la inmobiliaria');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Cambios guardados');
    await user.type(name, 'x');
    expect(screen.queryByText('Cambios guardados')).not.toBeInTheDocument();
  });

  it('exige el nombre y no llama a la API', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<ConfiguracionPage />);
    await user.clear(await screen.findByLabelText('Nombre de la inmobiliaria'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('El nombre es obligatorio')).toBeInTheDocument();
    expect(apiClient.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(false);
  });

  it('muestra el error si falla el guardado', async () => {
    apiClient.mockImplementation((path: string, init?: { method?: string }) =>
      path === '/tenants/me'
        ? Promise.resolve(tenant)
        : init?.method === 'PATCH'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({}),
    );
    const user = userEvent.setup();
    renderEs(<ConfiguracionPage />);
    await screen.findByLabelText('Nombre de la inmobiliaria');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('No se pudieron guardar los cambios')).toBeInTheDocument();
  });

  it('muestra el error si falla la carga', async () => {
    failure.error = new Error('red');
    renderEs(<ConfiguracionPage />);
    expect(await screen.findByText('No se pudo cargar la configuración')).toBeInTheDocument();
  });

  it('cambia los colores de marca', async () => {
    mockApi();
    renderEs(<ConfiguracionPage />);
    await screen.findByRole('heading', { name: 'Configuración' });
    const colors = document.querySelectorAll('input[type="color"]');
    expect(colors).toHaveLength(2);
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(colors[0], { target: { value: '#aabbcc' } });
    fireEvent.change(colors[1], { target: { value: '#ddeeff' } });
    await waitFor(() => expect(screen.getByText('#aabbcc')).toBeInTheDocument());
    expect(screen.getByText('#ddeeff')).toBeInTheDocument();
  });
});
