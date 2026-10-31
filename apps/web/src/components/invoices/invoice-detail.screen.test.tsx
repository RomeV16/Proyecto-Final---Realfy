// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, downloadFile, toast } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  downloadFile: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => {
  const value = () => ({
    user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' },
  });
  return { useAuth: value, useOptionalAuth: value };
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/invoices/f-1',
}));
vi.mock('@/lib/toast', () => ({ toast }));
vi.mock('@/lib/download', () => ({
  downloadFile: (...args: unknown[]) => downloadFile(...args),
}));

import { InvoiceDetail } from './invoice-detail';

const norm = (s: string | null) => (s ?? '').replaceAll('\u00a0', ' ');

function factura(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f-1',
    type: 'FacturaA',
    puntoDeVenta: 3,
    comprobanteNumber: 128,
    receptorName: 'Cliente de Prueba SA',
    receptorCuit: '30-00000000-0',
    receptorFiscalCondition: 'ResponsableInscripto',
    amount: '121000',
    impNeto: '100000',
    impIva: '21000',
    ivaRate: 21,
    currency: 'ARS',
    cae: '70000000000001',
    caeExpiration: '2026-11-01T00:00:00.000Z',
    description: 'Honorarios de prueba',
    paymentId: 'pay-1',
    createdAt: '2026-11-01T12:00:00.000Z',
    ...overrides,
  };
}

function mockInvoice(data: unknown) {
  apiClient.mockImplementation((path: string) => {
    if (path === '/invoices/f-1') return Promise.resolve(data);
    return Promise.reject(new Error('not found'));
  });
}

describe('InvoiceDetail', () => {
  beforeEach(() => {
    apiClient.mockReset();
    downloadFile.mockReset();
    toast.error.mockReset();
    auth.role = 'Admin';
  });

  it('muestra montos, fechas y datos del receptor con formato es-AR', async () => {
    mockInvoice(factura());
    const { container } = renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    const text = norm(container.textContent);
    expect(text).toContain('$ 121.000,00');
    expect(text).toContain('$ 100.000,00');
    expect(text).toContain('$ 21.000,00');
    expect(text).toContain('(21%)');
    expect(text).toContain('0003-00000128');
    expect(text).toContain('1 de noviembre de 2026');
    expect(text).toContain('70000000000001');
    expect(text).toContain('Honorarios de prueba');
    expect(text).toContain('pay-1');
    expect(text).toContain('ARS');
  });

  it('el enlace de volver lleva el prefijo de idioma', async () => {
    mockInvoice(factura());
    renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    const back = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/es/invoices');
    expect(back).toBeTruthy();
  });

  it.each(['Admin', 'Gerente', 'Liquidaciones'])('%s ve emitir nota de crédito', async (role) => {
    auth.role = role;
    mockInvoice(factura());
    renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    const link = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href')?.includes('action=emit-nc'));
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')!.startsWith('/es/')).toBe(true);
  });

  it.each(['Ventas', 'Lectura', 'Soporte'])('%s no ve emitir nota de crédito', async (role) => {
    auth.role = role;
    mockInvoice(factura());
    renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    const link = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href')?.includes('action=emit-nc'));
    expect(link).toBeUndefined();
  });

  it('una nota de crédito muestra el signo negativo y el comprobante original', async () => {
    mockInvoice(
      factura({
        type: 'NotaCreditoA',
        originalComprobante: { id: 'f-0', type: 'FacturaA', puntoDeVenta: 3, comprobanteNumber: 100 },
      }),
    );
    const { container } = renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    expect(norm(container.textContent)).toContain('- $ 121.000,00');
    expect(norm(container.textContent)).toContain('0003-00000100');
    const orig = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/es/invoices/f-0');
    expect(orig).toBeTruthy();
    expect(
      screen.getAllByRole('link').find((a) => a.getAttribute('href')?.includes('action=emit-nc')),
    ).toBeUndefined();
  });

  it('omite secciones opcionales cuando faltan datos', async () => {
    mockInvoice(
      factura({
        receptorName: undefined,
        receptorCuit: undefined,
        receptorFiscalCondition: undefined,
        impNeto: 0,
        impIva: undefined,
        currency: undefined,
        cae: undefined,
        caeExpiration: undefined,
        description: undefined,
        paymentId: undefined,
        type: 'Otro',
      }),
    );
    const { container } = renderEs(<InvoiceDetail invoiceId="f-1" />);
    await waitFor(() => expect(container.textContent).toContain('—'));
    expect(container.textContent).not.toContain('Honorarios de prueba');
    expect(container.textContent).not.toContain('pay-1');
  });

  it('descarga el PDF con la ruta y el nombre esperados', async () => {
    mockInvoice(factura());
    downloadFile.mockResolvedValue(undefined);
    renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    await userEvent.setup().click(screen.getByRole('button'));
    await waitFor(() =>
      expect(downloadFile).toHaveBeenCalledWith('/invoices/f-1/pdf', 'comprobante-FacturaA-128.pdf'),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('si la descarga falla avisa con un error', async () => {
    mockInvoice(factura());
    downloadFile.mockRejectedValue(new Error('boom'));
    renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    await userEvent.setup().click(screen.getByRole('button'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('si la factura no existe muestra el estado vacío con enlace de vuelta', async () => {
    apiClient.mockRejectedValue(new Error('404'));
    renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByRole('heading', { level: 2 });
    const back = screen.getByRole('link');
    expect(back.getAttribute('href')).toBe('/es/invoices');
  });
});
