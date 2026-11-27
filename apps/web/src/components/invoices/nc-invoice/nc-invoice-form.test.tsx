// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmitNotaCreditoDtoSchema } from '@realfy/shared';
import { renderEs } from '../../index-data/test-utils';

const { apiClient, push } = vi.hoisted(() => ({ apiClient: vi.fn(), push: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/invoices/f-1/nc',
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

import { NcInvoiceForm } from './nc-invoice-form';

const ORIGINAL = {
  id: 'f-1',
  type: 'FacturaC',
  puntoDeVenta: 1,
  numero: 2,
  cbteTipo: 11,
  concepto: 2,
  issuerId: '506bf2a6-1397-42e1-ac08-d585e18912dc',
  impTotal: '634047.39',
  impNeto: '634047.39',
  impIva: '0',
  receptorName: 'Diego Sosa',
  receptorFiscalCondition: 'ConsumidorFinal',
  docNro: '23319273964',
  docTipo: 80,
  condicionIVAReceptorId: 5,
  emittedAt: '2026-10-29T12:00:00.000Z',
};

function mockApi(emit: () => Promise<unknown> = () => Promise.resolve({ id: 'nc-9' }), certificate: unknown = null) {
  apiClient.mockImplementation((path: string) => {
    if (path === '/invoices/f-1') return Promise.resolve(ORIGINAL);
    if (path === '/invoices/certificate') return Promise.resolve(certificate);
    if (path === '/invoices/emit-nc') return emit();
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

const emitCalls = () => apiClient.mock.calls.filter(([path]) => path === '/invoices/emit-nc');

describe('NcInvoiceForm', () => {
  beforeEach(() => {
    apiClient.mockReset();
    push.mockReset();
  });

  it('muestra el comprobante que se acredita y propone el total', async () => {
    mockApi(undefined, { isProduction: false });
    const { container } = renderEs(<NcInvoiceForm originalInvoiceId="f-1" />);
    expect(await screen.findByLabelText(/Importe a acreditar/)).toHaveValue(634047.39);
    const text = (container.textContent ?? '').replaceAll(' ', ' ');
    expect(text).toContain('Factura C 0001-00000002');
    expect(text).toContain('Diego Sosa · 23-31927396-4');
    expect(text).toContain('Hasta $ 634.047,39');
    expect(await screen.findByRole('note')).toHaveTextContent(/Homologación/);
    expect(screen.getByRole('button', { name: 'Emitir nota de crédito' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Volver al comprobante' })).toHaveAttribute('href', '/es/invoices/f-1');
  });

  it('emite con un cuerpo que la API acepta y abre la nota de crédito', async () => {
    mockApi();
    renderEs(<NcInvoiceForm originalInvoiceId="f-1" />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Motivo/), 'Error en el importe');
    const amount = screen.getByLabelText(/Importe a acreditar/);
    await user.clear(amount);
    await user.type(amount, '1000.50');
    await user.click(screen.getByRole('button', { name: 'Emitir nota de crédito' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/es/invoices/nc-9'));
    const body = JSON.parse((emitCalls()[0][1] as { body: string }).body);
    expect(EmitNotaCreditoDtoSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      cbteTipo: 13,
      ptoVta: 1,
      impTotal: '1000.50',
      impNeto: '1000.50',
      impIVA: '0.00',
      description: 'Error en el importe',
      cbtesAsoc: [{ tipo: 11, ptoVta: 1, nro: 2 }],
    });
  });

  it('no deja acreditar más que el comprobante original', async () => {
    mockApi();
    renderEs(<NcInvoiceForm originalInvoiceId="f-1" />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Motivo/), 'Anulación');
    const amount = screen.getByLabelText(/Importe a acreditar/);
    await user.clear(amount);
    await user.type(amount, '700000');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Emitir nota de crédito' })).toBeDisabled();
    expect(emitCalls()).toHaveLength(0);
  });

  it('si ARCA rechaza la emisión avisa y deja reintentar', async () => {
    mockApi(() => Promise.reject(new Error('caído')));
    renderEs(<NcInvoiceForm originalInvoiceId="f-1" />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Motivo/), 'Anulación');
    await user.click(screen.getByRole('button', { name: 'Emitir nota de crédito' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo emitir la nota de crédito');
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Emitir nota de crédito' })).toBeEnabled();
  });

  it('cancelar vuelve al comprobante', async () => {
    mockApi();
    renderEs(<NcInvoiceForm originalInvoiceId="f-1" />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(push).toHaveBeenCalledWith('/es/invoices/f-1');
  });

  it('si el comprobante no existe lo dice y ofrece volver', async () => {
    apiClient.mockRejectedValue(new Error('404'));
    renderEs(<NcInvoiceForm originalInvoiceId="f-1" />);
    expect(await screen.findByRole('heading', { level: 2 })).toHaveTextContent('No encontramos ese comprobante');
    expect(screen.getByRole('link', { name: 'Volver a facturación' })).toHaveAttribute('href', '/es/invoices');
  });
});
