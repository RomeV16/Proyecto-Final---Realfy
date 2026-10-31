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
  usePathname: () => '/es/renditions',
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
import { RenditionList } from './rendition-list';

const nb = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

function item(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'Enviada',
    month: 11,
    year: 2026,
    rentCollected: '100000',
    netDeposit: '91500',
    pdfUrl: 'https://example.test/r.pdf',
    owner: { firstName: 'Carla', lastName: 'Ejemplo' },
    contract: { id: 'c-1', property: { id: 'p-1', title: 'Depto de prueba' } },
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

async function mount() {
  render(
    <NextIntlClientProvider locale="es" messages={es}>
      <RenditionList />
    </NextIntlClientProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Rendiciones' });
  return userEvent.setup();
}

describe('RenditionList', () => {
  beforeEach(() => {
    apiClient.mockReset();
    downloadFile.mockReset();
    downloadFile.mockResolvedValue(undefined);
    toastError.mockReset();
    auth.role = 'Admin';
  });

  it('muestra tarjetas con importes, propietario y enlaces con locale', async () => {
    mockList(() =>
      page([
        item('r-1'),
        item('r-2', { status: 'Borrador', owner: null, ownerName: 'Nora Muestra', netDeposit: '0', rentCollected: '0' }),
        item('r-3', { status: 'Aprobada', pdfUrl: null, owner: null, contract: undefined }),
        item('r-4', { status: 'Depositada' }),
      ]),
    );
    await mount();
    await screen.findByText('Carla Ejemplo', {}, { timeout: 3000 }).catch(() => undefined);
    const text = nb(document.body.textContent);
    expect(text).toContain('$ 91.500,00');
    expect(text).toContain('$ 100.000,00');
    expect(text).toContain('Noviembre 2026');
    expect(text).toContain('Carla Ejemplo');
    expect(text).toContain('Nora Muestra');
    expect(text).toContain('Sin propietario asignado');
    expect(text).toContain('Sin propiedad asociada');
    expect(text).toContain('PDF no generado aún');
    expect(text).toContain('Aún no enviada al propietario');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/es/renditions/r-1');
    for (const h of hrefs) expect(h).toMatch(/^\/es\//);
  });

  it('descarga el PDF con la ruta esperada y avisa si falla', async () => {
    mockList(() => page([item('r-1')]));
    const user = await mount();
    await user.click(await screen.findByRole('button', { name: 'Descargar PDF' }));
    expect(downloadFile).toHaveBeenCalledWith('/renditions/r-1/pdf', 'rendicion-r-1.pdf');

    downloadFile.mockRejectedValueOnce(new Error('x'));
    await user.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('No se pudo descargar')));
  });

  it.each(['Admin', 'Gerente', 'Liquidaciones'])('%s ve el botón de generar', async (role) => {
    auth.role = role;
    mockList(() => page([item('r-1')]));
    await mount();
    expect(screen.getByRole('button', { name: 'Generar Rendición' })).toBeInTheDocument();
  });

  it.each(['Ventas', 'Lectura', 'Soporte'])('%s no ve el botón de generar', async (role) => {
    auth.role = role;
    mockList(() => page([item('r-1')]));
    await mount();
    expect(screen.queryByRole('button', { name: 'Generar Rendición' })).not.toBeInTheDocument();
  });

  it('vacío sin filtros ofrece generar solo a quien puede', async () => {
    mockList(() => page([]));
    await mount();
    expect(await screen.findByText('No hay rendiciones')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Generar Rendición/ })).toHaveLength(2);
  });

  it('vacío para un rol sin permiso no ofrece generar', async () => {
    auth.role = 'Lectura';
    mockList(() => page([]));
    await mount();
    expect(await screen.findByText('No hay rendiciones')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generar Rendición/ })).not.toBeInTheDocument();
  });

  it('si la API falla muestra el vacío', async () => {
    apiClient.mockRejectedValue(new Error('boom'));
    await mount();
    expect(await screen.findByText('No hay rendiciones')).toBeInTheDocument();
  });

  it('filtra por estado, mes y año y permite limpiar', async () => {
    mockList(() => page([item('r-1')]));
    const user = await mount();
    await screen.findByText('Noviembre 2026');
    const [status, month, year] = screen.getAllByRole('combobox');
    await user.selectOptions(status!, 'Aprobada');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(expect.stringContaining('status=Aprobada')));
    await user.selectOptions(month!, '11');
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(expect.stringContaining('month=11')));
    const y = String(new Date().getFullYear());
    await user.selectOptions(year!, y);
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(expect.stringContaining(`year=${y}`)));
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument());
  });

  it('con filtros y sin resultados muestra el vacío filtrado y permite limpiar', async () => {
    mockList((path) => (path.includes('status=Depositada') ? page([]) : page([item('r-1')])));
    const user = await mount();
    await screen.findByText('Noviembre 2026');
    await user.selectOptions(screen.getAllByRole('combobox')[0]!, 'Depositada');
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
    expect(screen.getByText('No se encontraron rendiciones con los filtros aplicados')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Limpiar filtros' }).at(-1)!);
    expect(await screen.findByText('Noviembre 2026')).toBeInTheDocument();
  });

  it('pagina hacia adelante y atrás', async () => {
    mockList((path) => page([item('r-1')], { total: 30, totalPages: 3, page: path.includes('page=2') ? 2 : 1 }));
    const user = await mount();
    expect(await screen.findByText('Mostrando 1-12 de 30')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('Mostrando 13-24 de 30')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByText('Mostrando 1-12 de 30')).toBeInTheDocument();
  });

  it('genera una rendición desde el modal y recarga', async () => {
    mockList(() => page([item('r-1')]));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Generar Rendición' }));
    const submit = screen.getByRole('button', { name: 'Generar' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByPlaceholderText('Seleccionar contrato'), 'c-9');
    const combos = screen.getAllByRole('combobox');
    await user.selectOptions(combos.at(-2)!, '3');
    await user.click(submit);
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/renditions/generate', {
        method: 'POST',
        body: JSON.stringify({ contractId: 'c-9', month: 3, year: new Date().getFullYear() }),
      }),
    );
    await waitFor(() => expect(screen.queryByPlaceholderText('Seleccionar contrato')).not.toBeInTheDocument());
  });

  it('muestra el mensaje de la API o el genérico si falla la generación y permite cancelar', async () => {
    mockList(() => page([item('r-1')]), () => Promise.reject(new ApiRequestError(400, 'BAD', 'Contrato inválido de prueba')));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Generar Rendición' }));
    await user.type(screen.getByPlaceholderText('Seleccionar contrato'), 'c-9');
    await user.click(screen.getByRole('button', { name: 'Generar' }));
    expect(await screen.findByText('Contrato inválido de prueba')).toBeInTheDocument();

    mockList(() => page([item('r-1')]), () => Promise.reject(new Error('x')));
    await user.click(screen.getByRole('button', { name: 'Generar' }));
    expect(await screen.findByText('Error al generar rendición')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByPlaceholderText('Seleccionar contrato')).not.toBeInTheDocument();
  });
});
