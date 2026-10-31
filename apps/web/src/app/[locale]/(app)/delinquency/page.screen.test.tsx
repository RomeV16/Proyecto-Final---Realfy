// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '@/components/index-data/test-utils';

const { apiClient, auth, toast, failure } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  failure: { error: null as Error | null },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) =>
    failure.error ? Promise.reject(failure.error) : apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' } }),
  useOptionalAuth: () => ({
    user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' },
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/delinquency',
}));
vi.mock('@/lib/toast', () => ({ toast }));

import { ApiRequestError } from '@/lib/api-client';
import DelinquencyPage from './page';

const norm = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

const tenants = [
  {
    personId: 'p1',
    fullName: 'Luis Inventado',
    propertyId: 'pr1',
    propertyLabel: 'Depto Uno',
    totalDebt: '150000',
    totalPenalty: '7500.5',
    daysOverdueMax: 45,
  },
  {
    personId: 'p2',
    fullName: 'Marta Ficticia',
    propertyId: 'pr2',
    totalDebt: '50000',
    totalPenalty: '0',
    daysOverdueMax: 12,
  },
  {
    personId: 'p3',
    fullName: 'Pedro Falso',
    propertyId: 'pr3',
    propertyLabel: 'Casa Tres',
    totalDebt: '1000',
    totalPenalty: '10',
    daysOverdueMax: 3,
  },
];

describe('DelinquencyPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    toast.error.mockReset();
    failure.error = null;
    auth.role = 'Admin';
  });

  it.each(['Admin', 'Gerente'])('%s ve el listado con importes formateados', async (role) => {
    auth.role = role;
    apiClient.mockResolvedValue(tenants);
    renderEs(<DelinquencyPage />);
    await screen.findByText('$201.000,00');
    expect(apiClient).toHaveBeenCalledWith('/penalties/delinquent-tenants');
    await waitFor(() => expect(norm(document.body.textContent)).toContain('Luis Inventado'));
    const text = norm(document.body.textContent);
    expect(text).toContain('$150.000,00');
    expect(text).toContain('$7.500,50');
    expect(text).toContain('$7.510,50');
    expect(text).toContain('Depto Uno');
  });

  it('resume la cantidad de casos graves (30 días o más)', async () => {
    apiClient.mockResolvedValue(tenants);
    renderEs(<DelinquencyPage />);
    await screen.findByText('Deuda total');
    expect(screen.getByText('Multa acumulada')).toBeInTheDocument();
    expect(screen.getByText('Casos graves')).toBeInTheDocument();
  });

  it.each(['Ventas', 'Liquidaciones', 'Soporte', 'Lectura'])(
    '%s ve el aviso de acceso y no consulta la API',
    (role) => {
      auth.role = role;
      renderEs(<DelinquencyPage />);
      expect(screen.getByText('No tenés permisos para acceder a esta sección')).toBeInTheDocument();
      expect(apiClient).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name: 'Morosos' })).not.toBeInTheDocument();
    },
  );

  it('sin morosos muestra el estado vacío', async () => {
    apiClient.mockResolvedValue([]);
    renderEs(<DelinquencyPage />);
    expect(await screen.findByText('¡Todos al día! No hay morosos activos')).toBeInTheDocument();
  });

  it('actualiza al pulsar el botón', async () => {
    apiClient.mockResolvedValue([]);
    const user = userEvent.setup();
    renderEs(<DelinquencyPage />);
    await screen.findByText('¡Todos al día! No hay morosos activos');
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(2));
  });

  it('avisa con el mensaje del servidor si la API falla', async () => {
    failure.error = new ApiRequestError(500, 'BOOM', 'Servicio caído');
    renderEs(<DelinquencyPage />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Servicio caído'));
  });

  it('usa el mensaje genérico ante un error desconocido', async () => {
    failure.error = new Error('red');
    renderEs(<DelinquencyPage />);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Error al cargar la lista de morosos'),
    );
  });
});
