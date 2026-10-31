// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderEs } from '@/components/index-data/test-utils';

const { apiClient, failure } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  failure: { error: null as Error | null },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) =>
    failure.error ? Promise.reject(failure.error) : apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'Admin', firstName: 'Ana', lastName: 'Prueba' } }),
  useOptionalAuth: () => ({
    user: { id: 'u1', role: 'Admin', firstName: 'Ana', lastName: 'Prueba' },
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/pagos',
}));

import PagosPage from './page';

const norm = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

const payments = [
  {
    id: 'pay1',
    amount: '100000',
    currency: 'ARS',
    method: 'Transferencia',
    paidAt: '2026-11-01T12:00:00.000Z',
    liquidacion: { period: '2026-10-01T00:00:00.000Z' },
  },
  {
    id: 'pay2',
    amount: '50000.5',
    currency: 'ARS',
    method: 'MercadoPago',
    paidAt: '2026-10-05T12:00:00.000Z',
  },
  {
    id: 'pay3',
    amount: '1000',
    currency: 'USD',
    method: 'Criptomoneda',
    paidAt: '2026-10-06T12:00:00.000Z',
    liquidacion: { period: '2026-09-01T00:00:00.000Z' },
  },
];

function mockApi(items = payments) {
  apiClient.mockImplementation((path: string) => {
    if (path === '/payments?limit=30') return Promise.resolve({ items });
    if (path === '/payments/debt') {
      return Promise.resolve({
        pendiente: { count: 2, monto: 300000 },
        vencida: { count: 1, monto: 125000 },
      });
    }
    return Promise.resolve({});
  });
}

describe('PagosPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    failure.error = null;
  });

  it('muestra deuda pendiente, vencida y total cobrado con formato monetario', async () => {
    mockApi();
    renderEs(<PagosPage />);
    await screen.findByText('$ 300.000');
    const text = norm(document.body.textContent);
    expect(text).toContain('$ 125.000');
    expect(text).toContain('$ 151.001');
    expect(text).toContain('2 liquidaciones');
    expect(text).toContain('3 pagos registrados');
  });

  it('lista los pagos con período, medio de pago, fecha e importe', async () => {
    mockApi();
    renderEs(<PagosPage />);
    await screen.findByText('Transferencia bancaria');
    const text = norm(document.body.textContent);
    expect(text).toContain('Octubre de 2026');
    expect(text).toContain('Mercado Pago');
    expect(text).toContain('Criptomoneda');
    expect(text).toContain('$ 100.000');
    expect(text).toContain('01 de nov de 2026');
    expect(text).toContain('USD');
    expect(text).toContain('—');
  });

  it('sin pagos muestra el estado vacío', async () => {
    mockApi([]);
    renderEs(<PagosPage />);
    expect(await screen.findByText('Aún no se registraron pagos')).toBeInTheDocument();
    expect(screen.getByText('Sin pagos registrados')).toBeInTheDocument();
  });

  it('si fallan las llamadas muestra ceros y la lista vacía', async () => {
    failure.error = new Error('red');
    renderEs(<PagosPage />);
    expect(await screen.findByText('Aún no se registraron pagos')).toBeInTheDocument();
    await waitFor(() => expect(norm(document.body.textContent)).toContain('$ 0'));
  });
});
