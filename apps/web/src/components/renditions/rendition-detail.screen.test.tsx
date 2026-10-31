// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';

const { apiClient, auth, downloadFile, toastError } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  downloadFile: vi.fn(),
  toastError: vi.fn(),
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
  usePathname: () => '/es/renditions/r-1',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));
vi.mock('@/lib/download', () => ({
  downloadFile: (...a: unknown[]) => downloadFile(...a),
}));

import { ApiRequestError } from '@/lib/api-client';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { RenditionDetail } from './rendition-detail';

const nb = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

function rendition(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    status: 'Borrador',
    month: 11,
    year: 2026,
    rentCollected: '100000',
    commissionAmount: '5000',
    adminFeeAmount: '2000',
    deductionTotal: '1500',
    netDeposit: '91500',
    notes: null,
    sentAt: null,
    depositedAt: null,
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-02T12:00:00.000Z',
    ownerName: 'Carla Ejemplo',
    contract: { id: 'c-1', property: { id: 'p-1', title: 'Depto de prueba' } },
    lineItems: [
      { id: 'li-1', type: 'Deduccion', description: 'Arreglo de canilla', amount: '1500', isDebit: true },
      { id: 'li-2', type: 'Ajuste', description: 'Ajuste a favor', amount: '300', isDebit: false },
    ],
    ...overrides,
  };
}

function mockApi(getData: () => unknown, onWrite: () => Promise<unknown> = () => Promise.resolve({})) {
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method) return onWrite();
    if (path === '/renditions/r-1') return Promise.resolve(getData());
    return Promise.resolve({});
  });
}

async function mount() {
  render(
    <NextIntlClientProvider locale="es" messages={es}>
      <ConfirmProvider>
        <RenditionDetail renditionId="r-1" />
      </ConfirmProvider>
    </NextIntlClientProvider>,
  );
  await screen.findByRole('heading', { level: 1 });
  return userEvent.setup();
}

describe('RenditionDetail', () => {
  beforeEach(() => {
    apiClient.mockReset();
    downloadFile.mockReset();
    toastError.mockReset();
    auth.role = 'Admin';
  });

  it('muestra el estado de no encontrada si falla la carga, con enlace con locale', async () => {
    apiClient.mockRejectedValue(new Error('boom'));
    render(
      <NextIntlClientProvider locale="es" messages={es}>
        <ConfirmProvider>
          <RenditionDetail renditionId="r-1" />
        </ConfirmProvider>
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText('Rendición no encontrada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Volver/ })).toHaveAttribute('href', '/es/renditions');
  });

  it('formatea importes y fechas y enlaza con prefijo de locale', async () => {
    mockApi(() => rendition({ status: 'Enviada', sentAt: '2026-11-03T12:00:00.000Z' }));
    await mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Noviembre 2026');
    expect(screen.getByText('Depto de prueba')).toBeInTheDocument();
    expect(screen.getByText(/Carla Ejemplo/)).toBeInTheDocument();
    const text = nb(document.body.textContent);
    expect(text).toContain('$ 100.000,00');
    expect(text).toContain('- $ 5.000,00');
    expect(text).toContain('- $ 2.000,00');
    expect(text).toContain('$ 91.500,00');
    expect(text).toContain('- $ 1.500,00');
    expect(text).toContain('$ 300,00');
    expect(text).toContain('Enviada el: 3 de noviembre de 2026');
    expect(text).toContain('Creada el: 1 de noviembre de 2026');
    for (const a of screen.getAllByRole('link')) expect(a.getAttribute('href')).toMatch(/^\/es\//);
  });

  it('oculta honorarios y deducciones en cero y muestra lista vacía y notas', async () => {
    mockApi(() => rendition({ adminFeeAmount: '0', deductionTotal: '0', lineItems: [], notes: 'Nota sintética' }));
    await mount();
    expect(screen.queryByText('Honorarios admin.')).not.toBeInTheDocument();
    expect(screen.queryByText('Deducciones')).not.toBeInTheDocument();
    expect(screen.getByText('No hay conceptos')).toBeInTheDocument();
    expect(screen.getByText('Nota sintética')).toBeInTheDocument();
  });

  it.each(['Admin', 'Gerente', 'Liquidaciones'])('%s ve las acciones de gestión', async (role) => {
    auth.role = role;
    mockApi(() => rendition());
    await mount();
    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar por Email/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar concepto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Eliminar' })).toHaveLength(2);
  });

  it.each(['Ventas', 'Lectura', 'Soporte'])('%s no ve las acciones de gestión pero sí el PDF', async (role) => {
    auth.role = role;
    mockApi(() => rendition());
    await mount();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar por Email/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar concepto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Descargar PDF/ })).toBeInTheDocument();
  });

  it('descarga el PDF con la ruta esperada', async () => {
    mockApi(() => rendition());
    const user = await mount();
    await user.click(screen.getByRole('button', { name: /Descargar PDF/ }));
    expect(downloadFile).toHaveBeenCalledWith('/renditions/r-1/pdf', 'rendicion-r-1.pdf');
  });

  it('avisa si falla la descarga del PDF', async () => {
    mockApi(() => rendition());
    downloadFile.mockRejectedValue(new Error('x'));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: /Descargar PDF/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('No se pudo descargar')));
  });

  it('aprueba la rendición y recarga', async () => {
    mockApi(() => rendition());
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Aprobar' }));
    expect(await screen.findByText('Estado actualizado correctamente')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/renditions/r-1/transition', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'Aprobada' }),
    });
  });

  it('muestra el mensaje de la API si la transición falla', async () => {
    mockApi(() => rendition(), () => Promise.reject(new ApiRequestError(400, 'BAD', 'Rechazada por prueba')));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Aprobar' }));
    expect(await screen.findByText('Rechazada por prueba')).toBeInTheDocument();
  });

  it('muestra el error genérico si la transición falla sin ApiRequestError', async () => {
    mockApi(() => rendition(), () => Promise.reject(new Error('x')));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Aprobar' }));
    expect(await screen.findByText('Error al cambiar estado')).toBeInTheDocument();
  });

  it('en Aprobada ofrece enviar y volver a borrador', async () => {
    mockApi(() => rendition({ status: 'Aprobada' }));
    const user = await mount();
    expect(screen.getByRole('button', { name: 'Enviar al Propietario' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Volver a Borrador' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/renditions/r-1/transition', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'Borrador' }),
      }),
    );
    expect(screen.queryByRole('button', { name: 'Agregar concepto' })).not.toBeInTheDocument();
  });

  it('en Enviada permite marcar depositada', async () => {
    mockApi(() => rendition({ status: 'Enviada' }));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Marcar Depositada' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/renditions/r-1/transition', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'Depositada' }),
      }),
    );
  });

  it('en Depositada muestra la fecha de depósito', async () => {
    mockApi(() => rendition({ status: 'Depositada', depositedAt: '2026-11-10T12:00:00.000Z' }));
    await mount();
    expect(nb(document.body.textContent)).toContain('Depositada el: 10 de noviembre de 2026');
  });

  it('envía por email tras confirmar', async () => {
    mockApi(() => rendition());
    const user = await mount();
    await user.click(screen.getByRole('button', { name: /Enviar por Email/ }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Email enviado exitosamente')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/renditions/r-1/send', { method: 'POST' });
  });

  it('no envía si se cancela la confirmación', async () => {
    mockApi(() => rendition());
    const user = await mount();
    await user.click(screen.getByRole('button', { name: /Enviar por Email/ }));
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(apiClient).not.toHaveBeenCalledWith('/renditions/r-1/send', expect.anything());
  });

  it('muestra el error al fallar el envío por email', async () => {
    mockApi(() => rendition(), () => Promise.reject(new Error('x')));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: /Enviar por Email/ }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Error al enviar email')).toBeInTheDocument();
  });

  it('edita y guarda las notas, y permite cancelar', async () => {
    mockApi(() => rendition({ notes: 'Previa' }));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('Previa')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    const area = screen.getByPlaceholderText('Agregar notas…');
    await user.clear(area);
    await user.type(area, 'Nueva');
    await user.click(screen.getByRole('button', { name: 'Guardar notas' }));
    expect(await screen.findByText('Notas guardadas')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/renditions/r-1/notes', {
      method: 'PATCH',
      body: JSON.stringify({ notes: 'Nueva' }),
    });
  });

  it('muestra error al fallar el guardado de notas', async () => {
    mockApi(() => rendition(), () => Promise.reject(new Error('x')));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    await user.click(screen.getByRole('button', { name: 'Guardar notas' }));
    expect(await screen.findByText('Error al guardar notas')).toBeInTheDocument();
  });

  it('agrega un concepto con el formulario', async () => {
    mockApi(() => rendition());
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Agregar concepto' }));
    await user.selectOptions(screen.getByRole('combobox'), 'Ajuste');
    await user.type(screen.getByPlaceholderText('Descripción del concepto'), 'Reintegro');
    await user.type(screen.getByPlaceholderText('0.00'), '250');
    await user.click(screen.getByRole('checkbox'));
    const submit = screen.getAllByRole('button', { name: 'Agregar concepto' }).at(-1)!;
    await user.click(submit);
    expect(await screen.findByText('Concepto agregado')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/renditions/r-1/line-items', {
      method: 'POST',
      body: JSON.stringify({ type: 'Ajuste', description: 'Reintegro', amount: 250, isDebit: false }),
    });
  });

  it('muestra error al fallar el alta de concepto y permite cancelar el formulario', async () => {
    mockApi(() => rendition(), () => Promise.reject(new Error('x')));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Agregar concepto' }));
    await user.type(screen.getByPlaceholderText('Descripción del concepto'), 'Algo');
    await user.type(screen.getByPlaceholderText('0.00'), '10');
    await user.click(screen.getAllByRole('button', { name: 'Agregar concepto' }).at(-1)!);
    expect(await screen.findByText('Error al agregar concepto')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByPlaceholderText('Descripción del concepto')).not.toBeInTheDocument();
  });

  it('elimina un concepto tras confirmar', async () => {
    mockApi(() => rendition());
    const user = await mount();
    await user.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]!);
    await user.click(await screen.findByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Concepto eliminado')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/renditions/r-1/line-items/li-1', { method: 'DELETE' });
  });

  it('muestra error al fallar la baja de concepto', async () => {
    mockApi(() => rendition(), () => Promise.reject(new Error('x')));
    const user = await mount();
    await user.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]!);
    await user.click(await screen.findByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Error al eliminar concepto')).toBeInTheDocument();
  });
});
