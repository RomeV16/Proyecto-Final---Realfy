// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '@/components/index-data/test-utils';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'Admin', firstName: 'Ana', lastName: 'Prueba' } }),
  useOptionalAuth: () => ({
    user: { id: 'u1', role: 'Admin', firstName: 'Ana', lastName: 'Prueba' },
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/notifications',
}));

import NotificationsPage from './page';

function notif(overrides: Record<string, unknown>) {
  return {
    id: 'n',
    type: 'general',
    title: 'Aviso',
    message: 'Mensaje',
    isRead: false,
    entityType: null,
    entityId: null,
    createdAt: '2026-11-01T15:30:00.000Z',
    ...overrides,
  };
}

const items = [
  notif({ id: 'n1', type: 'contrato_vence', title: 'Contrato por vencer', entityType: 'Contract', entityId: 'c1' }),
  notif({ id: 'n2', type: 'deuda', title: 'Deuda vencida', entityType: 'Liquidacion', entityId: 'l1' }),
  notif({ id: 'n3', type: 'pago', title: 'Pago recibido', entityType: 'Property', entityId: 'p1', isRead: true }),
  notif({ id: 'n4', type: 'ticket', title: 'Reclamo nuevo', entityType: 'Ticket', entityId: 't1' }),
  notif({ id: 'n5', type: 'otro', title: 'Persona cargada', entityType: 'Person', entityId: 'pe1' }),
  notif({ id: 'n6', type: 'otro', title: 'Sin destino', entityType: 'Otra', entityId: 'x1', isRead: true }),
];

function mockApi(list: unknown[] = items) {
  apiClient.mockImplementation((path: string) => {
    if (path === '/notifications?limit=50') {
      return Promise.resolve({ items: list, total: list.length, page: 1, limit: 50, totalPages: 1 });
    }
    return Promise.resolve({});
  });
}

describe('NotificationsPage', () => {
  beforeEach(() => apiClient.mockReset());

  it('cuenta los avisos sin leer y arma los enlaces con prefijo de idioma', async () => {
    mockApi();
    renderEs(<NotificationsPage />);
    expect(await screen.findByText('Tenés 4 avisos sin leer')).toBeInTheDocument();
    await screen.findAllByText('Contrato por vencer');
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/es/contracts/c1');
    expect(hrefs).toContain('/es/liquidaciones');
    expect(hrefs).toContain('/es/properties/p1');
    expect(hrefs).toContain('/es/tickets/t1');
    expect(hrefs).toContain('/es/persons/pe1');
    for (const h of hrefs) expect(h).toMatch(/^\/es\//);
  });

  it('agrupa por día: hoy, ayer y después la fecha completa', async () => {
    const now = Date.now();
    mockApi([
      notif({ id: 'n1', title: 'De hoy', createdAt: new Date(now).toISOString() }),
      notif({ id: 'n2', title: 'De ayer', createdAt: new Date(now - 86400000).toISOString() }),
      notif({ id: 'n3', title: 'Vieja uno', createdAt: '2026-11-01T15:30:00.000Z' }),
      notif({ id: 'n4', title: 'Vieja dos', createdAt: '2026-11-01T12:00:00.000Z' }),
    ]);
    renderEs(<NotificationsPage />);
    await screen.findByText('De hoy');
    expect(within(screen.getByRole('region', { name: 'Hoy' })).getByText('De hoy')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Ayer' })).getByText('De ayer')).toBeInTheDocument();
    const old = screen.getByRole('region', { name: /domingo, 1 de noviembre/ });
    expect(within(old).getByText('Vieja uno')).toBeInTheDocument();
    expect(within(old).getByText('Vieja dos')).toBeInTheDocument();
    expect(within(old).getByText(/03:30/)).toBeInTheDocument();
  });

  it('marca una como leída con PATCH y actualiza el contador', async () => {
    mockApi([notif({ id: 'n1', title: 'Solo una' })]);
    const user = userEvent.setup();
    renderEs(<NotificationsPage />);
    await screen.findByText('Tenés 1 aviso sin leer');
    await screen.findAllByText('Solo una');
    await user.click(screen.getByRole('button', { name: /Marcar leída/ }));
    expect(apiClient).toHaveBeenCalledWith('/notifications/n1/read', { method: 'PATCH' });
    expect(await screen.findByText('Estás al día: no hay avisos sin leer.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Marcar leída/ })).not.toBeInTheDocument();
  });

  it('marca todas como leídas', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<NotificationsPage />);
    await screen.findByText('Tenés 4 avisos sin leer');
    await screen.findAllByText('Contrato por vencer');
    await user.click(screen.getByRole('button', { name: 'Marcar todas como leídas' }));
    expect(apiClient).toHaveBeenCalledWith('/notifications/mark-all-read', { method: 'PATCH' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Marcar todas como leídas' })).toBeDisabled(),
    );
  });

  it('el filtro Sin leer deja solo las pendientes y avisa cuando no queda ninguna', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEs(<NotificationsPage />);
    await screen.findByText('Pago recibido');
    await user.click(screen.getByRole('button', { name: /Sin leer/ }));
    expect(screen.queryByText('Pago recibido')).not.toBeInTheDocument();
    expect(screen.getByText('Deuda vencida')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Marcar todas como leídas' }));
    expect(await screen.findByText('No quedan avisos sin leer.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Todas' }));
    expect(screen.getByText('Pago recibido')).toBeInTheDocument();
  });

  it('si marcar como leída falla vuelve a leer la lista', async () => {
    let reads = 0;
    apiClient.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method) return Promise.reject(new Error('red'));
      reads += 1;
      return Promise.resolve({ items: [notif({ id: 'n1', title: 'Solo una' })] });
    });
    const user = userEvent.setup();
    renderEs(<NotificationsPage />);
    await screen.findByText('Solo una');
    await user.click(screen.getByRole('button', { name: /Marcar leída/ }));
    await waitFor(() => expect(reads).toBe(2));
    await user.click(screen.getByRole('button', { name: 'Marcar todas como leídas' }));
    await waitFor(() => expect(reads).toBe(3));
  });

  it('si la carga falla lo dice y deja reintentar', async () => {
    apiClient.mockRejectedValueOnce(new Error('red'));
    renderEs(<NotificationsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar las notificaciones.');
    mockApi([notif({ id: 'n1', title: 'Ya cargó' })]);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(await screen.findByText('Ya cargó')).toBeInTheDocument();
  });

  it('sin avisos muestra el estado vacío y deshabilita el botón', async () => {
    mockApi([]);
    renderEs(<NotificationsPage />);
    expect(await screen.findByText('No tenés notificaciones')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar todas como leídas' })).toBeDisabled();
  });
});
