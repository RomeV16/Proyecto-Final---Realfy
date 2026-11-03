// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEsWithQuery } from '../index-data/test-utils';
import { operation, PROPERTY_ID } from './sales.testing';
import type { SalesOperation } from '@/lib/sales';

const { apiClient, auth } = vi.hoisted(() => ({ apiClient: vi.fn(), auth: { role: 'Admin' } }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { PropertySalesCard } from './property-sales-card';

const property = { id: PROPERTY_ID, title: 'Depto Sintético', street: 'Calle Ficticia', number: '100' };

function setup(items: SalesOperation[], role = 'Admin') {
  auth.role = role;
  apiClient.mockReset();
  apiClient.mockImplementation(async (_path: string, init?: { method?: string }) => (init?.method ? { id: 'new' } : { items }));
  renderEsWithQuery(<PropertySalesCard property={property} />);
}

beforeEach(() => {
  apiClient.mockReset();
});

describe('Ventas de la propiedad', () => {
  it('sin operaciones ofrece iniciar una venta con la propiedad ya elegida', async () => {
    setup([]);
    expect(await screen.findByText('Esta propiedad todavía no tiene operaciones de venta.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar venta' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Depto Sintético · Calle Ficticia 100')).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Crear operación' }));
    await waitFor(() => {
      const post = apiClient.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post?.[0]).toBe('/sales-operations');
      expect(JSON.parse(post![1].body)).toMatchObject({ propertyId: PROPERTY_ID, status: 'Captacion', exclusive: false });
    });
  });

  it('con una operación abierta la lista con su etapa y no ofrece iniciar otra', async () => {
    setup([operation({ status: 'Boleto', agreedPrice: '115000.00' }), operation({ id: 'old', status: 'Escriturada', escrituraDate: '2026-05-01T00:00:00.000Z' })]);
    expect(await screen.findAllByRole('link', { name: 'Operación de venta' })).toHaveLength(2);
    expect(screen.getByText('Boleto')).toBeInTheDocument();
    expect(screen.getByText('Escriturada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar venta' })).not.toBeInTheDocument();
  });

  it('una operación cerrada permite iniciar otra', async () => {
    setup([operation({ status: 'Cancelada' })]);
    expect(await screen.findByRole('button', { name: 'Iniciar venta' })).toBeInTheDocument();
  });

  it('Lectura mira sin iniciar ventas; Liquidaciones no ve la sección', async () => {
    setup([], 'Lectura');
    await screen.findByText('Esta propiedad todavía no tiene operaciones de venta.');
    expect(screen.queryByRole('button', { name: 'Iniciar venta' })).not.toBeInTheDocument();
  });

  it('sin permiso no se muestra ni se pide nada', () => {
    setup([], 'Liquidaciones');
    expect(screen.queryByText('Esta propiedad todavía no tiene operaciones de venta.')).not.toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});
