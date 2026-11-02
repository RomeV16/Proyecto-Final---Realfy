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

  it.each(['Admin', 'Gerente', 'Liquidaciones', 'Lectura'])('%s ve la rendición como histórico, sin acciones de escritura', async (role) => {
    auth.role = role;
    mockApi(() => rendition({ notes: 'Nota sintética' }));
    await mount();
    expect(screen.getByRole('note')).toHaveTextContent('Las rendiciones por contrato quedaron como histórico');
    expect(screen.getByRole('link', { name: 'Ir a estados de cuenta' })).toHaveAttribute('href', '/es/estados-de-cuenta');
    expect(screen.getByRole('link', { name: 'Ir a locadores' })).toHaveAttribute('href', '/es/locadores');
    for (const name of ['Aprobar', /Enviar por Email/, 'Agregar concepto', 'Editar', 'Eliminar', 'Marcar Depositada']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /Descargar PDF/ })).toBeInTheDocument();
    expect(screen.getByText('Nota sintética')).toBeInTheDocument();
  });

  it('descarga el PDF con la ruta esperada y no escribe nada', async () => {
    mockApi(() => rendition());
    const user = await mount();
    await user.click(screen.getByRole('button', { name: /Descargar PDF/ }));
    expect(downloadFile).toHaveBeenCalledWith('/renditions/r-1/pdf', 'rendicion-r-1.pdf');
    expect(apiClient.mock.calls.filter(([, init]) => init?.method)).toHaveLength(0);
  });

  it('avisa si falla la descarga del PDF', async () => {
    mockApi(() => rendition());
    downloadFile.mockRejectedValue(new Error('x'));
    const user = await mount();
    await user.click(screen.getByRole('button', { name: /Descargar PDF/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('No se pudo descargar')));
  });

  it('en Depositada muestra la fecha de depósito', async () => {
    mockApi(() => rendition({ status: 'Depositada', depositedAt: '2026-11-10T12:00:00.000Z' }));
    await mount();
    expect(nb(document.body.textContent)).toContain('Depositada el: 10 de noviembre de 2026');
  });
});
