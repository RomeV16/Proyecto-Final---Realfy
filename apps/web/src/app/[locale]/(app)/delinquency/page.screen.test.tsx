// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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
    await screen.findByText('Deuda vencida');
    expect(apiClient).toHaveBeenCalledWith('/penalties/delinquent-tenants');
    await waitFor(() => expect(norm(document.body.textContent)).toContain('Luis Inventado'));
    const text = norm(document.body.textContent);
    expect(text).toContain('$ 201.000,00');
    expect(text).toContain('$ 150.000,00');
    expect(text).toContain('$ 7.500,50');
    expect(text).toContain('$ 7.510,50');
    expect(text).toContain('Depto Uno');
    expect(text).toContain('Sin propiedad');
  });

  it('reparte la deuda en tramos de antigüedad con importe, deudores y porcentaje', async () => {
    apiClient.mockResolvedValue([...tenants, { personId: 'unknown-l9', fullName: 'Desconocido', totalDebt: '49000', totalPenalty: '0', daysOverdueMax: 120 }]);
    renderEs(<DelinquencyPage />);
    const aging = within(await screen.findByRole('region', { name: 'Deuda por antigüedad' }));
    expect(aging.getByText('Punitorios acumulados')).toBeInTheDocument();
    expect(norm(aging.getByText(/4 inquilinos en mora/).textContent)).toContain('el atraso más viejo es de 120 días');
    const bucket = (label: string) => norm(aging.getByText(label).closest('div')!.textContent);
    expect(bucket('1 a 30 días')).toContain('$ 51.000,00');
    expect(bucket('1 a 30 días')).toContain('2 deudores · 20 % de la deuda');
    expect(bucket('31 a 60 días')).toContain('$ 150.000,00');
    expect(bucket('31 a 60 días')).toContain('1 deudor · 60 % de la deuda');
    expect(bucket('61 a 90 días')).toContain('Sin deudores');
    expect(bucket('Más de 90 días')).toContain('$ 49.000,00');
  });

  it('ordena los deudores del más atrasado al menos y enlaza a la persona', async () => {
    apiClient.mockResolvedValue([...tenants, { personId: 'unknown-l9', fullName: 'Desconocido', totalDebt: '49000', totalPenalty: '0', daysOverdueMax: 120 }]);
    renderEs(<DelinquencyPage />);
    const ranking = within(await screen.findByRole('region', { name: 'Deudores' }));
    const rows = ranking.getAllByRole('listitem').map((li) => norm(li.textContent));
    expect(rows.map((r) => r.slice(0, 9))).toEqual(['Puesto 01', 'Puesto 02', 'Puesto 03', 'Puesto 04']);
    expect(rows[0]).toContain('Desconocido');
    expect(rows[1]).toContain('Luis Inventado');
    expect(rows[1]).toContain('45días de mora');
    expect(rows[3]).toContain('Pedro Falso');
    expect(ranking.getByRole('link', { name: 'Luis Inventado' })).toHaveAttribute('href', '/es/persons/p1');
    expect(ranking.queryByRole('link', { name: 'Desconocido' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir a cobranza' })).toHaveAttribute('href', '/es/cobranza');
  });

  it.each(['Ventas', 'Liquidaciones', 'Soporte', 'Lectura'])(
    '%s ve el aviso de acceso y no consulta la API',
    (role) => {
      auth.role = role;
      renderEs(<DelinquencyPage />);
      expect(screen.getByText('No tenés permisos para acceder a esta sección')).toBeInTheDocument();
      expect(apiClient).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name: 'Morosidad' })).not.toBeInTheDocument();
    },
  );

  it('sin morosos muestra el estado vacío', async () => {
    apiClient.mockResolvedValue([]);
    renderEs(<DelinquencyPage />);
    expect(await screen.findByText('No hay inquilinos en mora')).toBeInTheDocument();
  });

  it('actualiza al pulsar el botón', async () => {
    apiClient.mockResolvedValue([]);
    const user = userEvent.setup();
    renderEs(<DelinquencyPage />);
    await screen.findByText('No hay inquilinos en mora');
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(2));
  });

  it('avisa con el mensaje del servidor si la API falla', async () => {
    failure.error = new ApiRequestError(500, 'BOOM', 'Servicio caído');
    renderEs(<DelinquencyPage />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Servicio caído'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Servicio caído');
    expect(screen.queryByText('No hay inquilinos en mora')).not.toBeInTheDocument();
  });

  it('usa el mensaje genérico ante un error desconocido', async () => {
    failure.error = new Error('red');
    renderEs(<DelinquencyPage />);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('No se pudo cargar la morosidad'),
    );
  });
});
