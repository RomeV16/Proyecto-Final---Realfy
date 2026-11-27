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
    status: 'Emitido',
    cbteTipo: 1,
    puntoDeVenta: 3,
    numero: 128,
    issuerId: 'iss-1',
    receptorName: 'Cliente de Prueba SA',
    docNro: '30000000000',
    receptorFiscalCondition: 'ResponsableInscripto',
    impTotal: '121000',
    impNeto: '100000',
    impIva: '21000',
    currency: 'ARS',
    cae: '70000000000001',
    caeFchVto: '2026-11-11T00:00:00.000Z',
    paymentId: 'pay-1',
    payment: { method: 'Transferencia', reference: 'TRF 991', paidAt: '2026-10-30T15:00:00.000Z' },
    creditNotes: [],
    emittedAt: '2026-11-01T12:00:00.000Z',
    createdAt: '2026-11-01T12:00:00.000Z',
    ...overrides,
  };
}

const issuers = [
  { id: 'iss-1', cuit: '20-32145678-3', businessName: 'Inmobiliaria de Prueba', fiscalCondition: 'ResponsableInscripto' },
];

function mockInvoice(data: unknown, certificate: unknown = null) {
  apiClient.mockImplementation((path: string) => {
    if (path === '/invoices/f-1') return Promise.resolve(data);
    if (path === '/invoices/issuers') return Promise.resolve(issuers);
    if (path === '/invoices/certificate') return Promise.resolve(certificate);
    return Promise.reject(new Error('not found'));
  });
}

const ncLink = () => screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/es/invoices/f-1/nc');

describe('InvoiceDetail', () => {
  beforeEach(() => {
    apiClient.mockReset();
    downloadFile.mockReset();
    toast.error.mockReset();
    auth.role = 'Admin';
  });

  it('se lee como el comprobante: emisor, letra, receptor, importes y CAE con formato es-AR', async () => {
    mockInvoice(factura());
    const { container } = renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    const text = norm(container.textContent);
    expect(text).toContain('Inmobiliaria de Prueba');
    expect(text).toContain('CUIT 20-32145678-3');
    expect(text).toContain('Cód. 001');
    expect(text).toContain('0003-00000128');
    expect(text).toContain('30-00000000-0');
    expect(text).toContain('Responsable Inscripto');
    expect(text).toContain('$ 121.000,00');
    expect(text).toContain('$ 100.000,00');
    expect(text).toContain('$ 21.000,00');
    expect(text).toContain('1/11/2026');
    expect(text).toContain('70000000000001');
    expect(text).toContain('11/11/2026');
    expect(text).toContain('Autorizado');
    expect(text).toContain('Transferencia bancaria · TRF 991');
    expect(text).not.toContain('pay-1');
    expect(text).not.toContain('undefined');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('con certificado de homologación avisa que el comprobante es de prueba', async () => {
    mockInvoice(factura(), { isProduction: false });
    renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    expect(await screen.findByRole('note')).toHaveTextContent(/Homologación/);
  });

  it('con certificado de producción no muestra el aviso de prueba', async () => {
    mockInvoice(factura(), { isProduction: true });
    renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/invoices/certificate'));
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('una factura C sin IVA muestra solo el total', async () => {
    mockInvoice(factura({ type: 'FacturaC', cbteTipo: 11, impNeto: '121000', impIva: '0' }));
    const { container } = renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    const text = norm(container.textContent);
    expect(text).toContain('Cód. 011');
    expect(text).not.toContain('Importe neto');
    expect(text).not.toContain('IVA$');
    expect(text).toContain('$ 121.000,00');
  });

  it('el enlace de volver lleva el prefijo de idioma', async () => {
    mockInvoice(factura());
    renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    const back = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/es/invoices');
    expect(back).toBeTruthy();
  });

  it.each(['Admin', 'Gerente', 'Liquidaciones'])('%s ve emitir nota de crédito, que lleva al formulario', async (role) => {
    auth.role = role;
    mockInvoice(factura());
    renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    expect(ncLink()).toBeTruthy();
    expect(ncLink()).toHaveTextContent('Emitir nota de crédito');
  });

  it.each(['Ventas', 'Lectura', 'Soporte'])('%s no ve emitir nota de crédito', async (role) => {
    auth.role = role;
    mockInvoice(factura());
    renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    expect(ncLink()).toBeUndefined();
  });

  it('una nota de crédito muestra el signo negativo y el comprobante original', async () => {
    mockInvoice(
      factura({
        type: 'NotaCreditoA',
        cbteTipo: 3,
        originalComprobante: { id: 'f-0', type: 'FacturaA', puntoDeVenta: 3, numero: 100 },
      }),
    );
    const { container } = renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    expect(norm(container.textContent)).toContain('- $ 121.000,00');
    expect(norm(container.textContent)).toContain('Factura A 0003-00000100');
    const orig = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/es/invoices/f-0');
    expect(orig).toBeTruthy();
    expect(ncLink()).toBeUndefined();
  });

  it('una factura con nota de crédito la enlaza y cambia el estado', async () => {
    mockInvoice(
      factura({ creditNotes: [{ id: 'nc-9', type: 'NotaCreditoA', puntoDeVenta: 3, numero: 9, impTotal: '1000' }] }),
    );
    const { container } = renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    expect(norm(container.textContent)).toContain('Con nota de crédito');
    expect(norm(container.textContent)).toContain('Nota de Crédito A 0003-00000009');
    expect(norm(container.textContent)).toContain('- $ 1.000,00');
    expect(screen.getAllByRole('link').some((a) => a.getAttribute('href') === '/es/invoices/nc-9')).toBe(true);
  });

  it('sin datos opcionales ni emisor legible igual muestra el comprobante', async () => {
    apiClient.mockImplementation((path: string) => {
      if (path === '/invoices/f-1') {
        return Promise.resolve(
          factura({
            receptorName: undefined,
            docNro: undefined,
            receptorFiscalCondition: undefined,
            impNeto: 0,
            impIva: undefined,
            currency: undefined,
            cae: undefined,
            caeFchVto: undefined,
            payment: undefined,
            type: 'Otro',
          }),
        );
      }
      return Promise.reject(new Error('sin permiso'));
    });
    const { container } = renderEs(<InvoiceDetail invoiceId="f-1" />);
    await waitFor(() => expect(container.textContent).toContain('Sin datos del emisor'));
    const text = norm(container.textContent);
    expect(text).toContain('Sin dato');
    expect(text).toContain('CAE pendiente');
    expect(text).toContain('$ 121.000,00');
    expect(text).not.toContain('Transferencia');
  });

  it('descarga el PDF con la ruta y el nombre esperados', async () => {
    mockInvoice(factura());
    downloadFile.mockResolvedValue(undefined);
    renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() =>
      expect(downloadFile).toHaveBeenCalledWith('/invoices/f-1/pdf', 'comprobante-FacturaA-0003-00000128.pdf'),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('si la descarga falla avisa con un error', async () => {
    mockInvoice(factura());
    downloadFile.mockRejectedValue(new Error('boom'));
    renderEs(<InvoiceDetail invoiceId="f-1" />);
    await screen.findByText('Cliente de Prueba SA');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Descargar PDF' }));
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
