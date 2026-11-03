// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEsWithQuery } from '../index-data/test-utils';
import { deposit, operation, page, PROPERTY_ID } from './sales.testing';

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

import { SalesPipeline } from './sales-pipeline';

const ops = [
  operation({
    status: 'Reservada',
    exclusive: true,
    agreedPrice: '115000.00',
    deposits: [deposit({ status: 'Recibida', expiresAt: '2000-01-01T00:00:00.000Z', expired: true })],
  }),
  operation({ id: 'op-2', parties: [], price: null, property: { id: 'p2', title: 'Casa Sintética', type: 'Casa', street: null, number: null, city: null } }),
];

function setup(role = 'Admin') {
  auth.role = role;
  apiClient.mockReset();
  apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.startsWith('/sales-operations/deposits/pending')) {
      return {
        ...page([{ ...deposit({ status: 'Recibida', receivedAt: '2026-11-01T00:00:00.000Z', unresolvedMoney: true }), salesOperation: { id: 'op-1', status: 'Reservada', property: { id: 'p1', title: 'Depto Sintético' } } }]),
        held: [{ currency: 'USD', holder: 'Inmobiliaria', amount: '2000.00' }],
      };
    }
    if (path.startsWith('/sales-operations') && init?.method === 'POST') return { id: 'new-op' };
    if (path.startsWith('/sales-operations')) return page(ops);
    if (path.startsWith('/properties?')) return { items: [{ id: PROPERTY_ID, title: 'Depto Buscado', street: 'Calle Ficticia', number: '100' }] };
    throw new Error(`ruta inesperada ${path}`);
  });
  renderEsWithQuery(<SalesPipeline />);
}

beforeEach(() => {
  apiClient.mockReset();
});

describe('Ventas: embudo', () => {
  it('lista las operaciones con sus partes, etapa, precio, documentación y vencimiento de la reserva', async () => {
    setup();
    const table = within(await screen.findByRole('table'));
    const row = within(table.getByRole('link', { name: 'Depto Sintético · Calle Ficticia 100' }).closest('tr')!);
    expect(row.getByText('Vera Sintético')).toBeInTheDocument();
    expect(row.getByText('Beto Sintético')).toBeInTheDocument();
    expect(row.getByText('Reservada')).toBeInTheDocument();
    expect(row.getByText('Exclusiva')).toBeInTheDocument();
    expect(row.getByText(/115\.000/)).toBeInTheDocument();
    expect(row.getByText('1 de 2 obligatorios')).toBeInTheDocument();
    expect(row.getByText(/Vencida/)).toBeInTheDocument();
    expect(table.getByRole('link', { name: 'Depto Sintético · Calle Ficticia 100' })).toHaveAttribute('href', expect.stringContaining('/ventas/'));
    expect(table.getByText('Sin vendedor cargado')).toBeInTheDocument();
    expect(table.getByText('Sin comprador cargado')).toBeInTheDocument();
  });

  it('los filtros viajan a la API', async () => {
    setup();
    await screen.findAllByText('Casa Sintética');
    await userEvent.selectOptions(screen.getByLabelText('Etapa'), 'Boleto');
    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'true');
    await userEvent.selectOptions(screen.getByLabelText('Exclusividad'), 'false');
    await waitFor(() => {
      const last = apiClient.mock.calls.at(-1)![0] as string;
      expect(last).toContain('status=Boleto');
      expect(last).toContain('open=true');
      expect(last).toContain('exclusive=false');
    });
  });

  it('las señas pendientes muestran el dinero sin resolver por quién lo guarda', async () => {
    setup();
    await screen.findAllByText('Casa Sintética');
    await userEvent.click(screen.getByRole('tab', { name: 'Señas pendientes' }));
    expect(await screen.findByText('Guarda: Inmobiliaria')).toBeInTheDocument();
    expect((await screen.findAllByRole('link', { name: 'Depto Sintético' })).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Recibida').length).toBeGreaterThan(0);
  });

  it('crear una operación: busca la propiedad, la elige y envía', async () => {
    setup();
    await screen.findAllByText('Casa Sintética');
    await userEvent.click(screen.getByRole('button', { name: 'Nueva operación de venta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear operación' }));
    expect(await screen.findByText('Elegí la propiedad.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^Propiedad/), 'Dep');
    await userEvent.click(await screen.findByRole('button', { name: 'Depto Buscado · Calle Ficticia 100' }));
    await userEvent.type(screen.getByLabelText('Precio de publicación'), '120000');
    await userEvent.selectOptions(within(screen.getByRole('dialog')).getByLabelText(/Exclusividad/), 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Crear operación' }));
    await waitFor(() => {
      const post = apiClient.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post?.[0]).toBe('/sales-operations');
      expect(JSON.parse(post![1].body)).toMatchObject({ propertyId: PROPERTY_ID, status: 'Captacion', price: '120000', currency: 'USD', exclusive: true });
    });
  });

  it('cambiar la propiedad elegida vuelve a mostrar el buscador', async () => {
    setup();
    await screen.findAllByText('Casa Sintética');
    await userEvent.click(screen.getByRole('button', { name: 'Nueva operación de venta' }));
    await userEvent.type(screen.getByLabelText(/^Propiedad/), 'Dep');
    await userEvent.click(await screen.findByRole('button', { name: 'Depto Buscado · Calle Ficticia 100' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(screen.getByLabelText(/^Propiedad/)).toBeInTheDocument();
  });

  it('Ventas puede crear; Lectura solo mira; Liquidaciones no entra', async () => {
    setup('Lectura');
    await screen.findAllByText('Casa Sintética');
    expect(screen.queryByRole('button', { name: 'Nueva operación de venta' })).not.toBeInTheDocument();
  });

  it('sin permiso muestra el aviso y no pide nada', () => {
    setup('Liquidaciones');
    expect(screen.getByText('No tenés permiso para ver las ventas.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});
