// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';

const { apiClient, auth } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' } }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/liquidaciones/l-1',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/download', () => ({ downloadFile: vi.fn() }));

import { ApiRequestError } from '@/lib/api-client';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { downloadFile } from '@/lib/download';
import { LiquidacionDetail } from './liquidacion-detail';

const nb = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

function liquidacion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l-1',
    status: 'Borrador',
    period: '2026-11-01T00:00:00.000Z',
    dueDate: '2026-11-10T12:00:00.000Z',
    totalAmount: '110000',
    currency: 'ARS',
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-02T12:00:00.000Z',
    contract: {
      id: 'c-1',
      property: { id: 'p-1', title: 'Depto de prueba', street: 'Calle Falsa 123', city: 'Ciudad Ejemplo' },
    },
    lineItems: [
      { id: 'li-1', type: 'Alquiler', description: 'Alquiler de noviembre [pid:abc]', amount: '100000' },
      { id: 'li-2', type: 'Extra', description: 'Expensas', amount: '15000' },
      { id: 'li-3', type: 'Descuento', description: 'Bonificación', amount: '5000' },
    ],
    payments: [],
    ...overrides,
  };
}

function mockApi(getData: () => unknown, onWrite: () => Promise<unknown> = () => Promise.resolve({})) {
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method) return onWrite();
    if (path === '/liquidaciones/l-1') return Promise.resolve(getData());
    return Promise.resolve({});
  });
}

function wrap() {
  return (
    <NextIntlClientProvider locale="es" messages={es}>
      <ConfirmProvider>
        <LiquidacionDetail liquidacionId="l-1" />
      </ConfirmProvider>
    </NextIntlClientProvider>
  );
}

async function mount() {
  render(wrap());
  await screen.findByRole('heading', { level: 1 });
  return userEvent.setup();
}

describe('LiquidacionDetail', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });

  it('muestra no encontrada si falla la carga', async () => {
    apiClient.mockRejectedValue(new Error('boom'));
    render(wrap());
    expect(await screen.findByText('Liquidación no encontrada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Volver/ })).toHaveAttribute('href', '/es/liquidaciones');
  });

  it('formatea importes, fechas y enlaces con locale', async () => {
    mockApi(() =>
      liquidacion({
        status: 'Enviada',
        payments: [{ id: 'pay-1', amount: '40000', method: 'Transferencia', reference: 'REF-1', paidAt: '2026-11-05T12:00:00.000Z' }],
      }),
    );
    await mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Noviembre 2026');
    const text = nb(document.body.textContent);
    expect(text).toContain('Calle Falsa 123, Ciudad Ejemplo');
    expect(text).toContain('Fecha de vencimiento: 10 de noviembre de 2026');
    expect(text).toContain('$ 110.000,00');
    expect(text).toContain('$ 115.000,00');
    expect(text).toContain('- $ 5.000,00');
    expect(text).toContain('$ 40.000,00');
    expect(text).toContain('5 de noviembre de 2026');
    expect(text).toContain('Transferencia bancaria');
    expect(text).toContain('REF-1');
    expect(text).toContain('$ 70.000,00');
    expect(text).toContain('Creada el: 1 de noviembre de 2026');
    expect(screen.getByText('Alquiler de noviembre')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver contrato/ })).toHaveAttribute('href', '/es/contracts/c-1');
    for (const a of screen.getAllByRole('link')) expect(a.getAttribute('href')).toMatch(/^\/es\//);
  });

  it('con saldo cubierto muestra pagada en su totalidad', async () => {
    mockApi(() =>
      liquidacion({
        status: 'Pagada',
        payments: [{ id: 'pay-1', amount: '110000', method: 'Efectivo', paidAt: '2026-11-05T12:00:00.000Z' }],
      }),
    );
    await mount();
    expect(screen.getByText('Pagada en su totalidad')).toBeInTheDocument();
  });

  it('sin conceptos ni pagos ni contrato muestra los vacíos y período derivado de month/year', async () => {
    mockApi(() =>
      liquidacion({ period: undefined, month: 3, year: 2027, lineItems: [], contract: undefined, dueDate: undefined }),
    );
    await mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Marzo 2027');
    expect(screen.getByText('No hay conceptos agregados')).toBeInTheDocument();
    expect(screen.getByText('No se registraron pagos')).toBeInTheDocument();
  });

  it('sin período muestra guion', async () => {
    mockApi(() => liquidacion({ period: undefined, lineItems: [], contract: undefined }));
    await mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('—');
  });

  it.each(['Admin', 'Gerente', 'Ventas', 'Liquidaciones'])('%s puede operar un borrador', async (role) => {
    auth.role = role;
    mockApi(() => liquidacion());
    await mount();
    expect(screen.getByRole('button', { name: 'Enviar a Revisión' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anular' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar concepto' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(3);
  });

  it.each(['Lectura', 'Soporte'])('%s no ve acciones sobre un borrador', async (role) => {
    auth.role = role;
    mockApi(() => liquidacion());
    await mount();
    expect(screen.queryByRole('button', { name: 'Enviar a Revisión' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar concepto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
  });

  it('en Enviada permite registrar pago para un rol habilitado y abre el formulario', async () => {
    mockApi(() => liquidacion({ status: 'Enviada' }));
    const user = await mount();
    expect(screen.queryByRole('button', { name: 'Agregar concepto' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar Pago' }));
    expect(screen.getAllByText('Registrar Pago').length).toBeGreaterThan(1);
  });

  it('en Vencida un rol de solo lectura no ve registrar pago', async () => {
    auth.role = 'Lectura';
    mockApi(() => liquidacion({ status: 'Vencida' }));
    await mount();
    expect(screen.queryByRole('button', { name: 'Registrar Pago' })).not.toBeInTheDocument();
  });

  it('transiciona sin confirmación y recarga', async () => {
    mockApi(() => liquidacion());
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Enviar a Revisión' }));
    expect(await screen.findByText('Estado actualizado correctamente')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/liquidaciones/l-1/transition', {
      method: 'POST',
      body: JSON.stringify({ status: 'Revision' }),
    });
  });

  it('anular pide confirmación y respeta la cancelación', async () => {
    mockApi(() => liquidacion());
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Anular' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Esta acción no se puede revertir');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(apiClient).not.toHaveBeenCalledWith('/liquidaciones/l-1/transition', expect.anything());
    await user.click(screen.getByRole('button', { name: 'Anular' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/liquidaciones/l-1/transition', {
        method: 'POST',
        body: JSON.stringify({ status: 'Anulada' }),
      }),
    );
  });

  it('muestra el mensaje de la API o el genérico si falla la transición', async () => {
    mockApi(() => liquidacion(), () => Promise.reject(new ApiRequestError(400, 'BAD', 'Transición inválida de prueba')));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Enviar a Revisión' }));
    expect(await screen.findByText('Transición inválida de prueba')).toBeInTheDocument();
  });

  it('muestra el error genérico si la transición falla sin ApiRequestError', async () => {
    mockApi(() => liquidacion(), () => Promise.reject(new Error('x')));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Enviar a Revisión' }));
    expect(await screen.findByText('Error al cambiar estado')).toBeInTheDocument();
  });

  it('agrega un concepto', async () => {
    mockApi(() => liquidacion());
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Agregar concepto' }));
    expect(screen.getByRole('heading', { name: 'Nuevo Concepto' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox'), 'Extra');
    await user.type(screen.getByPlaceholderText('Descripción del concepto'), 'Cochera');
    await user.type(screen.getByPlaceholderText('0.00'), '2500.5');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Concepto agregado')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/liquidaciones/l-1/line-items', {
      method: 'POST',
      body: JSON.stringify({ type: 'Extra', description: 'Cochera', amount: 2500.5 }),
    });
  });

  it('edita un concepto existente', async () => {
    mockApi(() => liquidacion());
    const user = await mount();
    await user.click(screen.getAllByRole('button', { name: 'Editar' })[1]!);
    expect(screen.getByRole('heading', { name: 'Editar Concepto' })).toBeInTheDocument();
    const desc = screen.getByPlaceholderText('Descripción del concepto');
    expect(desc).toHaveValue('Expensas');
    await user.clear(desc);
    await user.type(desc, 'Expensas extra');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Concepto actualizado')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/liquidaciones/l-1/line-items/li-2', {
      method: 'PATCH',
      body: JSON.stringify({ type: 'Extra', description: 'Expensas extra', amount: 15000 }),
    });
  });

  it('cancela el formulario de concepto y muestra error al fallar el guardado', async () => {
    mockApi(() => liquidacion(), () => Promise.reject(new Error('x')));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Agregar concepto' }));
    await user.click(screen.getAllByRole('button', { name: 'Cancelar' }).at(-1)!);
    expect(screen.queryByRole('heading', { name: 'Nuevo Concepto' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Agregar concepto' }));
    await user.selectOptions(screen.getByRole('combobox'), 'Alquiler');
    await user.type(screen.getByPlaceholderText('Descripción del concepto'), 'X');
    await user.type(screen.getByPlaceholderText('0.00'), '1');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Error al agregar concepto')).toBeInTheDocument();
  });

  it('elimina un concepto tras confirmar', async () => {
    mockApi(() => liquidacion());
    const user = await mount();
    await user.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]!);
    await user.click(await screen.findByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Concepto eliminado')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/liquidaciones/l-1/line-items/li-1', { method: 'DELETE' });
  });

  it('no elimina si se cancela y muestra error si falla', async () => {
    mockApi(() => liquidacion(), () => Promise.reject(new Error('x')));
    const user = await mount();
    await user.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]!);
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(apiClient).not.toHaveBeenCalledWith(expect.stringContaining('line-items/li-1'), expect.anything());
    await user.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]!);
    await user.click(await screen.findByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Error al eliminar concepto')).toBeInTheDocument();
  });

  describe('renglones con destino y recibo', () => {
    it('muestra el destino y si el renglón es comisionable', async () => {
      mockApi(() =>
        liquidacion({
          lineItems: [
            { id: 'li-1', type: 'Alquiler', description: 'Alquiler 11/2026', amount: '100000', beneficiary: 'Locador', commissionable: true },
            { id: 'li-2', type: 'Servicio', description: 'Gas 10/2026', amount: '4200', beneficiary: 'Ente', commissionable: false },
            { id: 'li-3', type: 'Honorario', description: 'Gestión', amount: '800', beneficiary: 'Inmobiliaria', commissionable: false },
          ],
        }),
      );
      await mount();
      expect(screen.getAllByText('Comisionable')).toHaveLength(1);
      expect(screen.getByText('Locador')).toBeInTheDocument();
      expect(screen.getByText('Ente o proveedor')).toBeInTheDocument();
      expect(screen.getByText('Inmobiliaria')).toBeInTheDocument();
      expect(screen.getByText('Servicio')).toBeInTheDocument();
    });

    it('muestra el número de recibo, el pago a cuenta y la marca de provisional', async () => {
      mockApi(() =>
        liquidacion({ status: 'Aprobada', kind: 'PagoACuenta', isProvisional: true, receiptNumber: '00000042' }),
      );
      await mount();
      expect(screen.getByText('Recibo Nº 00000042')).toBeInTheDocument();
      expect(screen.getByText('Pago a cuenta')).toBeInTheDocument();
      expect(screen.getByText('Provisional')).toBeInTheDocument();
    });

    it('sin número avisa que se numera al aprobar', async () => {
      mockApi(() => liquidacion());
      await mount();
      expect(screen.getByText('Se numera al aprobar')).toBeInTheDocument();
      expect(screen.queryByText('Provisional')).not.toBeInTheDocument();
    });

    it('Imprimir recibo descarga el PDF de la liquidación', async () => {
      mockApi(() => liquidacion({ status: 'Aprobada', receiptNumber: '00000042' }));
      vi.mocked(downloadFile).mockResolvedValue(undefined as never);
      const user = await mount();
      await user.click(screen.getByRole('button', { name: 'Imprimir recibo' }));
      expect(downloadFile).toHaveBeenCalledWith('/liquidaciones/l-1/pdf', 'recibo-00000042.pdf');
    });

    it('una liquidación anulada no ofrece imprimir', async () => {
      mockApi(() => liquidacion({ status: 'Anulada' }));
      await mount();
      expect(screen.queryByRole('button', { name: 'Imprimir recibo' })).not.toBeInTheDocument();
    });
  });
});
