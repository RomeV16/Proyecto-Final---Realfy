// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '@/components/index-data/test-utils';

const { apiClient, auth } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => {
  // Mismo objeto mientras el rol no cambie: la página recarga cuando cambia `user`.
  const cache = new Map<string, object>();
  const current = () => {
    if (!cache.has(auth.role)) {
      cache.set(auth.role, { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' });
    }
    return cache.get(auth.role)!;
  };
  return {
    useAuth: () => ({ user: current(), isLoading: false }),
    useOptionalAuth: () => ({ user: current() }),
  };
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/dashboard',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/components/dashboard/daily-priorities', () => ({
  DailyPriorities: () => <div data-testid="prioridades" />,
}));
vi.mock('@/components/dashboard/portfolio-analytics', () => ({
  PortfolioAnalytics: () => <div data-testid="analitica" />,
}));

import DashboardPage from './page';

class FakeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', FakeObserver);
vi.stubGlobal('ResizeObserver', FakeObserver);

const norm = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

function stats(overrides: Record<string, unknown> = {}) {
  return {
    currency: 'ARS',
    monthlyRentRoll: 1250000,
    avgRent: 250000,
    portfolioValue: 90000000,
    totalProperties: 8,
    occupiedUnits: 5,
    vacantUnits: 3,
    occupancyRate: 62,
    activeContracts: 5,
    collections: { total: 1000000, pagada: 600000, pendiente: 250000, vencida: 150000, rate: 60 },
    delinquency: { overdueAmount: 150000, rate: 12 },
    tickets: { open: 4, urgent: 1 },
    pendingLiquidaciones: 2,
    totalServices: 3,
    expiringContracts: { within30: 1, within60: 1, within90: 2 },
    propertiesByType: [
      { type: 'Departamento', count: 5 },
      { type: 'Casa', count: 3 },
    ],
    revenueTrend: [
      { month: 'Ago', expected: 1000000, collected: 900000 },
      { month: 'Sep', expected: 1100000, collected: 1000000 },
    ],
    agenda: {
      expiring: [
        { id: 'c1', property: 'Depto Uno', tenant: 'Luis Inventado', endDate: '2026-11-20T00:00:00.000Z', daysLeft: 20 },
        { id: 'c2', property: 'Depto Dos', tenant: 'Marta Ficticia', endDate: '2027-01-20T00:00:00.000Z', daysLeft: 70 },
        { id: 'c3', property: 'Casa Tres', tenant: 'Pedro Falso', endDate: '2027-01-25T00:00:00.000Z', daysLeft: 75 },
        { id: 'c4', property: 'Casa Cuatro', tenant: 'Sol Nadie', endDate: '2027-01-26T00:00:00.000Z', daysLeft: 80 },
      ],
      collections: [
        { id: 'p1', property: 'Depto Uno', period: '2026-11-01T00:00:00.000Z', amount: 100000, status: 'Vencida' },
        { id: 'p2', property: 'Depto Dos', period: '2026-11-01T00:00:00.000Z', amount: 120000, status: 'Pendiente' },
      ],
      tickets: [
        { id: 't1', title: 'Pérdida de agua', priority: 'Urgente', status: 'Abierto', property: 'Depto Uno' },
        { id: 't2', title: 'Timbre roto', priority: 'Baja', status: 'Abierto', property: 'Casa Tres' },
      ],
    },
    ...overrides,
  };
}

function mockApi(data: unknown, tenantFails = false) {
  apiClient.mockImplementation((path: string) => {
    if (path === '/tenants/me') {
      return tenantFails
        ? Promise.reject(new Error('sin tenant'))
        : Promise.resolve({ id: 'tn', name: 'Inmobiliaria Prueba', brandPrimary: '#112233' });
    }
    if (path === '/dashboard/stats') return Promise.resolve(data);
    return Promise.resolve({});
  });
}

describe('DashboardPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });

  it('muestra importes, KPIs y agenda con formato de lib/format', async () => {
    mockApi(stats());
    renderEs(<DashboardPage />);
    await screen.findByRole('heading', { level: 1, name: /Ana/ });
    expect(screen.getByText('Inmobiliaria Prueba')).toBeInTheDocument();
    expect(norm(document.body.textContent)).toContain('$ 1.250.000');
    expect(norm(document.body.textContent)).toContain('$ 250.000');
    expect(norm(document.body.textContent)).toContain('$ 100.000');
    expect(screen.getByText('60%', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Pérdida de agua')).toBeInTheDocument();
    expect(screen.getAllByText('20 d').length).toBeGreaterThan(0);
    expect(screen.getByText('Departamento')).toBeInTheDocument();
  });

  it('limita la agenda a tres filas y ofrece Ver todos con prefijo de idioma', async () => {
    mockApi(stats());
    renderEs(<DashboardPage />);
    const link = await screen.findByRole('link', { name: 'Ver todos (4)' });
    expect(link.getAttribute('href')).toBe('/es/contracts');
    expect(screen.queryByText('Casa Cuatro')).not.toBeInTheDocument();
  });

  it('enlaza las filas a sus detalles con /es/', async () => {
    mockApi(stats());
    renderEs(<DashboardPage />);
    await screen.findByText('Pérdida de agua');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/es/contracts/c1');
    expect(hrefs).toContain('/es/tickets/t1');
    expect(hrefs).toContain('/es/delinquency');
    for (const h of hrefs) expect(h).toMatch(/^\/es(\/|$)|^#|^http/);
  });

  it.each(['Admin', 'Gerente'])('%s ve prioridades y analítica de cartera', async (role) => {
    auth.role = role;
    mockApi(stats());
    renderEs(<DashboardPage />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByTestId('prioridades')).toBeInTheDocument();
    expect(screen.getByTestId('analitica')).toBeInTheDocument();
  });

  it.each(['Ventas', 'Liquidaciones', 'Soporte', 'Lectura'])(
    '%s no ve prioridades ni analítica',
    async (role) => {
      auth.role = role;
      mockApi(stats());
      renderEs(<DashboardPage />);
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByTestId('prioridades')).not.toBeInTheDocument();
      expect(screen.queryByTestId('analitica')).not.toBeInTheDocument();
    },
  );

  it('muestra estados vacíos de la agenda y sin cobranzas no divide por cero', async () => {
    mockApi(
      stats({
        collections: { total: 0, pagada: 0, pendiente: 0, vencida: 0, rate: 0 },
        delinquency: { overdueAmount: 0, rate: 0 },
        tickets: { open: 0, urgent: 0 },
        agenda: { expiring: [], collections: [], tickets: [] },
      }),
      true,
    );
    renderEs(<DashboardPage />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('No hay cobranzas pendientes.')).toBeInTheDocument();
    expect(screen.getByText('No hay tickets abiertos.')).toBeInTheDocument();
    expect(screen.getByText(/Sin contratos por vencer/)).toBeInTheDocument();
    expect(screen.queryByText('Inmobiliaria Prueba')).not.toBeInTheDocument();
  });

  it('muestra el error con reintento si fallan las estadísticas', async () => {
    apiClient.mockImplementation((path: string) =>
      path === '/tenants/me' ? Promise.resolve(null) : Promise.reject(new Error('caído')),
    );
    renderEs(<DashboardPage />);
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});
