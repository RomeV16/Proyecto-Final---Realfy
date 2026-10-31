// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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

  it('muestra la fecha con el formato de la web', async () => {
    mockApi([notif({ id: 'n1', title: 'Aviso fechado' })]);
    renderEs(<NotificationsPage />);
    await screen.findByText('Tenés 1 aviso sin leer');
    await screen.findAllByText('Aviso fechado');
    const text = (document.body.textContent ?? '').replaceAll(' ', ' ');
    expect(text).toContain('01 de nov de 2026, 03:30');
  });

  it('marca una como leída con PATCH y actualiza el contador', async () => {
    mockApi([notif({ id: 'n1', title: 'Solo una' })]);
    const user = userEvent.setup();
    renderEs(<NotificationsPage />);
    await screen.findByText('Tenés 1 aviso sin leer');
    await screen.findAllByText('Solo una');
    await user.click(screen.getByRole('button', { name: /Marcar leída/ }));
    expect(apiClient).toHaveBeenCalledWith('/notifications/n1/read', { method: 'PATCH' });
    expect(await screen.findByText('Vencimientos, deudas y cambios de estado')).toBeInTheDocument();
    expect(screen.queryByText('Nuevo')).not.toBeInTheDocument();
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

  it('sin avisos muestra el estado vacío y deshabilita el botón', async () => {
    mockApi([]);
    renderEs(<NotificationsPage />);
    expect(await screen.findByText('No tenés notificaciones')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar todas como leídas' })).toBeDisabled();
  });
});
