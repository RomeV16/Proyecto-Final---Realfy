// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  usePathname: () => '/es/liquidaciones',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));
vi.mock('@/lib/download', () => ({
  downloadFile: (...a: unknown[]) => downloadFile(...a),
}));

import { ApiRequestError } from '@/lib/api-client';
import { LiquidacionList } from './liquidacion-list';

const nb = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

function item(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'Enviada',
    period: '2026-11-01T00:00:00.000Z',
    dueDate: '2026-11-10T12:00:00.000Z',
    totalAmount: '100000',
    contract: { id: 'c-1', property: { id: 'p-1', title: 'Depto de prueba', street: 'Calle Falsa 123', city: 'Ciudad Ejemplo' } },
    _count: { payments: 0 },
    ...overrides,
  };
}

function page(items: unknown[], extra: Record<string, unknown> = {}) {
  return { items, total: items.length, page: 1, limit: 12, totalPages: 1, ...extra };
}

function mockList(getPage: (path: string) => unknown, onWrite: () => Promise<unknown> = () => Promise.resolve({})) {
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method) return onWrite();
    return Promise.resolve(getPage(path));
  });
}

function wrap() {
  return (
    <NextIntlClientProvider locale="es" messages={es}>
      <LiquidacionList />
    </NextIntlClientProvider>
  );
}

async function mount() {
  render(wrap());
  await screen.findByRole('heading', { level: 1, name: 'Liquidaciones' });
  return userEvent.setup();
}

describe('LiquidacionList', () => {
  beforeEach(() => {
    apiClient.mockReset();
    downloadFile.mockReset();
    downloadFile.mockResolvedValue(undefined);
    toastError.mockReset();
    auth.role = 'Admin';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('muestra tarjetas con importe, período, vencimiento y enlaces con locale', async () => {
    mockList(() =>
      page([
        item('l-1', { _count: { payments: 2 } }),
        item('l-2', { status: 'Vencida' }),
        item('l-3', { status: 'Borrador', month: 12, year: 2026, period: undefined, dueDate: undefined, contract: undefined }),
        item('l-4', { status: 'Pagada', total: undefined, totalAmount: undefined, subtotal: '5000' }),
        item('l-5', { status: 'Anulada' }),
      ]),
    );
    await mount();
    await screen.findByText('Diciembre 2026');
    const text = nb(document.body.textContent);
    expect(text).toContain('$ 100.000,00');
    expect(text).toContain('$ 5.000,00');
    expect(text).toContain('Noviembre 2026');
    expect(text).toMatch(/Vence: 10 de nov/);
    expect(text).toMatch(/Vencida desde el 10 de nov/);
    expect(text).toContain('Sin propiedad asociada');
    expect(text).toContain('Calle Falsa 123');
    expect(text).toContain('Pendiente de aprobación');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/es/liquidaciones/l-1');
    for (const h of hrefs) expect(h).toMatch(/^\/es\//);
    // la anulada no ofrece PDF
    expect(screen.getAllByRole('button', { name: 'PDF' })).toHaveLength(4);
  });

  it('descarga el PDF con la ruta esperada y avisa si falla', async () => {
    mockList(() => page([item('l-1')]));
    const user = await mount();
    await user.click(await screen.findByRole('button', { name: 'PDF' }));
    expect(downloadFile).toHaveBeenCalledWith('/liquidaciones/l-1/pdf', 'liquidacion-l-1.pdf');

    downloadFile.mockRejectedValueOnce(new Error('x'));
    await user.click(screen.getByRole('button', { name: 'PDF' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('No se pudo descargar')));
  });

  it.each(['Admin', 'Gerente'])('%s ve generar mes y la selección masiva', async (role) => {
    auth.role = role;
    mockList(() => page([item('l-1'), item('l-2')]));
    await mount();
    expect(screen.getByRole('button', { name: 'Generar Mes' })).toBeInTheDocument();
    expect(await screen.findByText('Seleccionar todas')).toBeInTheDocument();
  });

  it.each(['Ventas', 'Liquidaciones', 'Lectura', 'Soporte'])('%s no ve generar ni selección masiva', async (role) => {
    auth.role = role;
    mockList(() => page([item('l-1')]));
    await mount();
    await screen.findByText('Depto de prueba — Calle Falsa 123 — Ciudad Ejemplo');
    expect(screen.queryByRole('button', { name: 'Generar Mes' })).not.toBeInTheDocument();
    expect(screen.queryByText('Seleccionar todas')).not.toBeInTheDocument();
  });

  it('vacío sin filtros ofrece generar solo a quien puede', async () => {
    mockList(() => page([]));
    await mount();
    expect(await screen.findByText('No hay liquidaciones')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Generar Mes/ }).length).toBeGreaterThan(1);
  });

  it('vacío para un rol sin permiso no ofrece generar', async () => {
    auth.role = 'Ventas';
    mockList(() => page([]));
    await mount();
    expect(await screen.findByText('No hay liquidaciones')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generar Mes/ })).not.toBeInTheDocument();
  });

  it('si la API falla muestra el vacío', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'BOOM', 'caída de prueba'));
    await mount();
    expect(await screen.findByText('No hay liquidaciones')).toBeInTheDocument();
  });

  it('filtra por estado, mes y año y permite limpiar', async () => {
    mockList(() => page([item('l-1')]));
    const user = await mount();
    await screen.findByText('Noviembre 2026');
    await user.selectOptions(screen.getByLabelText('Estado'), 'Pagada');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(expect.stringContaining('status=Pagada')));
    await user.selectOptions(screen.getByLabelText('Mes'), '11');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(expect.stringContaining('month=11')));
    const year = String(new Date().getFullYear());
    await user.selectOptions(screen.getByLabelText('Año'), year);
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(expect.stringContaining(`year=${year}`)));
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument());
  });

  it('con filtros y sin resultados muestra el vacío filtrado', async () => {
    mockList((path) => (path.includes('status=Anulada') ? page([]) : page([item('l-1')])));
    const user = await mount();
    await screen.findByText('Noviembre 2026');
    await user.selectOptions(screen.getByLabelText('Estado'), 'Anulada');
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
    expect(screen.getByText('No se encontraron liquidaciones con los filtros aplicados')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Limpiar filtros' });
    await user.click(buttons.at(-1)!);
    expect(await screen.findByText('Noviembre 2026')).toBeInTheDocument();
  });

  it('pagina hacia adelante y atrás', async () => {
    mockList((path) =>
      page([item('l-1')], { total: 30, totalPages: 3, page: path.includes('page=2') ? 2 : 1 }),
    );
    const user = await mount();
    expect(await screen.findByText('Mostrando 1-12 de 30')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('Mostrando 13-24 de 30')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByText('Mostrando 1-12 de 30')).toBeInTheDocument();
  });

  it('genera liquidaciones del mes', async () => {
    mockList(() => page([item('l-1')]), () => Promise.resolve({ created: 4, skipped: 0 }));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Generar Mes' }));
    expect(screen.getByText('Generar Liquidaciones del Mes')).toBeInTheDocument();
    await user.selectOptions(screen.getAllByRole('combobox').at(-2)!, '3');
    await user.click(screen.getByRole('button', { name: 'Generar' }));
    expect(await screen.findByText('4 liquidaciones generadas')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/liquidaciones/generate', {
      method: 'POST',
      body: JSON.stringify({ month: 3, year: new Date().getFullYear() }),
    });
    expect(screen.queryByText('Generar Liquidaciones del Mes')).not.toBeInTheDocument();
  });

  it('muestra el error al fallar la generación y permite cerrar el modal', async () => {
    mockList(() => page([item('l-1')]), () => Promise.reject(new ApiRequestError(400, 'BAD', 'Sin contratos de prueba')));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Generar Mes' }));
    await user.click(screen.getByRole('button', { name: 'Generar' }));
    expect(await screen.findByText('Sin contratos de prueba')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText('Generar Liquidaciones del Mes')).not.toBeInTheDocument();
  });

  it('error genérico al generar sin ApiRequestError', async () => {
    mockList(() => page([item('l-1')]), () => Promise.reject(new Error('x')));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Generar Mes' }));
    await user.click(screen.getByRole('button', { name: 'Generar' }));
    expect(await screen.findByText('Error al generar liquidaciones')).toBeInTheDocument();
  });

  it('selecciona tarjetas y aprueba en lote', async () => {
    mockList(() => page([item('l-1'), item('l-2')]));
    const user = await mount();
    await user.click(await screen.findByLabelText('Seleccionar todas'));
    expect(screen.getAllByText('2 seleccionadas').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Aprobar seleccionadas' }));
    expect(await screen.findByText('Liquidaciones aprobadas correctamente')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/liquidaciones/bulk-approve', {
      method: 'POST',
      body: JSON.stringify({ ids: ['l-1', 'l-2'] }),
    });
    expect(screen.queryByRole('button', { name: 'Aprobar seleccionadas' })).not.toBeInTheDocument();
  });

  it('envía en lote las liquidaciones seleccionadas', async () => {
    mockList(() => page([item('l-1'), item('l-2')]));
    const user = await mount();
    await screen.findByLabelText('Seleccionar todas');
    await user.click(screen.getByLabelText('Seleccionar todas'));
    expect(screen.getAllByText('2 seleccionadas').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Enviar seleccionadas' }));
    expect(await screen.findByText('Liquidaciones enviadas correctamente')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/liquidaciones/bulk-send', {
      method: 'POST',
      body: JSON.stringify({ ids: ['l-1', 'l-2'] }),
    });
  });

  it('deselecciona todas desde la barra de acciones', async () => {
    mockList(() => page([item('l-1'), item('l-2')]));
    const user = await mount();
    await user.click(await screen.findByLabelText('Seleccionar todas'));
    await user.click(screen.getByRole('button', { name: 'Deseleccionar todas' }));
    expect(screen.queryByRole('button', { name: 'Enviar seleccionadas' })).not.toBeInTheDocument();
  });

  it('muestra el error del lote, con mensaje de API o genérico', async () => {
    mockList(() => page([item('l-1')]), () => Promise.reject(new ApiRequestError(409, 'X', 'Ya aprobada de prueba')));
    const user = await mount();
    await user.click(await screen.findByLabelText('Seleccionar todas'));
    await user.click(screen.getByRole('button', { name: 'Aprobar seleccionadas' }));
    expect(await screen.findByText('Ya aprobada de prueba')).toBeInTheDocument();

    mockList(() => page([item('l-1')]), () => Promise.reject(new Error('x')));
    await user.click(screen.getByRole('button', { name: 'Enviar seleccionadas' }));
    expect(await screen.findByText('Error al enviar liquidaciones')).toBeInTheDocument();
    expect(within(document.body).getAllByText('1 seleccionadas').length).toBeGreaterThan(0);
  });
});
