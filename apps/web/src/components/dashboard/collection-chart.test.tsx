// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderEs } from '@/components/index-data/test-utils';

// jsdom no mide el contenedor: se le da un tamaño fijo para que el gráfico dibuje.
vi.mock('recharts', async (importOriginal) => {
  const original = await importOriginal<typeof import('recharts')>();
  const { cloneElement } = await import('react');
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 640, height: 200 }),
  };
});

import { CollectionChart } from './collection-chart';

const TREND = [
  { month: 'Sep', expected: 2641864, collected: 2641864 },
  { month: 'Oct', expected: 2641864, collected: 1915352 },
  { month: 'Nov', expected: 0, collected: 0 },
];

describe('CollectionChart', () => {
  it('nombra las series y marca el último mes como en curso', () => {
    renderEs(<CollectionChart trend={TREND} accent="#bd5a32" currentMonthName="noviembre" />);
    expect(screen.getByText('Liquidado y cobrado por mes')).toBeInTheDocument();
    expect(screen.getByText('Liquidado')).toBeInTheDocument();
    expect(screen.getByText('Cobrado')).toBeInTheDocument();
    expect(screen.getAllByText('en curso')).toHaveLength(1);
    expect(screen.getByText('Oct')).toBeInTheDocument();
  });

  it('explica el mes en curso sin liquidaciones en vez de mostrarlo como una caída', () => {
    renderEs(<CollectionChart trend={TREND} accent="#bd5a32" currentMonthName="noviembre" />);
    expect(screen.getByText('Todavía no se emitieron las liquidaciones de noviembre.')).toBeInTheDocument();
  });

  it('con liquidaciones en el mes aclara que todavía no cerró', () => {
    const trend = [...TREND.slice(0, 2), { month: 'Nov', expected: 2641864, collected: 500000 }];
    renderEs(<CollectionChart trend={trend} accent="#bd5a32" currentMonthName="noviembre" />);
    expect(screen.getByText('noviembre todavía no cerró: lo cobrado puede seguir subiendo.')).toBeInTheDocument();
  });

  it('sin datos muestra un vacío en lugar de ejes sueltos', () => {
    renderEs(
      <CollectionChart
        trend={[{ month: 'Nov', expected: 0, collected: 0 }]}
        accent="#bd5a32"
        currentMonthName="noviembre"
      />,
    );
    expect(screen.getByText('Todavía no hay liquidaciones para graficar.')).toBeInTheDocument();
    expect(screen.queryByText('en curso')).not.toBeInTheDocument();
  });
});
