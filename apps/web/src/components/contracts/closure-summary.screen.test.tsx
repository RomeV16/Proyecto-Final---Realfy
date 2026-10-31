// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, loadFailure } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  loadFailure: { error: null as Error | null },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) =>
    loadFailure.error ? Promise.reject(loadFailure.error) : apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'Admin', firstName: 'Ana', lastName: 'Prueba' } }),
  useOptionalAuth: () => ({
    user: { id: 'u1', role: 'Admin', firstName: 'Ana', lastName: 'Prueba' },
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/contracts/c-1',
}));

import { ApiRequestError } from '@/lib/api-client';
import { ClosureSummary } from './closure-summary';

const norm = (s: string | null) => (s ?? '').replaceAll(' ', ' ');

function metrics(overrides: Record<string, unknown> = {}) {
  return {
    contractType: 'Alquiler',
    closureStatus: 'Vencido',
    startDate: '2024-01-01T00:00:00.000Z',
    endDate: '2026-01-01T00:00:00.000Z',
    closedOn: '2026-01-01T00:00:00.000Z',
    durationDays: 730,
    durationMonths: 24,
    endedEarly: false,
    currency: 'ARS',
    billedCount: 24,
    paidCount: 24,
    onTimeCount: 20,
    lateCount: 4,
    unpaidCount: 0,
    onTimeRate: 83.3,
    averageDelayDays: 1,
    maxDelayDays: 9,
    billedAmount: 2400000,
    collectedAmount: 2400000,
    outstandingAmount: 0,
    penaltyCount: 3,
    penaltyAmount: 15000,
    penaltyWaivedCount: 1,
    ticketCount: 4,
    ticketsResolved: 3,
    ticketsCancelled: 0,
    ticketsOpen: 1,
    averageResolutionDays: 5,
    ticketCostAmount: 40000,
    adjustmentCount: 2,
    firstRent: 100000,
    lastRent: 130000,
    rentIncreasePct: 30,
    rendicionCount: 24,
    rendicionNetAmount: 2000000,
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    contractId: 'c-1',
    status: 'Vencido',
    closed: true,
    summary: {
      summary: 'Primer párrafo del resumen.\n\nSegundo párrafo del resumen.',
      highlights: ['Pagos puntuales', 'Un ajuste anual'],
      metrics: metrics(),
      source: 'rules',
      model: null,
      generatedAt: '2026-01-02T15:00:00.000Z',
    },
    ...overrides,
  };
}

describe('ClosureSummary', () => {
  beforeEach(() => {
    apiClient.mockReset();
    loadFailure.error = null;
  });

  it('muestra redacción, destacados y métricas con importes y porcentajes formateados', async () => {
    apiClient.mockResolvedValue(response());
    renderEs(<ClosureSummary contractId="c-1" />);
    expect(await screen.findByText('Primer párrafo del resumen.')).toBeInTheDocument();
    expect(screen.getByText('Segundo párrafo del resumen.')).toBeInTheDocument();
    expect(screen.getByText('Pagos puntuales')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/ai/contracts/c-1/closure-summary');

    const text = norm(document.body.textContent);
    expect(text).toContain('$ 2.400.000');
    expect(text).toContain('24 meses');
    expect(text).toContain('20 de 24');
    expect(text).toContain('83,3 %');
    expect(text).toContain('+30 %');
    expect(text).toContain('3 · $ 15.000');
    expect(text).toContain('3 de 4 resueltos');
    expect(text).toContain('5 días');
    expect(text).toContain('1 día');
    expect(text).toContain('Redactado con las plantillas del sistema');
    expect(screen.getByRole('button', { name: 'Regenerar' })).toBeInTheDocument();
  });

  it('atribuye el texto al modelo y omite la resolución promedio sin datos', async () => {
    const r = response();
    (r.summary as Record<string, unknown>).source = 'model';
    (r.summary as Record<string, unknown>).model = 'modelo-de-prueba';
    (r.summary as Record<string, unknown>).metrics = metrics({
      averageResolutionDays: null,
      rentIncreasePct: -5,
    });
    apiClient.mockResolvedValue(r);
    renderEs(<ClosureSummary contractId="c-1" />);
    await screen.findByText('Primer párrafo del resumen.');
    const text = norm(document.body.textContent);
    expect(text).toContain('Redactado por modelo-de-prueba');
    expect(text).not.toContain('Resolución promedio');
    expect(text).toContain('-5 %');
  });

  it('sin destacados no muestra la sección', async () => {
    const r = response();
    (r.summary as Record<string, unknown>).highlights = [];
    apiClient.mockResolvedValue(r);
    renderEs(<ClosureSummary contractId="c-1" />);
    await screen.findByText('Primer párrafo del resumen.');
    expect(screen.queryByText('Puntos destacados')).not.toBeInTheDocument();
  });

  it('un contrato vigente no ofrece generar', async () => {
    apiClient.mockResolvedValue(response({ closed: false, summary: null, status: 'Activo' }));
    renderEs(<ClosureSummary contractId="c-1" />);
    expect(await screen.findByText('El contrato todavía está vigente')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generar resumen' })).not.toBeInTheDocument();
  });

  it('cerrado sin resumen: genera con POST y muestra el resultado', async () => {
    apiClient.mockImplementation((_p: string, init?: { method?: string }) =>
      Promise.resolve(init?.method === 'POST' ? response() : response({ summary: null })),
    );
    const user = userEvent.setup();
    renderEs(<ClosureSummary contractId="c-1" />);
    expect(await screen.findByText('Todavía no hay un resumen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generar resumen' }));
    expect(await screen.findByText('Primer párrafo del resumen.')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/ai/contracts/c-1/closure-summary', { method: 'POST' });
  });

  it('muestra el mensaje del servidor si falla la generación', async () => {
    apiClient.mockImplementation((_p: string, init?: { method?: string }) =>
      init?.method === 'POST'
        ? Promise.reject(new ApiRequestError(409, 'CONFLICT', 'Ya hay una generación en curso'))
        : Promise.resolve(response()),
    );
    const user = userEvent.setup();
    renderEs(<ClosureSummary contractId="c-1" />);
    await user.click(await screen.findByRole('button', { name: 'Regenerar' }));
    expect(await screen.findByText('Ya hay una generación en curso')).toBeInTheDocument();
  });

  it('usa el mensaje genérico si la generación falla sin detalle', async () => {
    apiClient.mockImplementation((_p: string, init?: { method?: string }) =>
      init?.method === 'POST' ? Promise.reject(new Error('x')) : Promise.resolve(response()),
    );
    const user = userEvent.setup();
    renderEs(<ClosureSummary contractId="c-1" />);
    await user.click(await screen.findByRole('button', { name: 'Regenerar' }));
    expect(await screen.findByText('No se pudo generar el resumen de gestión')).toBeInTheDocument();
  });

  it('muestra el error de carga con el detalle de la API', async () => {
    loadFailure.error = new ApiRequestError(403, 'FORBIDDEN', 'Sin permiso');
    renderEs(<ClosureSummary contractId="c-1" />);
    expect(await screen.findByText('No se pudo cargar el resumen de gestión')).toBeInTheDocument();
    expect(screen.getByText('Sin permiso')).toBeInTheDocument();
  });

  it('usa el texto genérico si la carga falla sin ApiRequestError', async () => {
    loadFailure.error = new Error('red');
    renderEs(<ClosureSummary contractId="c-1" />);
    await waitFor(() =>
      expect(screen.getAllByText('No se pudo cargar el resumen de gestión').length).toBeGreaterThan(0),
    );
  });
});
