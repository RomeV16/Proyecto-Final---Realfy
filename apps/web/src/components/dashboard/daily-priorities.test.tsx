// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '@/components/index-data/test-utils';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/dashboard',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import { DailyPriorities } from './daily-priorities';

const norm = (s: string | null) => (s ?? '').replaceAll('\u00a0', ' ');

function priority(overrides: Record<string, unknown>) {
  return {
    ref: 'X1',
    kind: 'reclamo',
    entityId: 'e1',
    title: 'Título',
    subtitle: null,
    urgency: 'alta',
    reason: 'Motivo',
    action: 'Acción sugerida',
    amount: null,
    currency: null,
    daysOverdue: null,
    daysToDue: null,
    slaHoursOverdue: null,
    daysSinceContact: null,
    ...overrides,
  };
}

function response(priorities: unknown[], extra: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-11-27T03:00:00.000Z',
    source: 'rules',
    model: null,
    modelPending: false,
    totals: {
      overdueAmount: 0,
      pendingAmount: 0,
      overdueCollections: 0,
      openTickets: 0,
      expiringContracts: 0,
      staleLeads: 0,
    },
    priorities,
    ...extra,
  };
}

describe('DailyPriorities', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it('muestra el atraso de un reclamo en meses y no en horas ni con siglas', async () => {
    apiClient.mockResolvedValue(
      response([
        priority({
          ref: 'R1',
          title: 'Tablero sin energía',
          reason: 'SLA excedido en 2520 h',
          action: 'Retomar el reclamo y actualizar su estado',
          slaHoursOverdue: 2520,
        }),
      ]),
    );
    renderEs(<DailyPriorities />);
    expect(await screen.findByText('Tablero sin energía')).toBeInTheDocument();
    expect(screen.getAllByText('3 meses').length).toBeGreaterThan(0);
    expect(screen.getAllByText('fuera de plazo').length).toBeGreaterThan(0);
    expect(screen.getByText('Retomar el reclamo y actualizar su estado')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('2520');
    expect(document.body.textContent).not.toContain('SLA');
  });

  it('con el orden por reglas no agrega ninguna aclaración al pie', async () => {
    apiClient.mockResolvedValue(response([priority({ slaHoursOverdue: 5 })]));
    renderEs(<DailyPriorities />);
    expect((await screen.findAllByText('5 horas')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Orden/)).not.toBeInTheDocument();
  });

  it('una cobranza vencida muestra el importe y hace cuánto venció', async () => {
    apiClient.mockResolvedValue(
      response([
        priority({
          ref: 'C1',
          kind: 'cobranza',
          title: 'Depto Uno',
          amount: 726513,
          currency: 'ARS',
          daysOverdue: 48,
        }),
        priority({ ref: 'C2', kind: 'cobranza', title: 'Depto Dos', amount: 1000, currency: 'ARS', daysOverdue: 0 }),
      ]),
    );
    renderEs(<DailyPriorities />);
    await screen.findByText('Depto Uno');
    expect(norm(document.body.textContent)).toContain('$ 726.513');
    expect(screen.getAllByText('vencida hace 48 días').length).toBeGreaterThan(0);
    expect(screen.getAllByText('pendiente').length).toBeGreaterThan(0);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/es/liquidaciones');
  });

  it('contratos y leads llevan su plazo y enlazan a su ficha', async () => {
    apiClient.mockResolvedValue(
      response([
        priority({ ref: 'K1', kind: 'contrato', entityId: 'c9', title: 'Casa Tres', daysToDue: 34 }),
        priority({ ref: 'K2', kind: 'contrato', entityId: 'c8', title: 'Casa Hoy', daysToDue: 0 }),
        priority({ ref: 'L1', kind: 'lead', entityId: 'l7', title: 'Lead frío', daysSinceContact: 90, urgency: 'baja' }),
      ]),
    );
    renderEs(<DailyPriorities />);
    await screen.findByText('Casa Tres');
    expect(screen.getAllByText('34 días').length).toBeGreaterThan(0);
    expect(screen.getAllByText('para vencer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Hoy').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3 meses').length).toBeGreaterThan(0);
    expect(screen.getAllByText('sin contacto').length).toBeGreaterThan(0);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/es/contracts/c9');
    expect(hrefs).toContain('/es/leads/l7');
  });

  it('sin dato duro muestra el motivo, y pasa a duración el que llega en horas', async () => {
    apiClient.mockResolvedValue(
      response(
        [
          priority({ ref: 'R1', title: 'Sin plazo', reason: 'Reclamo abierto de prioridad Media' }),
          priority({
            ref: 'R2',
            entityId: 't2',
            title: 'Con plazo',
            reason: 'SLA excedido en 72 h, sin responsable asignado',
            slaHoursOverdue: 72,
          }),
        ],
        { source: 'model', model: 'modelo-de-prueba' },
      ),
    );
    renderEs(<DailyPriorities />);
    expect(await screen.findByText('Reclamo abierto de prioridad Media')).toBeInTheDocument();
    expect(screen.getByText('Fuera de plazo hace 3 días, sin responsable asignado')).toBeInTheDocument();
    expect(screen.getByText('Orden sugerido por el asistente (modelo-de-prueba)')).toBeInTheDocument();
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toContain('/es/tickets/t2');
  });

  it('avisa cuando no hay nada urgente y cuando la carga falla', async () => {
    apiClient.mockResolvedValue(response([]));
    const { unmount } = renderEs(<DailyPriorities />);
    expect(await screen.findByText('No hay nada urgente para hoy')).toBeInTheDocument();
    unmount();

    apiClient.mockRejectedValue(new Error('caído'));
    renderEs(<DailyPriorities />);
    expect(await screen.findByText('No se pudieron cargar las prioridades del día')).toBeInTheDocument();
  });
});
