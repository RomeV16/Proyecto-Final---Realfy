// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, downloadFile, toast, push } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  downloadFile: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  push: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => {
  const value = () => ({
    user: { id: 'u1', role: 'Admin', firstName: 'Ana', lastName: 'Prueba' },
  });
  return { useAuth: value, useOptionalAuth: value };
});
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/invoices',
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('@/lib/toast', () => ({ toast }));
vi.mock('@/lib/download', () => ({
  downloadFile: (...args: unknown[]) => downloadFile(...args),
}));

import { InvoiceList } from './invoice-list';

const norm = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

function page(items: unknown[], extra: Record<string, unknown> = {}) {
  return { items, total: items.length, page: 1, limit: 20, totalPages: 1, ...extra };
}

const items = [
  {
    id: 'f-1',
    type: 'FacturaA',
    puntoDeVenta: 3,
    numero: 128,
    receptorName: 'Cliente de Prueba SA',
    amount: '121000',
    cae: '70000000000001',
    createdAt: '2026-11-01T12:00:00.000Z',
  },
  {
    id: 'nc-1',
    type: 'NotaCreditoB',
    puntoDeVenta: 3,
    comprobanteNumber: 9,
    impTotal: 5000.5,
    createdAt: '2026-11-02T12:00:00.000Z',
  },
  {
    id: 'nd-1',
    type: 'NotaDebitoA',
    puntoDeVenta: 1,
    numero: 4,
    receptorName: 'Otro Cliente',
    amount: 100,
    cae: '70000000000002',
    createdAt: '2026-11-03T12:00:00.000Z',
  },
];

describe('InvoiceList', () => {
  beforeEach(() => {
    apiClient.mockReset();
    downloadFile.mockReset();
    toast.error.mockReset();
    push.mockReset();
    apiClient.mockResolvedValue(page(items));
  });

  it('lista comprobantes con importes, fechas y números formateados', async () => {
    const { container } = renderEs(<InvoiceList />);
    await waitFor(() => expect(container.textContent).toContain('Cliente de Prueba SA'));
    const text = norm(container.textContent);
    expect(text).toContain('$ 121.000,00');
    expect(text).toContain('- $ 5.000,50');
    expect(text).toContain('$ 100,00');
    expect(text).toContain('0003-00000128');
    expect(text).toContain('0003-00000009');
    expect(text).toContain('1 de nov de 2026');
    expect(text).toContain('70000000000001');
    expect(apiClient).toHaveBeenCalledWith('/invoices?page=1&limit=20');
  });

  it('los enlaces de ver llevan el prefijo de idioma', async () => {
    renderEs(<InvoiceList />);
    await screen.findAllByText('Cliente de Prueba SA');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/es/invoices/f-1');
    expect(hrefs).toContain('/es/invoices/nc-1');
  });

  it('el comprobante sin CAE muestra el aviso de pendiente', async () => {
    renderEs(<InvoiceList />);
    await screen.findAllByText('Cliente de Prueba SA');
    expect(screen.getAllByText(/pendiente/i).length).toBeGreaterThan(0);
  });

  it('descarga el PDF desde la tabla', async () => {
    downloadFile.mockResolvedValue(undefined);
    renderEs(<InvoiceList />);
    await screen.findAllByText('Cliente de Prueba SA');
    const buttons = screen.getAllByTitle('PDF');
    await userEvent.setup().click(buttons[0]);
    await waitFor(() =>
      expect(downloadFile).toHaveBeenCalledWith('/invoices/f-1/pdf', 'comprobante-f-1.pdf'),
    );
  });

  it('descarga el PDF desde la tarjeta y avisa si falla', async () => {
    downloadFile.mockRejectedValue(new Error('boom'));
    renderEs(<InvoiceList />);
    await screen.findAllByText('Cliente de Prueba SA');
    const cardButtons = screen.getAllByRole('button', { name: 'PDF' });
    await userEvent.setup().click(cardButtons[0]);
    await waitFor(() => expect(downloadFile).toHaveBeenCalled());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('el botón de nueva factura navega con el router', async () => {
    renderEs(<InvoiceList />);
    await screen.findAllByText('Cliente de Prueba SA');
    await userEvent.setup().click(screen.getByRole('button', { name: /Nueva|Emitir/i }));
    expect(push).toHaveBeenCalledWith('/es/invoices/new');
  });

  it('filtra por tipo, vuelve a pedir y permite limpiar', async () => {
    renderEs(<InvoiceList />);
    await screen.findAllByText('Cliente de Prueba SA');
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox'), 'NotaCreditoA');
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/invoices?type=NotaCreditoA&page=1&limit=20'),
    );
    await user.click(await screen.findByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith('/invoices?page=1&limit=20'));
  });

  it('sin resultados muestra el estado vacío, también al filtrar', async () => {
    apiClient.mockResolvedValue(page([]));
    renderEs(<InvoiceList />);
    await waitFor(() => expect(screen.queryByText('Cliente de Prueba SA')).not.toBeInTheDocument());
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'FacturaB');
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/invoices?type=FacturaB&page=1&limit=20'),
    );
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeInTheDocument();
  });

  it('un error de la API deja la lista vacía', async () => {
    apiClient.mockRejectedValue(new Error('caído'));
    renderEs(<InvoiceList />);
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    expect(screen.queryByText('Cliente de Prueba SA')).not.toBeInTheDocument();
  });

  it('pagina hacia adelante y atrás', async () => {
    apiClient.mockResolvedValue(page(items, { total: 45, totalPages: 3 }));
    const { container } = renderEs(<InvoiceList />);
    await screen.findAllByText('Cliente de Prueba SA');
    expect(container.textContent).toContain('Mostrando 1-20 de 45');
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/invoices?page=2&limit=20'));
    await waitFor(() => expect(container.textContent).toContain('Mostrando 21-40 de 45'));
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith('/invoices?page=1&limit=20'));
    expect(within(container).getByRole('button', { name: 'Siguiente' })).toBeEnabled();
  });
});
