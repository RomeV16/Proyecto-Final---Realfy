// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';

const { portalApiClient, downloadFile, toastError } = vi.hoisted(() => ({
  portalApiClient: vi.fn(),
  downloadFile: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/portal-api-client', () => ({
  portalApiClient: (...args: unknown[]) => portalApiClient(...args),
}));
vi.mock('@/lib/download', () => ({
  downloadFile: (...a: unknown[]) => downloadFile(...a),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/portal/liquidaciones',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import PortalInvoicesPage from './page';

const DAY = 86_400_000;
const nb = (s: string | null) => (s ?? '').replace(/[\u00a0\u202f]/g, ' ');
const day = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) + offset * DAY).toISOString();
};

/** Una liquidación como la devuelve GET /portal/liquidaciones. */
function invoice(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    contractId: 'c-1',
    period: '2026-11-01T00:00:00.000Z',
    status: 'Enviada',
    dueDate: day(5),
    subtotal: '100000',
    total: '100000',
    currency: 'ARS',
    paidAt: null,
    contract: { id: 'c-1', property: { id: 'p-1', title: 'Depto de prueba', street: 'Calle Falsa', number: '123', city: 'Ciudad Ejemplo' } },
    lineItems: [],
    _count: { payments: 0 },
    ...overrides,
  };
}

function mockInvoices(items: unknown[], total = items.length) {
  portalApiClient.mockResolvedValue({ items, total, page: 1, limit: 24, totalPages: 1 });
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="es" messages={es}>
        <PortalInvoicesPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const summaryText = async () => nb((await screen.findByRole('region', { name: 'Estado de cuenta' })).textContent);

describe('Facturas del portal del inquilino', () => {
  beforeEach(() => {
    portalApiClient.mockReset();
    downloadFile.mockReset();
    downloadFile.mockResolvedValue(undefined);
    toastError.mockReset();
  });

  it('con una factura por vencer muestra cuánto hay que pagar y en cuántos días vence', async () => {
    mockInvoices([invoice('i-1'), invoice('i-0', { status: 'Pagada', period: '2026-10-01T00:00:00.000Z', paidAt: day(-20) })]);
    mount();
    const text = await summaryText();
    expect(text).toContain('$ 100.000');
    expect(text).toContain('1 factura por pagar');
    expect(text).toContain('Noviembre de 2026 · vence en 5 días');
    expect(text).not.toContain('Vencido');
  });

  it('con facturas vencidas y por vencer separa lo vencido del resto', async () => {
    mockInvoices([
      invoice('i-2', { period: '2026-12-01T00:00:00.000Z', total: '120000', dueDate: day(8) }),
      invoice('i-1', { status: 'Vencida', total: '100000', dueDate: day(-3) }),
      invoice('i-0', { status: 'Borrador', period: '2027-01-01T00:00:00.000Z', total: '999999' }),
    ]);
    mount();
    const text = await summaryText();
    expect(text).toContain('$ 220.000');
    expect(text).toContain('1 factura vencida · 3 días de atraso');
    expect(text).toContain('Noviembre de 2026 · venció el');
    expect(text).toMatch(/Vencido \$ 100\.000 · Por vencer \$ 120\.000/);
  });

  it('sin deuda avisa que está al día', async () => {
    mockInvoices([invoice('i-0', { status: 'Pagada', paidAt: day(-2) })]);
    mount();
    const text = await summaryText();
    expect(text).toContain('Estás al día');
    expect(text).toContain('No tenés facturas pendientes');
  });

  it('sin facturas muestra el estado vacío y no el resumen', async () => {
    mockInvoices([]);
    mount();
    expect(await screen.findByText('Todavía no tenés facturas')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Estado de cuenta' })).not.toBeInTheDocument();
  });

  it('si la API falla lo avisa', async () => {
    portalApiClient.mockRejectedValue(new Error('caída de prueba'));
    mount();
    await waitFor(() => expect(document.body.textContent).toContain(es.portal.common.error));
  });

  it('descarga el PDF por la ruta del portal y avisa si falla', async () => {
    mockInvoices([invoice('i-1')]);
    const user = mount();
    await user.click(await screen.findByRole('button', { name: /PDF/ }));
    expect(downloadFile).toHaveBeenCalledWith('/portal/liquidaciones/i-1/pdf', 'factura-i-1.pdf', { portal: true });

    downloadFile.mockRejectedValueOnce(new Error('x'));
    await user.click(screen.getByRole('button', { name: /PDF/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it('pide más facturas cuando hay más de las que se ven', async () => {
    mockInvoices([invoice('i-1')], 40);
    const user = mount();
    await user.click(await screen.findByRole('button', { name: 'Ver más facturas' }));
    await waitFor(() => expect(portalApiClient).toHaveBeenCalledWith('/portal/liquidaciones?page=1&limit=48'));
  });
});
