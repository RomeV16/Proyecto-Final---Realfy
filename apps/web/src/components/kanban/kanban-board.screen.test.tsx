// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEsWithQuery } from '@/components/index-data/test-utils';

const { apiClient } = vi.hoisted(() => {
  // dnd-kit usa ResizeObserver al cargarse y jsdom no lo trae.
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= FakeResizeObserver;
  return { apiClient: vi.fn() };
});

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/pipeline',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { KanbanBoard } from './kanban-board';

const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

const pipelines = [
  {
    id: 'pi-1',
    name: 'Embudo de prueba',
    type: 'Alquiler',
    stages: [
      { id: 'st-1', name: 'Consulta nueva', sortOrder: 0, staleDays: 2 },
      { id: 'st-2', name: 'Visita', sortOrder: 1, staleDays: null },
    ],
  },
  { id: 'pi-2', name: 'Embudo de venta', type: 'Venta', stages: [{ id: 'st-3', name: 'Oferta', sortOrder: 0 }] },
];

function lead(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    person: { id: `pe-${id}`, firstName: 'Luis', lastName: `Inventado ${id}` },
    currentStage: { id: 'st-1', name: 'Consulta nueva' },
    pipeline: { id: 'pi-1', name: 'Embudo de prueba' },
    source: 'WebInquiry',
    status: 'Nuevo',
    assignedToUser: { firstName: 'Carla', lastName: 'Ejemplo' },
    createdAt: daysAgo(120),
    updatedAt: daysAgo(105),
    lastContactAt: null,
    budget: '400000',
    budgetCurrency: 'ARS',
    ...over,
  };
}

function mockApi(leads: unknown[] | (() => unknown)) {
  apiClient.mockImplementation((path: string) => {
    if (path === '/pipelines') return Promise.resolve(pipelines);
    if (String(path).startsWith('/leads')) return Promise.resolve().then(typeof leads === 'function' ? leads : () => ({ items: leads }));
    return Promise.resolve({});
  });
}

describe('KanbanBoard', () => {
  beforeEach(() => apiClient.mockReset());

  it('muestra cada etapa con su cantidad y la suma de presupuestos', async () => {
    mockApi([lead('a'), lead('b', { budget: '100000' }), lead('c', { currentStage: { id: 'st-2', name: 'Visita' }, budget: null })]);
    renderEsWithQuery(<KanbanBoard />);
    const heading = await screen.findByRole('heading', { name: 'Consulta nueva' });
    const header = heading.parentElement as HTMLElement;
    expect(within(header).getByText('2 leads')).toBeInTheDocument();
    expect(within(header).getByText(/500\.000/)).toBeInTheDocument();
    const visita = screen.getByRole('heading', { name: 'Visita' }).parentElement as HTMLElement;
    expect(within(visita).getByText('1 lead')).toBeInTheDocument();
  });

  it('las tarjetas llevan a la ficha y dicen la antigüedad en palabras', async () => {
    mockApi([lead('a')]);
    renderEsWithQuery(<KanbanBoard />);
    await screen.findByRole('heading', { name: 'Consulta nueva' });
    const links = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(links).toContain('/es/leads/a');
    expect(screen.getAllByText('Sin cambios hace 3 meses').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sin contacto').length).toBeGreaterThan(0);
    expect(screen.queryByText(/\d+d en etapa/)).not.toBeInTheDocument();
  });

  it('un embudo sin leads lo dice arriba del tablero', async () => {
    mockApi([]);
    renderEsWithQuery(<KanbanBoard />);
    expect(await screen.findByText(/Todavía no hay leads activos en este embudo/)).toBeInTheDocument();
    expect(screen.getAllByText('Sin leads en esta etapa').length).toBeGreaterThan(0);
  });

  it('si falla la carga ofrece reintentar', async () => {
    let fail = true;
    mockApi(() => {
      if (fail) throw new Error('red');
      return { items: [lead('a')] };
    });
    renderEsWithQuery(<KanbanBoard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar el pipeline.');
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Consulta nueva' })).toBeInTheDocument();
  });

  it('sin embudos configurados explica qué falta', async () => {
    apiClient.mockResolvedValue([]);
    renderEsWithQuery(<KanbanBoard />);
    expect(await screen.findByText('No hay embudos configurados')).toBeInTheDocument();
  });

  it('cambia de embudo con las solapas', async () => {
    mockApi([lead('a')]);
    renderEsWithQuery(<KanbanBoard />);
    await screen.findByRole('heading', { name: 'Consulta nueva' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Embudo de venta' }));
    expect(await screen.findByRole('heading', { name: 'Oferta' })).toBeInTheDocument();
    expect(apiClient).toHaveBeenLastCalledWith(expect.stringContaining('pipelineId=pi-2'));
  });
});
