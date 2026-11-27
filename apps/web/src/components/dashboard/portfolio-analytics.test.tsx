// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderEs } from '@/components/index-data/test-utils';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
// jsdom no mide el contenedor: se le da un tamaño fijo para que el gráfico dibuje.
vi.mock('recharts', async (importOriginal) => {
  const original = await importOriginal<typeof import('recharts')>();
  const { cloneElement } = await import('react');
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 400, height: 240 }),
  };
});

import { PortfolioAnalytics, shortLabel } from './portfolio-analytics';

function mockApi(occupancy: unknown, profitability: unknown) {
  apiClient.mockImplementation((path: string) => {
    const result = path.startsWith('/dashboard/occupancy-trend') ? occupancy : profitability;
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
}

describe('PortfolioAnalytics', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it('aclara qué cuenta la ocupación del gráfico frente al indicador de arriba', async () => {
    mockApi(
      [
        { month: '2026-10', occupancyPct: 40 },
        { month: '2026-11', occupancyPct: 40 },
      ],
      [{ propertyId: 'p1', label: 'Guatemala 4521 CABA', revenue: 3675582.94, expenses: 46000, net: 3629582.94 }],
    );
    renderEs(<PortfolioAnalytics />);
    expect(await screen.findByText(/Cuenta solo las propiedades con contrato vigente/)).toBeInTheDocument();
    expect(screen.getByText('Ocupación con contrato vigente')).toBeInTheDocument();
    expect(screen.getByText('Ingresos y gastos por propiedad')).toBeInTheDocument();
  });

  it('sin datos explica qué falta y no deja la aclaración suelta', async () => {
    mockApi([], []);
    renderEs(<PortfolioAnalytics />);
    expect(await screen.findByText('Todavía no hay ocupación para graficar')).toBeInTheDocument();
    expect(screen.getByText('Todavía no hay rentabilidad para graficar')).toBeInTheDocument();
    expect(screen.queryByText(/Cuenta solo las propiedades/)).not.toBeInTheDocument();
  });

  it('avisa si los gráficos no se pudieron cargar', async () => {
    mockApi(new Error('boom'), []);
    renderEs(<PortfolioAnalytics />);
    expect(await screen.findByText('No se pudieron cargar los gráficos de la cartera')).toBeInTheDocument();
  });
});

describe('shortLabel', () => {
  it('corta las direcciones largas con puntos suspensivos al final', () => {
    expect(shortLabel('Rojas 540 CABA')).toBe('Rojas 540 CABA');
    expect(shortLabel('Guatemala 4521 CABA')).toBe('Guatemala 4521 CA…');
    expect(shortLabel('Guatemala 4521 CABA')).toHaveLength(18);
  });
});
