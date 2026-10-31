// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '@/components/index-data/test-utils';

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
  useOptionalAuth: () => ({
    user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' },
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/tickets',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import TicketListPage from './page';

class FakeObserver {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() {
    this.cb([{ isIntersecting: true }]);
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', FakeObserver);

const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

const data = [
  {
    id: 't-1',
    title: 'Pérdida de agua de prueba',
    status: 'Abierto',
    priority: 'Urgente',
    slaDeadline: '2026-01-10T12:00:00.000Z',
    assignedTo: { id: 'u2', firstName: 'Pedro', lastName: 'Simulado' },
    category: { id: 'c-1', name: 'Plomería' },
    property: { id: 'p-1', title: 'Depto de prueba' },
    createdAt: daysAgo(5),
  },
  {
    id: 't-2',
    title: 'Ruido ficticio',
    status: 'Abierto',
    priority: 'Media',
    createdAt: daysAgo(0),
  },
  {
    id: 't-3',
    title: 'Ticket cerrado de prueba',
    status: 'Cerrado',
    priority: 'Baja',
    slaDeadline: '2026-11-20T12:00:00.000Z',
    createdAt: daysAgo(1),
  },
];

function list(over: Record<string, unknown> = {}) {
  return { data, meta: { total: 3, page: 1, limit: 20, totalPages: 1 }, ...over };
}

describe('TicketListPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });

  it('muestra tarjetas con vencimiento de SLA, antigüedad y avisos', async () => {
    apiClient.mockResolvedValue(list());
    renderEs(<TicketListPage />);
    expect(await screen.findByText('Pérdida de agua de prueba')).toBeInTheDocument();
    expect(screen.getByText('SLA vencido')).toBeInTheDocument();
    expect(screen.getAllByText('Sin asignar').length).toBeGreaterThan(0);
    expect(screen.getByText('Plomería')).toBeInTheDocument();
    expect(screen.getByText('Hace 5 días')).toBeInTheDocument();
    expect(screen.getByText('Abierto hoy')).toBeInTheDocument();
    expect(screen.getByText(/10.ene/i)).toBeInTheDocument();
    expect(screen.getByText(/20.nov/i)).toBeInTheDocument();
    expect(screen.getByText('Pedro Simulado')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/tickets?page=1&limit=20');
  });

  it('los enlaces llevan el prefijo de idioma', async () => {
    apiClient.mockResolvedValue(list());
    renderEs(<TicketListPage />);
    await screen.findByText('Pérdida de agua de prueba');
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/es/tickets/t-1');
    expect(hrefs).toContain('/es/tickets/new');
    expect(hrefs.every((h) => !h || h.startsWith('/es/'))).toBe(true);
  });

  it('filtra por estado y prioridad, y limpia', async () => {
    apiClient.mockResolvedValue(list());
    renderEs(<TicketListPage />);
    await screen.findByText('Pérdida de agua de prueba');
    const user = userEvent.setup();
    const [status, priority] = screen.getAllByRole('combobox');
    await user.selectOptions(status, 'Abierto');
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('status=Abierto')));
    await user.selectOptions(priority, 'Urgente');
    await waitFor(() =>
      expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('priority=Urgente')),
    );
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith('/tickets?page=1&limit=20'));
  });

  it('el vacío sin filtros ofrece crear un ticket', async () => {
    apiClient.mockResolvedValue(list({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }));
    renderEs(<TicketListPage />);
    expect(await screen.findByText('No hay tickets')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Nuevo ticket/ }).length).toBe(2);
  });

  it('el vacío con filtros se puede limpiar', async () => {
    apiClient.mockResolvedValue(list({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }));
    renderEs(<TicketListPage />);
    await screen.findByText('No hay tickets');
    const user = userEvent.setup();
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'Cerrado');
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Limpiar filtros' })[0]);
    expect(await screen.findByText('No hay tickets')).toBeInTheDocument();
  });

  it('pagina hacia adelante y atrás', async () => {
    apiClient.mockResolvedValue(list({ meta: { total: 45, page: 1, limit: 20, totalPages: 3 } }));
    renderEs(<TicketListPage />);
    await screen.findByText('Pérdida de agua de prueba');
    const user = userEvent.setup();
    expect(screen.getByText('Mostrando 1-20 de 45')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('page=2')));
    expect(await screen.findByText('Mostrando 21-40 de 45')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    await waitFor(() => expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('page=1')));
  });

  it('un error de la API cae en el estado vacío', async () => {
    apiClient.mockRejectedValue(new Error('red'));
    renderEs(<TicketListPage />);
    expect(await screen.findByText('No hay tickets')).toBeInTheDocument();
  });

  it('una respuesta sin datos ni meta también queda vacía', async () => {
    apiClient.mockResolvedValue({});
    renderEs(<TicketListPage />);
    expect(await screen.findByText('No hay tickets')).toBeInTheDocument();
  });
});
