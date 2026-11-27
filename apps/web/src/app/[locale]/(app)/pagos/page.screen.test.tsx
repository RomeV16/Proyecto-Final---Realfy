// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const norm = (s: string | null) => (s ?? '').replace(/[\u00a0\u202f]/g, ' ');

const CONTRACT = 'c-1';

const payments = [
  {
    id: 'pay1',
    amount: '100000',
    currency: 'ARS',
    method: 'Transferencia',
    paidAt: '2026-11-01T12:00:00.000Z',
    reference: 'TRF 1203',
    liquidacion: { period: '2026-10-01T00:00:00.000Z', contract: { id: CONTRACT } },
  },
  {
    id: 'pay1b',
    amount: '25000.5',
    currency: 'ARS',
    method: 'Efectivo',
    paidAt: '2026-11-01T15:00:00.000Z',
    liquidacion: { period: '2026-11-01T00:00:00.000Z', contract: { id: 'otro' } },
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

const contracts = [
  {
    id: CONTRACT,
    property: { title: 'Depto Sintético' },
    persons: [
      { role: 'Propietario', person: { firstName: 'Olga', lastName: 'Dueña' } },
      { role: 'Inquilino', person: { firstName: 'Iván', lastName: 'Ficticio' } },
    ],
  },
];

function mockApi(items = payments, total = items.length) {
  apiClient.mockImplementation((path: string) => {
    if (path === '/payments?limit=200') return Promise.resolve({ items, total });
    if (path === '/payments/debt') {
      return Promise.resolve({
        pendiente: { count: 2, monto: 300000 },
        vencida: { count: 1, monto: 125000 },
      });
    }
    if (path === '/contracts?limit=100') return Promise.resolve({ items: contracts });
    if (path.endsWith('/invoices')) return Promise.resolve({ comprobantes: [], jobs: [] });
    return Promise.resolve({});
  });
}

describe('PagosPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    failure.error = null;
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T12:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resume el mes en curso: cobrado, reparto por medio de pago y deuda', async () => {
    mockApi();
    renderEs(<PagosPage />);
    expect(await screen.findByRole('heading', { name: 'Noviembre de 2026' })).toBeInTheDocument();
    const summary = within(screen.getByRole('region', { name: 'Resumen del mes' }));
    const collected = norm(summary.getByText('Cobrado en el mes').parentElement!.textContent);
    expect(collected).toContain('$ 125.000,50');
    expect(collected).toContain('2 pagos registrados');
    const all = norm(document.body.textContent);
    expect(all).toContain('80 %');
    expect(all).toContain('20 %');
    expect(all).toContain('$ 125.000');
    expect(all).toContain('$ 300.000');
    expect(all).toContain('2 liquidaciones');
    expect(all).toContain('Mes en curso');
    expect(summary.getByRole('link', { name: /Ir a cobranza/ })).toBeInTheDocument();
  });

  it('el extracto agrupa por día con propiedad, inquilino, referencia, medio y totales', async () => {
    mockApi();
    renderEs(<PagosPage />);
    const statement = within(await screen.findByRole('region', { name: 'Extracto de cobros' }));
    expect(await statement.findByText('Depto Sintético')).toBeInTheDocument();
    expect(statement.getByText('Liquidación de octubre de 2026 · Iván Ficticio · Ref. TRF 1203')).toBeInTheDocument();
    // Un contrato que no vino en la lista se nombra por su período.
    expect(statement.getByText('Liquidación de noviembre de 2026')).toBeInTheDocument();
    expect(statement.getByText('Transferencia')).toBeInTheDocument();
    expect(statement.getByText('Efectivo')).toBeInTheDocument();
    const text = norm(document.body.textContent);
    expect(text).toContain('$ 100.000,00');
    expect(text).toContain('Total del día · 2 pagos');
    expect(text).toContain('Total del mes · 2 pagos');
    expect(text).toContain('Domingo');
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-01');
  });

  it('las flechas recorren los meses con cobros; otra moneda y un medio desconocido se muestran tal cual', async () => {
    const user = userEvent.setup();
    mockApi();
    renderEs(<PagosPage />);
    await screen.findByRole('heading', { name: 'Noviembre de 2026' });
    expect(screen.getByRole('button', { name: 'Mes siguiente' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Mes anterior' }));
    expect(screen.getByRole('heading', { name: 'Octubre de 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mes anterior' })).toBeDisabled();
    const text = norm(document.body.textContent);
    expect(text).toContain('Criptomoneda');
    expect(text).toContain('US$ 1.000,00');
    expect(text).toContain('Además, US$ 1.000,00 en 1 pago');
    expect(text).toContain('Cobro sin liquidación asociada');
    expect(text).toContain('Sin referencia');
    expect(text).not.toContain('Mes en curso');
    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(screen.getByRole('heading', { name: 'Noviembre de 2026' })).toBeInTheDocument();
  });

  it('sin cobros en el mes en curso abre el último mes con cobros y avisa si el extracto está recortado', async () => {
    mockApi(payments.slice(2), 500);
    renderEs(<PagosPage />);
    expect(await screen.findByRole('heading', { name: 'Octubre de 2026' })).toBeInTheDocument();
    expect(screen.getByText('El extracto cubre los últimos 2 pagos de 500.')).toBeInTheDocument();
  });

  it('abre la facturación por cuenta del locador de un pago', async () => {
    const user = userEvent.setup();
    mockApi();
    renderEs(<PagosPage />);
    const buttons = await screen.findAllByRole('button', { name: 'Facturación' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[0]);
    expect(await screen.findByText('Facturación del cobro por cuenta del locador')).toBeInTheDocument();
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/payments/pay1/invoices'));
  });

  it('sin pagos muestra el estado vacío y el resumen en cero', async () => {
    mockApi([]);
    renderEs(<PagosPage />);
    expect(await screen.findByText('Aún no se registraron pagos')).toBeInTheDocument();
    expect(screen.getByText('Sin pagos registrados')).toBeInTheDocument();
    expect(screen.getByText('Sin cobros en este mes.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mes anterior' })).not.toBeInTheDocument();
  });

  it('si falla la carga lo avisa y reintentar vuelve a pedir los pagos', async () => {
    const user = userEvent.setup();
    failure.error = new Error('red');
    renderEs(<PagosPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los pagos.');
    expect(screen.queryByText('Aún no se registraron pagos')).not.toBeInTheDocument();
    failure.error = null;
    mockApi();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Noviembre de 2026' })).toBeInTheDocument();
  });

  it('si solo falla la deuda lo dice sin romper el extracto', async () => {
    apiClient.mockImplementation((path: string) => {
      if (path === '/payments?limit=200') return Promise.resolve({ items: payments });
      return Promise.reject(new Error('red'));
    });
    renderEs(<PagosPage />);
    expect(await screen.findByText('No se pudo calcular la deuda.')).toBeInTheDocument();
    expect(screen.getByText('Ref. TRF 1203')).toBeInTheDocument();
  });
});
