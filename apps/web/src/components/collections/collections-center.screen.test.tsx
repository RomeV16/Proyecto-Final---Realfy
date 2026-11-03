// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEsWithQuery } from '../index-data/test-utils';

const { apiClient, auth } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Liquidaciones' },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/cobranza',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { ApiRequestError } from '@/lib/api-client';
import CollectionsPage from '@/app/[locale]/(app)/cobranza/page';
import LoadingCollections from '@/app/[locale]/(app)/cobranza/loading';
import ErrorCollections from '@/app/[locale]/(app)/cobranza/error';
import NotFoundCollections from '@/app/[locale]/(app)/cobranza/not-found';
import { SegmentError, SegmentLoading, SegmentNotFound } from '@/components/ui/segment-states';

function item(id: string, o: Record<string, unknown> = {}) {
  return {
    id,
    contractId: `k-${id}`,
    propertyLabel: 'Calle Demo 742',
    tenantNames: 'Ana Prueba',
    stage: 'Recordatorio',
    currency: 'ARS',
    overdueSince: '2026-03-10T00:00:00.000Z',
    daysOverdue: 12,
    balance: '100000.00',
    payoffToday: '102000.00',
    nextAction: 'RecordatorioFirme',
    nextActionAt: '2026-03-20T00:00:00.000Z',
    planStatus: 'Scheduled',
    pausedUntil: null,
    assigneeId: null,
    assigneeName: null,
    openedAt: '2026-03-15T13:00:00.000Z',
    closedAt: null,
    ...o,
  };
}

const ITEMS = [
  item('c1'),
  item('c2', { propertyLabel: '', tenantNames: '', stage: 'Prejudicial', daysOverdue: 40, nextAction: 'CartaDocumento', planStatus: 'AwaitingLetterConfirmation', assigneeName: 'Lía Demo' }),
  item('c3', { stage: 'Recordatorio', planStatus: 'Paused', pausedUntil: '2026-03-30T00:00:00.000Z', nextAction: null, nextActionAt: null }),
  item('c4', { stage: 'Abogado', planStatus: 'Manual', nextAction: null, nextActionAt: null, currency: 'USD', payoffToday: '500.00', balance: '500.00' }),
  item('c5', { planStatus: 'Scheduled', nextAction: null, nextActionAt: null }),
];

function mockApi({ items = ITEMS, fail, totalPages = 1 }: { items?: unknown[]; fail?: boolean; totalPages?: number } = {}) {
  apiClient.mockImplementation(async (path: string) => {
    if (path.startsWith('/collection-cases?')) {
      if (fail) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
      return { items, total: items.length, page: 1, limit: 50, totalPages };
    }
    throw new Error(`unexpected ${path}`);
  });
}

const lastQuery = () => apiClient.mock.calls.filter(([p]) => String(p).startsWith('/collection-cases?')).at(-1)?.[0] as string;

beforeEach(() => {
  apiClient.mockReset();
  auth.role = 'Liquidaciones';
});

describe('Cobranza: listado de casos', () => {
  it('lista los casos con etapa, mora, saldo, lo que se debe hoy y lo que toca', async () => {
    mockApi();
    renderEsWithQuery(<CollectionsPage />);
    expect(await screen.findByRole('heading', { name: 'Cobranza' })).toBeInTheDocument();
    await screen.findAllByText('Calle Demo 742');
    expect(lastQuery()).toBe('/collection-cases?page=1&limit=50');
    expect(screen.getAllByText('Recordatorio').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Prejudicial').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Con el abogado').length).toBeGreaterThan(0);
    expect(screen.getAllByText('12 días').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/102\.000,00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Recordatorio firme/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Confirmar el envío de la carta').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Acuerdo de pago hasta el/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lo lleva una persona').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nada por ahora').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Contrato sin propiedad').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sin inquilino cargado').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lía Demo').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Calle Demo 742' })[0]).toHaveAttribute('href', '/es/cobranza/c1');
  });

  it('resume la cantidad de casos y lo que se debe hoy por moneda', async () => {
    mockApi();
    renderEsWithQuery(<CollectionsPage />);
    await screen.findAllByText('Calle Demo 742');
    expect(screen.getByText(/5 casos · se debe hoy/)).toBeInTheDocument();
    expect(screen.getAllByText(/US\$\s?500,00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/408\.000,00/)).toBeInTheDocument();
  });

  it('filtra por etapa, mora mínima y responsable', async () => {
    mockApi();
    const user = userEvent.setup();
    renderEsWithQuery(<CollectionsPage />);
    await screen.findAllByText('Calle Demo 742');
    await user.selectOptions(screen.getByLabelText('Etapa'), 'Prejudicial');
    await waitFor(() => expect(lastQuery()).toBe('/collection-cases?page=1&limit=50&stage=Prejudicial'));
    await user.selectOptions(screen.getByLabelText('Mora'), '30');
    await waitFor(() => expect(lastQuery()).toBe('/collection-cases?page=1&limit=50&stage=Prejudicial&minDays=30'));
    await user.selectOptions(screen.getByLabelText('Responsable'), 'u1');
    await waitFor(() => expect(lastQuery()).toBe('/collection-cases?page=1&limit=50&stage=Prejudicial&minDays=30&assigneeId=u1'));
  });

  it('sin casos muestra el vacío y no el resumen', async () => {
    mockApi({ items: [] });
    renderEsWithQuery(<CollectionsPage />);
    expect(await screen.findByText('No hay casos de cobranza')).toBeInTheDocument();
    expect(screen.queryByText(/casos? · se debe hoy/)).not.toBeInTheDocument();
  });

  it('pagina cuando hay más de una página', async () => {
    mockApi({ totalPages: 3 });
    const user = userEvent.setup();
    renderEsWithQuery(<CollectionsPage />);
    await screen.findAllByText('Calle Demo 742');
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(lastQuery()).toBe('/collection-cases?page=2&limit=50'));
  });

  it('un error de la API se muestra en lugar de la lista', async () => {
    mockApi({ fail: true });
    renderEsWithQuery(<CollectionsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('INTERNAL_ERROR');
  });

  it.each(['Ventas', 'Soporte', 'Marketing'])('%s no tiene acceso a la cobranza', (role) => {
    auth.role = role;
    mockApi();
    renderEsWithQuery(<CollectionsPage />);
    expect(screen.getByText('Tu rol no tiene acceso a la cobranza.')).toBeInTheDocument();
  });

  it('Lectura puede ver la lista', async () => {
    auth.role = 'Lectura';
    mockApi();
    renderEsWithQuery(<CollectionsPage />);
    expect(await screen.findAllByText('Calle Demo 742')).not.toHaveLength(0);
  });

  it('el segmento usa los estados compartidos', () => {
    expect(LoadingCollections).toBe(SegmentLoading);
    expect(ErrorCollections).toBe(SegmentError);
    expect(NotFoundCollections).toBe(SegmentNotFound);
  });
});
