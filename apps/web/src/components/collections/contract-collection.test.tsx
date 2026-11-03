// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth } = vi.hoisted(() => ({ apiClient: vi.fn(), auth: { role: 'Admin' } }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));

import { ContractCollection } from './contract-collection';

const CASE = {
  id: 'c1',
  contractId: 'k1',
  propertyLabel: 'Calle Demo 742',
  tenantNames: 'Ana Prueba',
  stage: 'Prejudicial',
  currency: 'ARS',
  overdueSince: '2026-03-10T00:00:00.000Z',
  daysOverdue: 32,
  balance: '200000.00',
  payoffToday: '203000.00',
  nextAction: 'CartaDocumento',
  nextActionAt: null,
  planStatus: 'AwaitingLetterConfirmation',
  pausedUntil: null,
  assigneeId: null,
  assigneeName: null,
  openedAt: '2026-03-15T13:00:00.000Z',
  closedAt: null,
};

beforeEach(() => {
  apiClient.mockReset();
  auth.role = 'Admin';
});

describe('Cobranza en el detalle del contrato', () => {
  it('muestra el caso abierto con lo que se debe hoy y el enlace a su detalle', async () => {
    apiClient.mockResolvedValue({ items: [CASE], total: 1, page: 1, limit: 5, totalPages: 1 });
    renderEs(<ContractCollection contractId="k1" />);
    expect(await screen.findByText('Prejudicial')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/collection-cases?contractId=k1&limit=5');
    expect(screen.getByText('32 días')).toBeInTheDocument();
    expect(screen.getByText(/203\.000,00/)).toBeInTheDocument();
    expect(screen.getByText('Confirmar el envío de la carta')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver el caso' })).toHaveAttribute('href', '/es/cobranza/c1');
    expect(screen.getByRole('link', { name: 'Ver toda la cobranza' })).toHaveAttribute('href', '/es/cobranza');
  });

  it('sin casos abiertos no ocupa lugar', async () => {
    apiClient.mockResolvedValue({ items: [], total: 0, page: 1, limit: 5, totalPages: 1 });
    const { container } = renderEs(<ContractCollection contractId="k1" />);
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('un rol sin acceso no consulta nada', () => {
    auth.role = 'Ventas';
    const { container } = renderEs(<ContractCollection contractId="k1" />);
    expect(apiClient).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
