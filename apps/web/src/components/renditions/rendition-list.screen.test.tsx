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

import { RenditionList } from './rendition-list';

const nb = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

function item(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'Enviada',
    period: '2026-11-01T00:00:00.000Z',
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

function mockList(getPage: (path: string) => unknown) {
  apiClient.mockImplementation((path: string) => Promise.resolve(getPage(path)));
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

  it('muestra un talón por rendición con la cuenta del neto, el locador y enlaces con locale', async () => {
    mockList(() =>
      page([
        item('r-1'),
        item('r-2', { status: 'Borrador', owner: null, ownerName: 'Nora Muestra', netDeposit: '0', rentCollected: '0' }),
        item('r-3', { status: 'Aprobada', pdfUrl: null, owner: null, contract: undefined }),
        item('r-4', { status: 'Depositada', depositedAt: '2026-11-12T12:00:00.000Z', commissionAmount: '6000', adminFeeAmount: '1000', deductionTotal: '1500' }),
        item('r-5', { month: undefined, year: undefined, period: '2026-09-01T00:00:00.000Z', sentAt: '2026-10-02T12:00:00.000Z' }),
        item('r-6', { month: undefined, year: undefined, period: null }),
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
    expect(text).toContain('Sin locador asignado');
    expect(text).toContain('Septiembre 2026');
    expect(text).not.toContain('undefined');
    expect(text).toContain('Honorarios− $ 7.000,00');
    expect(text).toContain('Gastos− $ 1.500,00');
    expect(text).toContain('Neto transferido$ 91.500,00');
    expect(text).toMatch(/Transferida el 12 de nov/);
    expect(text).toMatch(/Enviada el 2 de oct/);
    expect(text).toContain('N.º R-1');
    expect(screen.getAllByRole('img', { name: /Neto \$\s91.500,00 sobre \$\s100.000,00 cobrados/ }).length).toBeGreaterThan(0);
    expect(text).toContain('Sin propiedad asociada');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/es/renditions/r-1');
    for (const h of hrefs) expect(h).toMatch(/^\/es\//);
  });

  it('descarga el PDF con la ruta esperada y avisa si falla', async () => {
    mockList(() => page([item('r-1')]));
    const user = await mount();
    await user.click(await screen.findByRole('button', { name: /Descargar PDF/ }));
    expect(downloadFile).toHaveBeenCalledWith('/renditions/r-1/pdf', 'rendicion-r-1.pdf');

    downloadFile.mockRejectedValueOnce(new Error('x'));
    await user.click(screen.getByRole('button', { name: /Descargar PDF/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('No se pudo descargar')));
  });

  it.each(['Admin', 'Gerente', 'Liquidaciones', 'Lectura'])('%s ve el aviso de histórico y ningún botón de generar', async (role) => {
    auth.role = role;
    mockList(() => page([item('r-1')]));
    await mount();
    expect(screen.getByRole('note')).toHaveTextContent('La cuenta corriente y el estado de cuenta mensual del locador las reemplazan');
    expect(screen.getByRole('link', { name: 'Ir a estados de cuenta' })).toHaveAttribute('href', '/es/estados-de-cuenta');
    expect(screen.queryByRole('button', { name: /Generar Rendición/ })).not.toBeInTheDocument();
  });

  it('vacío sin filtros explica dónde está ahora lo que se le liquida al locador, sin ofrecer generar', async () => {
    mockList(() => page([]));
    await mount();
    expect(await screen.findByText('No hay rendiciones')).toBeInTheDocument();
    expect(screen.getByText(/No hay rendiciones históricas/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generar Rendición/ })).not.toBeInTheDocument();
  });

  it('si la API falla lo avisa y permite reintentar', async () => {
    apiClient.mockRejectedValue(new Error('boom'));
    const user = await mount();
    expect(await screen.findByText('No pudimos cargar las rendiciones')).toBeInTheDocument();
    expect(screen.queryByText('No hay rendiciones')).not.toBeInTheDocument();
    mockList(() => page([item('r-1')]));
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Noviembre 2026')).toBeInTheDocument();
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
});
